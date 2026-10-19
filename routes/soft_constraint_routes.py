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
    from services.scoring import score_schedule as evaluate
    slots = get_active_slots(db)
    if any(e.day not in {"Mon", "Tue", "Wed", "Thu", "Fri"} or e.time_slot not in slots for e in data.entries):
        raise HTTPException(status_code=400, detail="Score entries must use working days and active time slots")
    result = evaluate(db, [{"day": e.day, "time_slot": e.time_slot,
                            "group_code": e.student_group} for e in data.entries])
    return {"total_score": result["score"], "total_penalty": result["total_penalty"],
            "checked_entries": len(data.entries), "breakdown": result["breakdown"]}
