from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
import json

from db.database import get_db
from db.models import (
    ScheduleEntry, Room, StudentGroup, User, Course, Teacher, TimeSlot,
    TeacherAvailability,
)
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event
from services.time_slots import get_active_slots
from services.semester_logic import get_active_semester

router = APIRouter(prefix="/conflicts", tags=["conflicts"])

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]

REQUIRED_ROOM_TYPES = {
    "lecture": ["Lecture Hall", "Regular Classroom", "Seminar Room"],
    "practice": ["Seminar Room", "Regular Classroom", "Lecture Hall"],
    "lab": ["Computer Lab", "Physics Lab"],
}

REQUIRED_EQUIPMENT_GROUPS = {
    "lecture": [],
    "practice": [],
    "lab": [["PCs", "Lab Kits"]],
}


# ---------- Helpers ----------

def _slot_label(e):
    return e.time_slot.slot_label if e.time_slot else None


def _course_code(e):
    return e.course.course_code if e.course else None


def _room_code(e):
    return e.room.room_code if e.room else None


def _teacher_name(e):
    return e.teacher.full_name if e.teacher else None


def _group_code(e):
    """返回完整的组名，例如 IS-26-AI 或 IS-26-AI-1"""
    if not e.group:
        return None
    base = e.group.group_code
    if e.sub_group:
        return f"{base}-{e.sub_group}"
    return base


def _required_seats(e):
    """根据是 Lecture 还是 Practice/Lab 计算所需座位数"""
    if not e.group:
        return 0
    if e.sub_group:
        # 子组人数 = 大组总人数 / 子组数量
        return e.group.student_count // max(e.group.sub_group_count, 1)
    return e.group.student_count


