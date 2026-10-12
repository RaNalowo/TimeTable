import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import TimeSlot, User
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event

router = APIRouter(prefix="/time-slots", tags=["time-slots"])


class TimeSlotRequest(BaseModel):
    slot_label: str = Field(min_length=1, max_length=30)
    sort_order: int = 0
    is_active: bool = True


def slot_to_dict(s: TimeSlot):
    return {
        "id": s.id,
        "slot_label": s.slot_label,
        "sort_order": s.sort_order,
        "is_active": s.is_active,
    }


def parse_slot(label: str):
    """Parse '08:30-09:20' or '8:30-9:20' → (start_minutes, end_minutes) or None."""
    label = label.strip()
    m = re.match(r"^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$", label)
    if not m:
        return None
    sh, sm, eh, em = map(int, m.groups())
    if sh > 23 or eh > 23 or sm > 59 or em > 59:
        return None
    start = sh * 60 + sm
    end = eh * 60 + em
    if end <= start:
        return None
    return start, end


def validate_slot(db: Session, label: str, sort_order: int, is_active: bool, exclude_id=None):
    # ---------- 1. Format ----------
    parsed = parse_slot(label)
    if not parsed:
        raise HTTPException(
            status_code=400,
            detail="Time slot must be in format HH:MM-HH:MM (e.g., 08:30-09:20).",
        )
    start, end = parsed

    # ---------- 2. Duration exactly 50 minutes ----------
    duration = end - start
    if duration != 50:
        raise HTTPException(
            status_code=400,
            detail=f"Each time slot must be exactly 50 minutes long. Got {duration} minutes.",
        )

    # ---------- 3. Sort order 1-10 ----------
    if sort_order < 1 or sort_order > 10:
        raise HTTPException(
            status_code=400,
            detail="Sort order must be between 1 and 10.",
        )

    # ---------- 4. Only one ACTIVE slot per sort_order ----------
    if is_active:
        q = db.query(TimeSlot).filter(
            TimeSlot.sort_order == sort_order,
            TimeSlot.is_active == True,
        )
        if exclude_id:
            q = q.filter(TimeSlot.id != exclude_id)
        if q.first():
            raise HTTPException(
                status_code=400,
                detail=f"Another active slot already uses sort order {sort_order}. Deactivate it first.",
            )

    # ---------- 5. Order matches time order (only active slots) ----------
    if is_active:
        siblings = db.query(TimeSlot).filter(TimeSlot.is_active == True).all()
        if exclude_id:
            siblings = [s for s in siblings if s.id != exclude_id]

        # Build comparable list of (sort_order, start_minutes)
        compare = []
        for s in siblings:
            p = parse_slot(s.slot_label)
            if p:
                compare.append((s.sort_order, p[0], s.slot_label))
        compare.append((sort_order, start, label))

        # Sort by sort_order
        compare.sort(key=lambda x: x[0])

        # Check start times are strictly increasing
        prev_start = None
        for so, cur_start, lbl in compare:
            if prev_start is not None and cur_start <= prev_start:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Sort order does not match time order. "
                        "Earlier time slots must have smaller sort numbers."
                    ),
                )
            prev_start = cur_start


