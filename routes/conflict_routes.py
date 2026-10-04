from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import ScheduleEntry, Room, StudentGroup, User
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event

router = APIRouter(prefix="/conflicts", tags=["conflicts"])

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
SLOTS = [
    "08:30-10:00",
    "10:15-11:45",
    "12:00-13:30",
    "13:30-15:00",
    "15:15-16:45",
    "17:00-18:30",
]

# Room type requirements per session type
REQUIRED_ROOM_TYPES = {
    "lecture":  ["Lecture Hall", "Regular Classroom", "Seminar Room"],
    "practice": ["Seminar Room", "Regular Classroom", "Lecture Hall"],
    "lab":      ["Computer Lab", "Physics Lab"],
}

# Required equipment keywords per session type
REQUIRED_EQUIPMENT_GROUPS = {
    "lecture": [],
    "practice": [],
    "lab": [["PCs", "Lab Kits"]],  # OR: at least one
}


def _group_sizes(db):
    return {g.group_code: g.student_count for g in db.query(StudentGroup).all()}


def _rooms(db):
    return {r.id: r for r in db.query(Room).all()}


def scan_conflicts(db):
    entries = db.query(ScheduleEntry).all()
    rooms = _rooms(db)
    group_sizes = _group_sizes(db)

    conflicts = []
    conflicting_ids = set()

    # 1. Room double-booking
    seen = {}
    for e in entries:
        if not e.room_id:
            continue
        key = (e.room_id, e.day, e.time_slot)
        if key in seen:
            other = seen[key]
            conflicting_ids.add(e.id)
            conflicting_ids.add(other.id)
            conflicts.append({
                "type": "room_double_booking",
                "severity": "error",
                "message": f"Room {e.room_code} double-booked on {e.day} {e.time_slot}",
                "entry_ids": [e.id, other.id],
                "details": {
                    "room": e.room_code,
                    "day": e.day,
                    "time_slot": e.time_slot,
                    "courses": [other.course_code, e.course_code],
                },
            })
        else:
            seen[key] = e

    # 2. Teacher double-booking
    seen = {}
    for e in entries:
        if not e.teacher_id:
            continue
        key = (e.teacher_id, e.day, e.time_slot)
        if key in seen:
            other = seen[key]
            conflicting_ids.add(e.id)
            conflicting_ids.add(other.id)
            conflicts.append({
                "type": "teacher_double_booking",
                "severity": "error",
                "message": f"Teacher {e.teacher_name} double-booked on {e.day} {e.time_slot}",
                "entry_ids": [e.id, other.id],
                "details": {
                    "teacher": e.teacher_name,
                    "day": e.day,
                    "time_slot": e.time_slot,
                    "courses": [other.course_code, e.course_code],
                },
            })
        else:
            seen[key] = e

    # 3. Room capacity overflow
    for e in entries:
        if not e.room_id or not e.target_groups:
            continue
        room = rooms.get(e.room_id)
        if not room:
            continue
        groups = [g.strip() for g in e.target_groups.split(",") if g.strip()]
        total = sum(group_sizes.get(g, 0) for g in groups)
        if total > room.capacity:
            conflicting_ids.add(e.id)
            conflicts.append({
                "type": "capacity_overflow",
                "severity": "warning",
                "message": (
                    f"Room {room.room_code} capacity {room.capacity} "
                    f"is smaller than group size {total}"
                ),
                "entry_ids": [e.id],
                "details": {
                    "room": room.room_code,
                    "capacity": room.capacity,
                    "required": total,
                    "excess": total - room.capacity,
                    "course": e.course_code,
                },
            })

    # 4. Room type mismatch
    for e in entries:
        if not e.room_id or not e.session_type:
            continue
        room = rooms.get(e.room_id)
        if not room:
            continue

        allowed_types = REQUIRED_ROOM_TYPES.get(e.session_type, [])
        if allowed_types and room.room_type not in allowed_types:
            conflicting_ids.add(e.id)
            conflicts.append({
                "type": "wrong_room_type",
                "severity": "warning",
                "message": (
                    f"Course {e.course_code} ({e.session_type}) is in "
                    f"{room.room_type} '{room.room_code}', which is not suitable"
                ),
                "entry_ids": [e.id],
                "details": {
                    "room": room.room_code,
                    "room_type": room.room_type,
                    "session_type": e.session_type,
                    "course": e.course_code,
                },
            })

    # 5. Equipment / gear mismatch (OR groups)
    for e in entries:
        if not e.room_id or not e.session_type:
            continue
        room = rooms.get(e.room_id)
        if not room:
            continue

        req_groups = REQUIRED_EQUIPMENT_GROUPS.get(e.session_type, [])
        if not req_groups:
            continue

        equip_lower = (room.equipment or "").lower()
        missing_groups = []
        for group in req_groups:
            if not any(kw.lower() in equip_lower for kw in group):
                missing_groups.append(" / ".join(group))

        if missing_groups:
            conflicting_ids.add(e.id)
            conflicts.append({
                "type": "gear_mismatch",
                "severity": "warning",
                "message": (
                    f"Room {room.room_code} is missing required equipment: "
                    f"{'; '.join(missing_groups)}"
                ),
                "entry_ids": [e.id],
                "details": {
                    "room": room.room_code,
                    "missing": missing_groups,
                    "course": e.course_code,
                },
            })

    return {
        "conflicts": conflicts,
        "conflicting_entry_ids": list(conflicting_ids),
        "total_entries": len(entries),
        "error_count": sum(1 for c in conflicts if c["severity"] == "error"),
        "warning_count": sum(1 for c in conflicts if c["severity"] == "warning"),
    }


