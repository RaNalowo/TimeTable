import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Constraint, User
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event
from services.scheduling_data import validate_lunch, read_lunch

router = APIRouter(prefix="/constraints", tags=["constraints"])

ALLOWED_TYPES = ["no_overlap_rooms", "no_overlap_teachers", "lunch_break"]

DEFAULT_CONSTRAINTS = {
    "no_overlap_rooms": {
        "is_active": True,
        "config": None,
    },
    "no_overlap_teachers": {
        "is_active": True,
        "config": None,
    },
    "lunch_break": {
        "is_active": False,
        "config": {
            "start": "12:00",
            "end": "13:00",
            "days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
        },
    },
}


class ConstraintUpdate(BaseModel):
    is_active: bool
    config: dict | None = None


class ScheduleEntryInput(BaseModel):
    day: str
    time_slot: str
    room_id: int | None = None
    room_code: str | None = None
    teacher_id: int | None = None
    teacher_name: str | None = None
    course_code: str | None = None


class ValidateRequest(BaseModel):
    entries: list[ScheduleEntryInput]


# ---------- Helpers ----------
def constraint_to_dict(c: Constraint):
    return {
        "id": c.id,
        "constraint_type": c.constraint_type,
        "is_active": c.is_active,
        "config": json.loads(c.config_json) if c.config_json else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def ensure_defaults(db: Session):
    """Insert default rows for any constraint type not yet in the database."""
    existing = {c.constraint_type for c in db.query(Constraint).all()}
    changed = False
    for t, d in DEFAULT_CONSTRAINTS.items():
        if t not in existing:
            db.add(Constraint(
                constraint_type=t,
                is_active=d["is_active"],
                config_json=json.dumps(d["config"]) if d["config"] else None,
            ))
            changed = True
    if changed:
        db.commit()


def slot_overlaps_lunch(slot: str, lunch_start: str, lunch_end: str) -> bool:
    """Return True if a time slot overlaps with the configured lunch window."""
    try:
        s_str, e_str = slot.split("-")
        fmt = "%H:%M"
        s = datetime.strptime(s_str.strip(), fmt)
        e = datetime.strptime(e_str.strip(), fmt)
        ls = datetime.strptime(lunch_start, fmt)
        le = datetime.strptime(lunch_end, fmt)
        return s < le and e > ls
    except Exception:
        return False


# ---------- Constraint Routes ----------
@router.get("")
def list_constraints(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_defaults(db)
    rows = db.query(Constraint).order_by(Constraint.id).all()
    return [constraint_to_dict(c) for c in rows]


@router.put("/{constraint_type}")
def update_constraint(
    constraint_type: str,
    data: ConstraintUpdate,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    if constraint_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Unknown constraint type")
    if constraint_type in {"no_overlap_rooms", "no_overlap_teachers"} and not data.is_active:
        raise HTTPException(status_code=400, detail="Room and teacher overlap prevention are mandatory and cannot be disabled.")

    ensure_defaults(db)
    row = db.query(Constraint).filter_by(constraint_type=constraint_type).first()
    if not row:
        raise HTTPException(status_code=404, detail="Constraint not found")

    if constraint_type == "lunch_break":
        cfg = {"start": "12:00", "end": "13:00", "days": ["Mon", "Tue", "Wed", "Thu", "Fri"], **(data.config or {})}
        validate_lunch(cfg)
        start = cfg.get("start")
        end = cfg.get("end")
        days = cfg.get("days", [])

        if start and end:
            try:
                fmt = "%H:%M"
                s = datetime.strptime(start, fmt)
                e = datetime.strptime(end, fmt)
                if s >= e:
                    raise HTTPException(
                        status_code=400,
                        detail="Lunch break start time must be before end time",
                    )
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid time format. Use HH:MM (e.g., 12:00).",
                )

        row.config_json = json.dumps({
            "start": start or "12:00",
            "end": end or "13:00",
            "days": days or ["Mon", "Tue", "Wed", "Thu", "Fri"],
        })
    else:
        row.config_json = json.dumps(data.config) if data.config else None

    row.is_active = data.is_active
    db.commit()
    db.refresh(row)

    log_event(
        db, admin.id, "constraint_updated", True,
        f"{constraint_type} active={data.is_active}",
    )
    return constraint_to_dict(row)


# ---------- Validation ----------
@router.post("/validate")
def validate_schedule(
    data: ValidateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Validate a list of schedule entries against all currently active hard constraints.

    Returns a JSON object:
      {
        "valid": true | false,
        "conflicts": [ { type, message, entries }, ... ],
        "checked": <number of entries evaluated>
      }
    """
    ensure_defaults(db)
    configs = {c.constraint_type: c for c in db.query(Constraint).all()}

    conflicts = []

    # 1. Room overlap
    if configs.get("no_overlap_rooms") and configs["no_overlap_rooms"].is_active:
        seen = {}
        for e in data.entries:
            if e.room_id is None:
                continue
            key = (e.room_id, e.day, e.time_slot)
            if key in seen:
                conflicts.append({
                    "type": "no_overlap_rooms",
                    "message": (
                        f"Room {e.room_code or e.room_id} is double-booked on "
                        f"{e.day} {e.time_slot}"
                    ),
                    "entries": [seen[key].course_code, e.course_code],
                })
            else:
                seen[key] = e

    # 2. Teacher overlap
    if configs.get("no_overlap_teachers") and configs["no_overlap_teachers"].is_active:
        seen = {}
        for e in data.entries:
            if e.teacher_id is None:
                continue
            key = (e.teacher_id, e.day, e.time_slot)
            if key in seen:
                conflicts.append({
                    "type": "no_overlap_teachers",
                    "message": (
                        f"Teacher {e.teacher_name or e.teacher_id} is double-booked on "
                        f"{e.day} {e.time_slot}"
                    ),
                    "entries": [seen[key].course_code, e.course_code],
                })
            else:
                seen[key] = e

    # 3. Mandatory lunch break
    lb = configs.get("lunch_break")
    if lb and lb.is_active and lb.config_json:
        cfg = json.loads(lb.config_json)
        start = cfg.get("start", "12:00")
        end = cfg.get("end", "13:00")
        days = set(cfg.get("days", []))
        for e in data.entries:
            if e.day in days and slot_overlaps_lunch(e.time_slot, start, end):
                conflicts.append({
                    "type": "lunch_break",
                    "message": (
                        f"Course {e.course_code or '?'} is scheduled during the "
                        f"lunch break ({start}-{end}) on {e.day} {e.time_slot}"
                    ),
                    "entries": [e.course_code],
                })

    return {
        "valid": len(conflicts) == 0,
        "conflicts": conflicts,
        "checked": len(data.entries),
    }