@router.get("")
def list_slots(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    slots = db.query(TimeSlot).order_by(
        TimeSlot.sort_order.asc(),
        TimeSlot.slot_label.asc(),
    ).all()
    return [slot_to_dict(s) for s in slots]


@router.post("")
def create_slot(
    data: TimeSlotRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    label = data.slot_label.strip()

    if db.query(TimeSlot).filter_by(slot_label=label).first():
        raise HTTPException(status_code=400, detail="Time slot already exists")

    validate_slot(db, label, data.sort_order, data.is_active, exclude_id=None)

    s = TimeSlot(
        slot_label=label,
        sort_order=data.sort_order,
        is_active=data.is_active,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    log_event(db, admin.id, "time_slot_created", True, label)
    return slot_to_dict(s)


@router.put("/{slot_id}")
def update_slot(
    slot_id: int,
    data: TimeSlotRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    s = db.query(TimeSlot).filter_by(id=slot_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Time slot not found")

    label = data.slot_label.strip()

    dup = db.query(TimeSlot).filter(
        TimeSlot.slot_label == label,
        TimeSlot.id != slot_id,
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail="Time slot already exists")

    validate_slot(db, label, data.sort_order, data.is_active, exclude_id=slot_id)

    s.slot_label = label
    s.sort_order = data.sort_order
    s.is_active = data.is_active
    db.commit()
    db.refresh(s)
    log_event(db, admin.id, "time_slot_updated", True, f"id={slot_id}")
    return slot_to_dict(s)


@router.delete("/{slot_id}")
def delete_slot(
    slot_id: int,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    s = db.query(TimeSlot).filter_by(id=slot_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Time slot not found")
    db.delete(s)
    db.commit()
    log_event(db, admin.id, "time_slot_deleted", True, f"id={slot_id}")
    return {"message": "Time slot deleted"}


@router.get("/active")
def list_active_slots(db: Session = Depends(get_db)):
    slots = (
        db.query(TimeSlot)
        .filter_by(is_active=True)
        .order_by(TimeSlot.sort_order)
        .all()
    )
    return [s.slot_label for s in slots]

@router.get("/validate")
def validate_all_slots(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Check active time slots for logical issues (overlaps, ordering)."""
    slots = (
        db.query(TimeSlot)
        .filter_by(is_active=True)
        .order_by(TimeSlot.sort_order.asc())
        .all()
    )

    issues = []
    bad_ids = set()

    parsed = []
    for s in slots:
        p = parse_slot(s.slot_label)
        if not p:
            issues.append({
                "type": "invalid_format",
                "message": f"'{s.slot_label}' has an invalid format",
                "slot_ids": [s.id],
            })
            bad_ids.add(s.id)
            continue
        parsed.append({
            "id": s.id,
            "label": s.slot_label,
            "sort": s.sort_order,
            "start": p[0],
            "end": p[1],
        })

    # 1. Overlap check (pairwise)
    for i in range(len(parsed)):
        for j in range(i + 1, len(parsed)):
            a, b = parsed[i], parsed[j]
            if a["start"] < b["end"] and b["start"] < a["end"]:
                issues.append({
                    "type": "overlap",
                    "message": (
                        f"'{a['label']}' and '{b['label']}' overlap"
                    ),
                    "slot_ids": [a["id"], b["id"]],
                })
                bad_ids.add(a["id"])
                bad_ids.add(b["id"])

    # 2. Duplicate sort_order
    seen_sorts = {}
    for p in parsed:
        if p["sort"] in seen_sorts:
            issues.append({
                "type": "duplicate_sort",
                "message": (
                    f"Sort order {p['sort']} is used by both "
                    f"'{seen_sorts[p['sort']]}' and '{p['label']}'"
                ),
                "slot_ids": [p["id"]],
            })
            bad_ids.add(p["id"])
        else:
            seen_sorts[p["sort"]] = p["label"]

    # 3. Order mismatch — sort order doesn't match time order
    by_sort = sorted(parsed, key=lambda x: x["sort"])
    for i in range(len(by_sort) - 1):
        a, b = by_sort[i], by_sort[i + 1]
        if a["start"] > b["start"]:
            issues.append({
                "type": "order_mismatch",
                "message": (
                    f"'{a['label']}' (sort {a['sort']}) starts later than "
                    f"'{b['label']}' (sort {b['sort']})"
                ),
                "slot_ids": [a["id"], b["id"]],
            })
            bad_ids.add(a["id"])
            bad_ids.add(b["id"])

    return {
        "issues": issues,
        "bad_slot_ids": list(bad_ids),
        "total_active_slots": len(parsed),
        "is_valid": len(issues) == 0,
    }