def scan_conflicts(db):
    active = get_active_semester(db)
    if active:
        entries = db.query(ScheduleEntry).filter_by(semester_id=active.id).all()
    else:
        entries = []

    rooms = {r.id: r for r in db.query(Room).all()}
    teachers = {t.id: t for t in db.query(Teacher).all()}

    # Teacher availability
    user_by_email = {u.email: u.id for u in db.query(User).all()}
    avail_by_uid = {}
    for a in db.query(TeacherAvailability).all():
        try:
            avail_by_uid[a.user_id] = json.loads(a.matrix_json)
        except Exception:
            pass
    teacher_avail = {}
    for t in teachers.values():
        uid = user_by_email.get(t.email)
        if uid and uid in avail_by_uid:
            teacher_avail[t.id] = avail_by_uid[uid]

    conflicts = []
    conflicting_ids = set()

    def add(ids, type_, severity, message, details):
        for i in ids:
            conflicting_ids.add(i)
        conflicts.append({
            "type": type_,
            "severity": severity,
            "message": message,
            "entry_ids": list(ids),
            "details": details,
        })

    # 1. Room double-booking
    seen = {}
    for e in entries:
        if not e.room_id:
            continue
        key = (e.room_id, e.day, e.time_slot_id)
        if key in seen:
            other = seen[key]
            add([e.id, other.id], "room_double_booking", "error",
                f"Room {_room_code(e)} double-booked on {e.day} {_slot_label(e)}",
                {"room": _room_code(e), "day": e.day, "time_slot": _slot_label(e),
                 "courses": [_course_code(other), _course_code(e)]})
        else:
            seen[key] = e

    # 2. Teacher double-booking
    seen = {}
    for e in entries:
        if not e.teacher_id:
            continue
        key = (e.teacher_id, e.day, e.time_slot_id)
        if key in seen:
            other = seen[key]
            add([e.id, other.id], "teacher_double_booking", "error",
                f"Teacher {_teacher_name(e)} double-booked on {e.day} {_slot_label(e)}",
                {"teacher": _teacher_name(e), "day": e.day, "time_slot": _slot_label(e),
                 "courses": [_course_code(other), _course_code(e)]})
        else:
            seen[key] = e

    # 3. Student group double-booking (层级检测)
    # 按 (group_id, day, slot) 分组，可能会有 Lecture 和 多个 Practice
    group_time_map = {}
    for e in entries:
        if not e.group_id:
            continue
        key = (e.group_id, e.day, e.time_slot_id)
        group_time_map.setdefault(key, []).append(e)

    for (_, day, _), elist in group_time_map.items():
        if len(elist) <= 1:
            continue

        # 两两检查冲突
        for i in range(len(elist)):
            for j in range(i + 1, len(elist)):
                e1, e2 = elist[i], elist[j]

                sub1 = e1.sub_group
                sub2 = e2.sub_group

                is_conflict = False
                if sub1 is None or sub2 is None:
                    is_conflict = True  # 只要有一方是 Lecture（大组），必冲突
                elif sub1 == sub2:
                    is_conflict = True  # 同一个 Practice 子组，冲突

                if not is_conflict:
                    continue

                # 如果是两门选修课之间，根据业务规则允许重叠
                is_elec1 = e1.course.is_elective if e1.course else False
                is_elec2 = e2.course.is_elective if e2.course else False
                if is_elec1 and is_elec2:
                    continue

                add([e1.id, e2.id], "group_double_booking", "error",
                    f"Group {e1.group.group_code} has overlapping classes on {day}",
                    {"group": e1.group.group_code, "day": day, "time_slot": _slot_label(e1),
                     "courses": [_course_code(e1), _course_code(e2)]})

    # 4. Room capacity overflow
    for e in entries:
        if not e.room_id:
            continue
        room = rooms.get(e.room_id)
        if not room:
            continue
        total = _required_seats(e)
        if total > room.capacity:
            add([e.id], "capacity_overflow", "warning",
                f"Room {room.room_code} capacity {room.capacity} < required {total}",
                {"room": room.room_code, "capacity": room.capacity,
                 "required": total, "excess": total - room.capacity,
                 "course": _course_code(e)})

    # 5. Room type mismatch
    for e in entries:
        if not e.room_id or not e.session_type:
            continue
        room = rooms.get(e.room_id)
        if not room:
            continue
        allowed = REQUIRED_ROOM_TYPES.get(e.session_type, [])
        if allowed and room.room_type not in allowed:
            add([e.id], "wrong_room_type", "warning",
                f"{_course_code(e)} ({e.session_type}) in {room.room_type} '{room.room_code}'",
                {"room": room.room_code, "room_type": room.room_type,
                 "session_type": e.session_type, "course": _course_code(e)})

    # 6. Equipment mismatch
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
            add([e.id], "gear_mismatch", "warning",
                f"Room {room.room_code} missing: {'; '.join(missing_groups)}",
                {"room": room.room_code, "missing": missing_groups,
                 "course": _course_code(e)})

    # 7. Teacher availability violation
    for e in entries:
        if not e.teacher_id:
            continue
        avail = teacher_avail.get(e.teacher_id)
        if not avail:
            continue
        slot_label = _slot_label(e)
        if not slot_label:
            continue
        status = avail.get(e.day, {}).get(slot_label, "neutral")
        if status == "blocked":
            add([e.id], "teacher_unavailable", "error",
                f"Teacher {_teacher_name(e)} is unavailable {e.day} {slot_label}",
                {"teacher": _teacher_name(e), "day": e.day,
                 "time_slot": slot_label, "course": _course_code(e)})

    # 8. Teacher weekly hours exceed
    teacher_hours = {}
    for e in entries:
        if e.teacher_id:
            teacher_hours[e.teacher_id] = teacher_hours.get(e.teacher_id, 0) + 1
    for tid, hours in teacher_hours.items():
        t = teachers.get(tid)
        if t and hours > t.max_weekly_hours:
            ids = [e.id for e in entries if e.teacher_id == tid]
            add(ids, "teacher_overload", "error",
                f"Teacher {t.full_name} has {hours}h > max {t.max_weekly_hours}h",
                {"teacher": t.full_name, "hours": hours, "max": t.max_weekly_hours})

    # 9. Teacher qualification mismatch
    for e in entries:
        if not e.teacher_id or not e.course:
            continue
        t = teachers.get(e.teacher_id)
        if not t or not t.qualified_subjects:
            continue
        subjects = [s.strip().lower() for s in t.qualified_subjects.split(",")]
        cname = (e.course.course_name or "").lower()
        if not any(s in cname or cname in s for s in subjects):
            add([e.id], "teacher_unqualified", "warning",
                f"Teacher {t.full_name} may not be qualified for {_course_code(e)}",
                {"teacher": t.full_name, "course": _course_code(e)})

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
    active = get_active_semester(db)
    slots = get_active_slots(db)

    if active:
        entries = db.query(ScheduleEntry).filter_by(semester_id=active.id).all()
    else:
        entries = []

    conflict_info = scan_conflicts(db)
    conflicting_ids = set(conflict_info["conflicting_entry_ids"])

    cell_map = {}
    for e in entries:
        label = _slot_label(e)
        if not label:
            continue
        key = f"{e.day}|{label}"
        cell_map.setdefault(key, []).append({
            "id": e.id,
            "course_code": _course_code(e),
            "session_type": e.session_type,
            "room_code": _room_code(e),
            "teacher_name": _teacher_name(e),
            "target_groups": _group_code(e),  # 现在会带出 "-1", "-2" 子组
            "has_conflict": e.id in conflicting_ids,
        })

    grid_data = []
    for day in DAYS:
        for slot in slots:
            key = f"{day}|{slot}"
            grid_data.append({
                "day": day,
                "time_slot": slot,
                "entries": cell_map.get(key, []),
            })

    return {
        "days": DAYS,
        "time_slots": slots,
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
    slots = get_active_slots(db)
    entry = db.query(ScheduleEntry).filter_by(id=entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    if data.day not in DAYS:
        raise HTTPException(status_code=400, detail="Invalid day")
    if data.time_slot not in slots:
        raise HTTPException(status_code=400, detail="Invalid time slot")

    slot = db.query(TimeSlot).filter_by(slot_label=data.time_slot).first()
    if not slot:
        raise HTTPException(status_code=400, detail="Time slot not found in DB")

    entry.day = data.day
    entry.time_slot_id = slot.id

    if data.room_id is not None:
        room = db.query(Room).filter_by(id=data.room_id).first()
        if not room:
            raise HTTPException(status_code=400, detail="Room not found")
        entry.room_id = room.id

    db.commit()
    log_event(db, admin.id, "entry_moved", True, f"entry_id={entry_id}")
    return {"message": "Entry moved successfully", "scan": scan_conflicts(db)}


class CreateEntryRequest(BaseModel):
    day: str
    time_slot: str
    course_id: int
    session_type: str
    room_id: int
    teacher_id: int | None = None
    group_id: int | None = None
    sub_group: str | None = None  # ★ 新增
    semester_id: int | None = None


@router.post("/entries")
def create_entry(
        data: CreateEntryRequest,
        admin: User = Depends(require_role("admin")),
        db: Session = Depends(get_db),
):
    slot = db.query(TimeSlot).filter_by(slot_label=data.time_slot).first()
    if not slot:
        raise HTTPException(status_code=400, detail="Time slot not found")

    entry = ScheduleEntry(
        day=data.day,
        time_slot_id=slot.id,
        course_id=data.course_id,
        session_type=data.session_type,
        room_id=data.room_id,
        teacher_id=data.teacher_id,
        group_id=data.group_id,
        sub_group=data.sub_group,  # ★ 写入
        semester_id=data.semester_id,
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
    a = db.query(ScheduleEntry).filter_by(id=data.entry_id_a).first()
    b = db.query(ScheduleEntry).filter_by(id=data.entry_id_b).first()
    if not a or not b:
        raise HTTPException(status_code=404, detail="One or both entries not found")

    a.day, b.day = b.day, a.day
    a.time_slot_id, b.time_slot_id = b.time_slot_id, a.time_slot_id
    a.room_id, b.room_id = b.room_id, a.room_id

    db.commit()
    log_event(db, admin.id, "entry_swapped", True,
              f"{data.entry_id_a} <-> {data.entry_id_b}")
    return {"message": "Entries swapped", "scan": scan_conflicts(db)}