# ---------- Routes ----------
@router.get("/scan")
def scan(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return scan_conflicts(db)


@router.get("/grid")
def grid(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return schedule entries grouped by day and time slot."""
    entries = db.query(ScheduleEntry).all()
    conflict_info = scan_conflicts(db)
    conflicting_ids = set(conflict_info["conflicting_entry_ids"])

    cell_map = {}
    for e in entries:
        key = f"{e.day}|{e.time_slot}"
        cell_map.setdefault(key, []).append({
            "id": e.id,
            "course_code": e.course_code,
            "session_type": e.session_type,
            "room_code": e.room_code,
            "teacher_name": e.teacher_name,
            "target_groups": e.target_groups,
            "has_conflict": e.id in conflicting_ids,
        })

    grid_data = []
    for day in DAYS:
        for slot in SLOTS:
            key = f"{day}|{slot}"
            grid_data.append({
                "day": day,
                "time_slot": slot,
                "entries": cell_map.get(key, []),
            })

    return {
        "days": DAYS,
        "time_slots": SLOTS,
        "cells": grid_data,
        "conflicts": conflict_info["conflicts"],
        "error_count": conflict_info["error_count"],
        "warning_count": conflict_info["warning_count"],
        "total_entries": conflict_info["total_entries"],
    }


class MoveRequest(BaseModel):
    day: str
    time_slot: str
    room_id: int | None = None


@router.put("/entries/{entry_id}")
def move_entry(
    entry_id: int,
    data: MoveRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    entry = db.query(ScheduleEntry).filter_by(id=entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    if data.day not in DAYS:
        raise HTTPException(status_code=400, detail="Invalid day")
    if data.time_slot not in SLOTS:
        raise HTTPException(status_code=400, detail="Invalid time slot")

    entry.day = data.day
    entry.time_slot = data.time_slot

    if data.room_id is not None:
        room = db.query(Room).filter_by(id=data.room_id).first()
        if not room:
            raise HTTPException(status_code=400, detail="Room not found")
        entry.room_id = room.id
        entry.room_code = room.room_code

    db.commit()
    log_event(db, admin.id, "entry_moved", True, f"entry_id={entry_id}")

    return {"message": "Entry moved successfully", "scan": scan_conflicts(db)}


class CreateEntryRequest(BaseModel):
    day: str
    time_slot: str
    course_id: int
    course_code: str
    session_type: str
    room_id: int
    room_code: str
    teacher_id: int | None = None
    teacher_name: str | None = None
    target_groups: str | None = None


@router.post("/entries")
def create_entry(
    data: CreateEntryRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    entry = ScheduleEntry(
        day=data.day,
        time_slot=data.time_slot,
        course_id=data.course_id,
        course_code=data.course_code,
        session_type=data.session_type,
        room_id=data.room_id,
        room_code=data.room_code,
        teacher_id=data.teacher_id,
        teacher_name=data.teacher_name,
        target_groups=data.target_groups,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    log_event(db, admin.id, "entry_created", True, f"entry_id={entry.id}")
    return {"message": "Entry created", "entry_id": entry.id, "scan": scan_conflicts(db)}


@router.delete("/entries/{entry_id}")
def delete_entry(
    entry_id: int,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    entry = db.query(ScheduleEntry).filter_by(id=entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    db.delete(entry)
    db.commit()
    log_event(db, admin.id, "entry_deleted", True, f"entry_id={entry_id}")
    return {"message": "Entry deleted", "scan": scan_conflicts(db)}


class SwapRequest(BaseModel):
    entry_id_a: int
    entry_id_b: int


@router.post("/swap")
def swap_entries(
    data: SwapRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    """Swap the day/time_slot/room of two entries."""
    a = db.query(ScheduleEntry).filter_by(id=data.entry_id_a).first()
    b = db.query(ScheduleEntry).filter_by(id=data.entry_id_b).first()
    if not a or not b:
        raise HTTPException(status_code=404, detail="One or both entries not found")

    # swap day + time_slot + room
    a.day, b.day = b.day, a.day
    a.time_slot, b.time_slot = b.time_slot, a.time_slot
    a.room_id, b.room_id = b.room_id, a.room_id
    a.room_code, b.room_code = b.room_code, a.room_code

    db.commit()
    log_event(db, admin.id, "entry_swapped", True,
              f"{data.entry_id_a} <-> {data.entry_id_b}")

    return {"message": "Entries swapped", "scan": scan_conflicts(db)}