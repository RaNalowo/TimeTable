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


@router.get("")
def list_slots(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    slots = db.query(TimeSlot).order_by(TimeSlot.sort_order).all()
    return [slot_to_dict(s) for s in slots]


@router.post("")
def create_slot(
    data: TimeSlotRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    label = data.slot_label.strip()

    # Basic format check: "HH:MM-HH:MM"
    if "-" not in label or len(label.split("-")) != 2:
        raise HTTPException(
            status_code=400,
            detail="Time slot must be in format HH:MM-HH:MM (e.g., 08:30-10:00).",
        )

    if db.query(TimeSlot).filter_by(slot_label=label).first():
        raise HTTPException(status_code=400, detail="Time slot already exists")

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

    if "-" not in label or len(label.split("-")) != 2:
        raise HTTPException(
            status_code=400,
            detail="Time slot must be in format HH:MM-HH:MM.",
        )

    dup = db.query(TimeSlot).filter(
        TimeSlot.slot_label == label,
        TimeSlot.id != slot_id,
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail="Time slot already exists")

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
    """Public endpoint — returns only active slots for the generator."""
    slots = (
        db.query(TimeSlot)
        .filter_by(is_active=True)
        .order_by(TimeSlot.sort_order)
        .all()
    )
    return [s.slot_label for s in slots]