from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import SoftConstraint, User
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event
from services.time_slots import get_active_slots

router = APIRouter(prefix="/soft-constraints", tags=["soft-constraints"])

ALLOWED_KEYS = [
    "minimize_gaps",
    "avoid_early_mornings",
    "avoid_late_evenings",
    "compact_days",
]

DEFAULT_SOFT_CONSTRAINTS = {
    "minimize_gaps": {
        "display_name": "Minimize Gaps",
        "description": "Reduce idle time between classes for student groups.",
        "weight": 5,
    },
    "avoid_early_mornings": {
        "display_name": "Avoid Early Mornings",
        "description": "Penalize the first slot of the day.",
        "weight": 5,
    },
    "avoid_late_evenings": {
        "display_name": "Avoid Late Evenings",
        "description": "Penalize the last slot of the day.",
        "weight": 5,
    },
    "compact_days": {
        "display_name": "Compact Days",
        "description": "Prefer fewer days with more classes over spread-out schedules.",
        "weight": 5,
    },
}


class SoftConstraintUpdate(BaseModel):
    weight: int = Field(ge=0, le=10)
    is_enabled: bool = True


class ScoreEntry(BaseModel):
    day: str
    time_slot: str
    course_code: str | None = None
    student_group: str | None = None


class ScoreRequest(BaseModel):
    entries: list[ScoreEntry]


def to_dict(c: SoftConstraint):
    return {
        "id": c.id,
        "constraint_key": c.constraint_key,
        "display_name": c.display_name,
        "description": c.description,
        "weight": c.weight,
        "is_enabled": c.is_enabled,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def ensure_defaults(db: Session):
    existing = {c.constraint_key for c in db.query(SoftConstraint).all()}
    changed = False
    for key, d in DEFAULT_SOFT_CONSTRAINTS.items():
        if key not in existing:
            db.add(SoftConstraint(
                constraint_key=key,
                display_name=d["display_name"],
                description=d["description"],
                weight=d["weight"],
                is_enabled=True,
            ))
            changed = True
    if changed:
        db.commit()


# ---------- Penalty functions (now take slots list) ----------

def penalty_minimize_gaps(entries, slots):
    if not entries or not slots:
        return 0
    groups = {}
    for e in entries:
        key = (e.student_group, e.day)
        groups.setdefault(key, []).append(e.time_slot)

    total_gap = 0
    total_sessions = 0
    for _, ss in groups.items():
        total_sessions += len(ss)
        if len(ss) < 2:
            continue
        indices = sorted(slots.index(s) for s in ss if s in slots)
        if len(indices) < 2:
            continue
        span = indices[-1] - indices[0] + 1
        total_gap += (span - len(indices))

    if total_sessions == 0:
        return 0
    ratio = total_gap / total_sessions
    return min(round(ratio * 150), 100)


def penalty_avoid_early_mornings(entries, slots):
    if not entries or not slots:
        return 0
    first = slots[0]
    count = sum(1 for e in entries if e.time_slot == first)
    ratio = count / len(entries)
    return min(round(ratio * 200), 100)


def penalty_avoid_late_evenings(entries, slots):
    if not entries or not slots:
        return 0
    last = slots[-1]
    count = sum(1 for e in entries if e.time_slot == last)
    ratio = count / len(entries)
    return min(round(ratio * 200), 100)


def penalty_compact_days(entries, slots):
    if not entries:
        return 0
    groups = {}
    for e in entries:
        key = e.student_group or "_"
        groups.setdefault(key, set()).add(e.day)

    if not groups:
        return 0
    # Average distinct days per group; ideal is <= 3
    avg_days = sum(len(d) for d in groups.values()) / len(groups)
    excess = max(0, avg_days - 3)
    return min(round(excess * 40), 100)


# ---------- Routes ----------

@router.get("")
def list_soft_constraints(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_defaults(db)
    rows = db.query(SoftConstraint).order_by(SoftConstraint.id).all()
    return [to_dict(c) for c in rows]


@router.put("/{constraint_key}")
def update_soft_constraint(
    constraint_key: str,
    data: SoftConstraintUpdate,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    if constraint_key not in ALLOWED_KEYS:
        raise HTTPException(status_code=400, detail="Unknown soft constraint key")

    ensure_defaults(db)
    row = db.query(SoftConstraint).filter_by(constraint_key=constraint_key).first()
    if not row:
        raise HTTPException(status_code=404, detail="Soft constraint not found")

    row.weight = data.weight
    row.is_enabled = data.is_enabled
    db.commit()
    db.refresh(row)

    log_event(db, admin.id, "soft_constraint_updated", True,
              f"{constraint_key} weight={data.weight} enabled={data.is_enabled}")
    return to_dict(row)


@router.post("/reset")
def reset_to_defaults(
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    ensure_defaults(db)
    for key, d in DEFAULT_SOFT_CONSTRAINTS.items():
        row = db.query(SoftConstraint).filter_by(constraint_key=key).first()
        if row:
            row.weight = d["weight"]
            row.is_enabled = True
    db.commit()
    log_event(db, admin.id, "soft_constraints_reset", True, "reset to defaults")
    return {"message": "Soft constraints reset to defaults"}


@router.post("/score")
def score_schedule(
    data: ScoreRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_defaults(db)
    rows = {c.constraint_key: c for c in db.query(SoftConstraint).all()}
    slots = get_active_slots(db) or []

    entries = data.entries
    breakdown = []
    total_penalty = 0.0

    penalty_fns = {
        "minimize_gaps": penalty_minimize_gaps,
        "avoid_early_mornings": penalty_avoid_early_mornings,
        "avoid_late_evenings": penalty_avoid_late_evenings,
        "compact_days": penalty_compact_days,
    }

    for key, fn in penalty_fns.items():
        row = rows.get(key)
        if not row or not row.is_enabled or row.weight == 0:
            continue

        raw_penalty = fn(entries, slots)
        weighted = raw_penalty * row.weight / 10
        total_penalty += weighted

        breakdown.append({
            "constraint_key": key,
            "display_name": row.display_name,
            "weight": row.weight,
            "raw_penalty": raw_penalty,
            "weighted_penalty": round(weighted, 2),
        })

    final_score = max(0, round(100 - total_penalty, 2))
    return {
        "total_score": final_score,
        "total_penalty": round(total_penalty, 2),
        "checked_entries": len(entries),
        "breakdown": breakdown,
    }