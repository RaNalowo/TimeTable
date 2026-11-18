from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
import json
import math
from typing import Literal

from db.database import get_db
from db.models import (
    ScheduleEntry, Room, StudentGroup, User, Course, Teacher, TimeSlot,
    TeacherAvailability, Semester, Constraint, ChangeRequest
)
from routes.core.auth import get_current_user, require_role
from services.audit import log_event
from services.qualifications import teacher_qualified
from services.scheduling_data import read_availability, read_lunch
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


def _slot_label(e): return e.time_slot.slot_label if e.time_slot else None


def _course_code(e): return e.course.course_code if e.course else None


def _course_name(e): return e.course.course_name if e.course else None


def _room_code(e): return e.room.room_code if e.room else None


def _teacher_name(e): return e.teacher.full_name if e.teacher else None


def _group_code(e):
    if not e.group: return None
    base = e.group.group_code
    if e.sub_group: return f"{base}-{e.sub_group}"
    return base


def _required_seats(e):
    if not e.group: return 0
    if e.sub_group: return math.ceil(e.group.student_count / max(e.group.sub_group_count, 1))
    return e.group.student_count


def scan_conflicts(db, entries=None):
    if entries is None:
        active = get_active_semester(db)
        entries = db.query(ScheduleEntry).filter_by(semester_id=active.id).all() if active else []

    rooms = {r.id: r for r in db.query(Room).all()}
    teachers = {t.id: t for t in db.query(Teacher).all()}

    user_by_email = {u.email: u.id for u in db.query(User).all()}
    avail_by_uid = {}
    for a in db.query(TeacherAvailability).all():
        avail_by_uid[a.user_id] = read_availability(a.matrix_json)
    teacher_avail = {}
    for t in teachers.values():
        uid = t.user_id or user_by_email.get(t.email)
        if uid and uid in avail_by_uid:
            teacher_avail[t.id] = avail_by_uid[uid]

    conflicts = []
    conflicting_ids = set()

    def add(ids, type_, severity, message, details):
        for i in ids: conflicting_ids.add(i)
        conflicts.append(
            {"type": type_, "severity": severity, "message": message, "entry_ids": list(ids), "details": details})

    from routes.master_data.time_slots import parse_slot

    def overlaps(left, right):
        if left.time_slot_id == right.time_slot_id and left.time_slot_id is not None: return True
        a = parse_slot(_slot_label(left) or "")
        b = parse_slot(_slot_label(right) or "")
        return bool(a and b and a[0] < b[1] and b[0] < a[1])

    for field, type_, label_fn in [("room_id", "room_double_booking", _room_code),
                                   ("teacher_id", "teacher_double_booking", _teacher_name)]:
        seen = {}
        for e in entries:
            identifier = getattr(e, field)
            if not identifier: continue
            key = (identifier, e.day)
            for other in seen.get(key, []):
                if overlaps(other, e):
                    add([e.id, other.id], type_, "error", f"{label_fn(e)} double-booked on {e.day} {_slot_label(e)}",
                        {"day": e.day, "time_slot": _slot_label(e), "courses": [_course_code(other), _course_code(e)]})
            seen.setdefault(key, []).append(e)

    group_time_map = {}
    for e in entries:
        if not e.group_id: continue
        key = (e.group_id, e.day)
        group_time_map.setdefault(key, []).append(e)

    for (_, day), elist in group_time_map.items():
        if len(elist) <= 1: continue
        for i in range(len(elist)):
            for j in range(i + 1, len(elist)):
                e1, e2 = elist[i], elist[j]
                if not overlaps(e1, e2): continue
                sub1, sub2 = e1.sub_group, e2.sub_group
                is_conflict = False
                if sub1 is None or sub2 is None:
                    is_conflict = True
                elif sub1 == sub2:
                    is_conflict = True
                if not is_conflict: continue
                if (e1.course.is_elective if e1.course else False) and (
                        e2.course.is_elective if e2.course else False): continue
                add([e1.id, e2.id], "group_double_booking", "error",
                    f"Group {e1.group.group_code} has overlapping classes on {day}",
                    {"group": e1.group.group_code, "day": day, "time_slot": _slot_label(e1),
                     "courses": [_course_code(e1), _course_code(e2)]})

    for e in entries:
        if not e.room_id: continue
        room = rooms.get(e.room_id)
        if not room: continue
        total = _required_seats(e)
        if total > room.capacity:
            add([e.id], "capacity_overflow", "error",
                f"Room {room.room_code} capacity {room.capacity} < required {total}",
                {"room": room.room_code, "capacity": room.capacity, "required": total, "excess": total - room.capacity,
                 "course": _course_code(e)})

    for e in entries:
        if not e.room_id or not e.session_type: continue
        room = rooms.get(e.room_id)
        if not room: continue
        allowed = REQUIRED_ROOM_TYPES.get(e.session_type, [])
        if allowed and room.room_type not in allowed:
            add([e.id], "wrong_room_type", "error",
                f"{_course_code(e)} ({e.session_type}) in {room.room_type} '{room.room_code}'",
                {"room": room.room_code, "room_type": room.room_type, "session_type": e.session_type,
                 "course": _course_code(e)})

    for e in entries:
        if not e.room_id or not e.session_type: continue
        room = rooms.get(e.room_id)
        if not room: continue
        req_groups = REQUIRED_EQUIPMENT_GROUPS.get(e.session_type, [])
        if not req_groups: continue
        equip_lower = (room.equipment or "").lower()
        missing_groups = []
        for group in req_groups:
            if not any(kw.lower() in equip_lower for kw in group): missing_groups.append(" / ".join(group))
        if missing_groups:
            add([e.id], "gear_mismatch", "error", f"Room {room.room_code} missing: {'; '.join(missing_groups)}",
                {"room": room.room_code, "missing": missing_groups, "course": _course_code(e)})

    for e in entries:
        if not e.teacher_id: continue
        avail = teacher_avail.get(e.teacher_id)
        if not avail: continue
        slot_label = _slot_label(e)
        if not slot_label: continue
        if avail.get(e.day, {}).get(slot_label, "neutral") == "blocked":
            add([e.id], "teacher_unavailable", "error",
                f"Teacher {_teacher_name(e)} is unavailable {e.day} {slot_label}",
                {"teacher": _teacher_name(e), "day": e.day, "time_slot": slot_label, "course": _course_code(e)})

    teacher_hours = {}
    for e in entries:
        if e.teacher_id: teacher_hours[e.teacher_id] = teacher_hours.get(e.teacher_id, 0) + 1
    for tid, hours in teacher_hours.items():
        t = teachers.get(tid)
        if t and hours > t.max_weekly_hours:
            add([e.id for e in entries if e.teacher_id == tid], "teacher_overload", "error",
                f"Teacher {t.full_name} has {hours}h > max {t.max_weekly_hours}h",
                {"teacher": t.full_name, "hours": hours, "max": t.max_weekly_hours})

    for e in entries:
        if not e.teacher_id or not e.course: continue
        t = teachers.get(e.teacher_id)
        if not t: continue
        if not teacher_qualified(t, e.course.course_code, e.course.course_name):
            add([e.id], "teacher_unqualified", "error", f"Teacher {t.full_name} is not qualified for {_course_code(e)}",
                {"teacher": t.full_name, "course": _course_code(e)})

    daily = {}
    for e in entries:
        if e.teacher_id: daily.setdefault((e.teacher_id, e.day), []).append(e)
        if (
                e.day not in DAYS or not e.time_slot or not e.time_slot.is_active or not e.course or not e.teacher or not e.room or not e.group):
            add([e.id], "invalid_entry", "error", "Session has missing resources or an invalid day/time slot.", {})

    for (teacher_id, day), items in daily.items():
        teacher = teachers.get(teacher_id)
        if teacher and len(items) > teacher.max_daily_hours:
            add([e.id for e in items], "teacher_daily_overload", "error",
                f"Teacher {teacher.full_name} exceeds daily teaching limit on {day}", {})

    lunch = db.query(Constraint).filter_by(constraint_type="lunch_break", is_active=True).first()
    if lunch:
        from routes.rules.hard_constraints import slot_overlaps_lunch
        cfg = read_lunch(lunch.config_json)
        for e in entries:
            if e.day in cfg["days"] and e.time_slot and slot_overlaps_lunch(e.time_slot.slot_label, cfg["start"],
                                                                            cfg["end"]):
                add([e.id], "lunch_break", "error", f"{_course_code(e)} overlaps the lunch break on {e.day}", {})

    return {
        "conflicts": conflicts, "conflicting_entry_ids": list(conflicting_ids),
        "total_entries": len(entries), "error_count": sum(1 for c in conflicts if c["severity"] == "error"),
        "warning_count": sum(1 for c in conflicts if c["severity"] == "warning"),
    }


@router.get("/scan")
def scan(admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    return scan_conflicts(db)


@router.post("/publish")
def publish_timetable(admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    active = get_active_semester(db)
    if not active:
        raise HTTPException(status_code=400, detail="No active semester.")

    conflict_info = scan_conflicts(db)
    if conflict_info["error_count"] > 0:
        raise HTTPException(status_code=400, detail="Cannot publish a timetable with conflicts. Fix errors first.")

    active.is_published = True
    db.commit()
    log_event(db, admin.id, "timetable_published", True)
    return {"message": "Timetable published successfully."}


@router.get("/grid")
def grid(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    active = get_active_semester(db)
    slots = get_active_slots(db)
    roles = [r.name for r in user.roles]

    is_published = active.is_published if active else False

    if "admin" not in roles and not is_published:
        return {
            "days": DAYS, "time_slots": slots,
            "cells": [{"day": d, "time_slot": s, "entries": []} for d in DAYS for s in slots],
            "conflicts": [], "error_count": 0, "warning_count": 0, "total_entries": 0, "published": False
        }

    entries = db.query(ScheduleEntry).filter_by(semester_id=active.id).all() if active else []

    if "admin" not in roles:
        if "teacher" in roles:
            teacher = db.query(Teacher).filter((Teacher.user_id == user.id) | (Teacher.email == user.email)).first()
            if teacher:
                entries = [e for e in entries if e.teacher_id == teacher.id]
            else:
                entries = []
        elif "student" in roles:
            if user.group_id:
                entries = [
                    e for e in entries
                    if e.group_id == user.group_id and
                       (e.session_type == 'lecture' or e.sub_group == user.sub_group or e.sub_group is None)
                ]
            else:
                entries = []

    conflict_info = scan_conflicts(db)
    conflicting_ids = set(conflict_info["conflicting_entry_ids"])

    cell_map = {}
    for e in entries:
        label = _slot_label(e)
        if not label: continue
        key = f"{e.day}|{label}"
        cell_map.setdefault(key, []).append({
            "id": e.id, "course_code": _course_code(e),
            "course_name": _course_name(e),
            "session_type": e.session_type,
            "room_code": _room_code(e), "teacher_name": _teacher_name(e),
            "target_groups": _group_code(e), "has_conflict": e.id in conflicting_ids,
        })

    grid_data = [{"day": day, "time_slot": slot, "entries": cell_map.get(f"{day}|{slot}", [])} for day in DAYS for slot
                 in slots]

    return {
        "days": DAYS, "time_slots": slots, "cells": grid_data,
        "conflicts": conflict_info["conflicts"], "error_count": conflict_info["error_count"],
        "warning_count": conflict_info["warning_count"], "total_entries": len(entries),
        "published": is_published
    }


class MoveRequest(BaseModel):
    day: Literal["Mon", "Tue", "Wed", "Thu", "Fri"]
    time_slot: str
    room_id: int | None = None


def get_block_entries(db, entry):
    """获取与当前 entry 连堂的所有 entry（同天、同课程、同类型、同组、相邻时间段）"""
    if not entry or not entry.time_slot:
        return [entry]

    all_slots = db.query(TimeSlot).order_by(TimeSlot.sort_order).all()
    slot_order_map = {s.id: s.sort_order for s in all_slots}
    current_order = slot_order_map.get(entry.time_slot_id)
    if current_order is None: return [entry]

    # 找到所有同天的同课程排课
    same_day_entries = db.query(ScheduleEntry).filter_by(
        semester_id=entry.semester_id,
        course_id=entry.course_id,
        session_type=entry.session_type,
        group_id=entry.group_id,
        teacher_id=entry.teacher_id,
        sub_group=entry.sub_group,
        day=entry.day
    ).all()

    block = [entry]
    # 向前面找相邻的
    curr = current_order
    while True:
        prev = next((e for e in same_day_entries if slot_order_map.get(e.time_slot_id) == curr - 1), None)
        if prev and prev not in block:
            block.insert(0, prev)
            curr -= 1
        else:
            break

    # 向后面找相邻的
    curr = current_order
    while True:
        nxt = next((e for e in same_day_entries if slot_order_map.get(e.time_slot_id) == curr + 1), None)
        if nxt and nxt not in block:
            block.append(nxt)
            curr += 1
        else:
            break

    return block


@router.put("/entries/{entry_id}")
def move_entry(entry_id: int, data: MoveRequest, admin: User = Depends(require_role("admin")),
               db: Session = Depends(get_db)):
    entry = db.query(ScheduleEntry).filter_by(id=entry_id).first()
    if not entry: raise HTTPException(status_code=404, detail="Entry not found")
    if data.day not in DAYS: raise HTTPException(status_code=400, detail="Invalid day")

    target_slot = db.query(TimeSlot).filter_by(slot_label=data.time_slot, is_active=True).first()
    if not target_slot: raise HTTPException(status_code=400, detail="Time slot not found")
    if data.room_id is not None and db.get(Room, data.room_id) is None:
        raise HTTPException(status_code=400, detail="Room not found")

    # 获取连堂块
    block_entries = get_block_entries(db, entry)

    all_slots = db.query(TimeSlot).order_by(TimeSlot.sort_order).all()
    slot_order_map = {s.id: s.sort_order for s in all_slots}
    slot_by_order = {s.sort_order: s for s in all_slots}

    target_order = slot_order_map[target_slot.id]
    first_entry_order = slot_order_map[entry.time_slot_id]
    offset = target_order - first_entry_order
    active = get_active_semester(db)

    for b_entry in block_entries:
        old_order = slot_order_map[b_entry.time_slot_id]
        new_order = old_order + offset
        new_slot = slot_by_order.get(new_order)

        if not new_slot:
            raise HTTPException(status_code=400, detail="Not enough time slots left on the grid for this block.")

        # ★ 核心修改：删掉了占用检查，直接移动。哪怕那个格子里已经有一万节课。
        b_entry.day = data.day
        b_entry.time_slot_id = new_slot.id
        if data.room_id is not None:
            b_entry.room_id = data.room_id

    if active:
        active.is_published = False

    db.commit()
    log_event(db, admin.id, "entry_moved", True, f"entry_id={entry_id}, block_size={len(block_entries)}")

    # 返回全局扫描结果，前端刷新后冲突的课会自动变红
    return {"message": "Entry moved successfully", "scan": scan_conflicts(db)}



class CreateEntryRequest(BaseModel):
    day: Literal["Mon", "Tue", "Wed", "Thu", "Fri"]
    time_slot: str
    course_id: int
    session_type: Literal["lecture", "practice", "lab"]
    room_id: int
    teacher_id: int | None = None
    group_id: int | None = None
    sub_group: str | None = None
    semester_id: int | None = None


@router.post("/entries")
def create_entry(data: CreateEntryRequest, admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    active = get_active_semester(db)
    if not active: raise HTTPException(status_code=400, detail="No active semester")
    slot = db.query(TimeSlot).filter_by(slot_label=data.time_slot, is_active=True).first()
    if not slot: raise HTTPException(status_code=400, detail="Active time slot not found")
    for model, identifier, label in [(Course, data.course_id, "Course"), (Room, data.room_id, "Room"),
                                     (Teacher, data.teacher_id, "Teacher"),
                                     (StudentGroup, data.group_id, "Student group")]:
        if identifier is None or db.get(model, identifier) is None:
            raise HTTPException(status_code=400, detail=f"{label} not found")
    group = db.get(StudentGroup, data.group_id)
    if data.session_type == "lecture" and data.sub_group is not None:
        raise HTTPException(status_code=400, detail="Lectures must use the full group")
    if data.session_type != "lecture":
        if not data.sub_group or not data.sub_group.isdigit() or not 1 <= int(data.sub_group) <= group.sub_group_count:
            raise HTTPException(status_code=400, detail="Practice/lab needs a valid subgroup number")

    entry = ScheduleEntry(
        day=data.day, time_slot_id=slot.id, course_id=data.course_id, session_type=data.session_type,
        room_id=data.room_id, teacher_id=data.teacher_id, group_id=data.group_id, sub_group=data.sub_group,
        semester_id=active.id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    log_event(db, admin.id, "entry_created", True, f"entry_id={entry.id}")
    return {"message": "Entry created", "entry_id": entry.id, "scan": scan_conflicts(db)}


@router.delete("/entries/{entry_id}")
def delete_entry(entry_id: int, admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    entry = db.query(ScheduleEntry).filter_by(id=entry_id).first()
    if not entry: raise HTTPException(status_code=404, detail="Entry not found")

    db.delete(entry)

    active = get_active_semester(db)
    if active:
        active.is_published = False

    db.commit()
    log_event(db, admin.id, "entry_deleted", True, f"entry_id={entry_id}")
    return {"message": "Entry deleted", "scan": scan_conflicts(db)}


class SwapRequest(BaseModel):
    entry_id_a: int
    entry_id_b: int


@router.post("/swap")
def swap_entries(data: SwapRequest, admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    a = db.query(ScheduleEntry).filter_by(id=data.entry_id_a).first()
    b = db.query(ScheduleEntry).filter_by(id=data.entry_id_b).first()
    if not a or not b: raise HTTPException(status_code=404, detail="One or both entries not found")
    if a.semester_id != b.semester_id: raise HTTPException(status_code=400,
                                                           detail="Cannot swap sessions from different semesters")

    a.day, b.day = b.day, a.day
    a.time_slot_id, b.time_slot_id = b.time_slot_id, a.time_slot_id
    a.room_id, b.room_id = b.room_id, a.room_id

    active = get_active_semester(db)
    if active:
        active.is_published = False

    db.commit()
    log_event(db, admin.id, "entry_swapped", True, f"{data.entry_id_a} <-> {data.entry_id_b}")
    return {"message": "Entries swapped", "scan": scan_conflicts(db)}


# ============================================================
# Change Requests (US24)
# ============================================================

class ChangeRequestCreate(BaseModel):
    entry_id: int
    reason: str = Field(min_length=3, max_length=500)


class ChangeRequestUpdate(BaseModel):
    status: Literal["approved", "rejected"]
    admin_note: str | None = None


def entries_visible_to(db, user, entries):
    """Which of these schedule entries may this user see? Same rule as the grid."""
    roles = [r.name for r in user.roles]
    if "admin" in roles:
        return list(entries)
    if "teacher" in roles:
        teacher = db.query(Teacher).filter((Teacher.user_id == user.id) | (Teacher.email == user.email)).first()
        return [e for e in entries if teacher and e.teacher_id == teacher.id]
    if "student" in roles and user.group_id:
        return [e for e in entries
                if e.group_id == user.group_id
                and (e.session_type == "lecture" or e.sub_group == user.sub_group or e.sub_group is None)]
    return []


def _class_key(e):
    """A 'class' = all hours of one course/type for one group (and sub-group)."""
    return (e.course_id, e.group_id, e.sub_group, e.session_type)


@router.post("/requests")
def submit_request(data: ChangeRequestCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    roles = [r.name for r in user.roles]
    if "admin" in roles:
        raise HTTPException(status_code=403, detail="Admins edit the timetable directly; requests are for students and teachers.")
    active = get_active_semester(db)
    if not active or not active.is_published:
        raise HTTPException(status_code=400, detail="Requests can only be made for a published timetable.")
    entry = db.query(ScheduleEntry).filter_by(id=data.entry_id, semester_id=active.id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    if entry not in entries_visible_to(db, user, [entry]):
        raise HTTPException(status_code=403, detail="You can only request changes for your own classes.")

    for pending in db.query(ChangeRequest).filter_by(requester_id=user.id, status="pending").all():
        if pending.entry and _class_key(pending.entry) == _class_key(entry):
            raise HTTPException(status_code=400, detail="You already have a pending request for this class.")

    req = ChangeRequest(entry_id=entry.id, requester_id=user.id, reason=data.reason.strip(), status="pending")
    db.add(req)
    db.commit()
    db.refresh(req)
    log_event(db, user.id, "change_request_submitted", True, f"request_id={req.id}, entry_id={entry.id}")
    return {"message": "Request submitted successfully", "request_id": req.id}


@router.get("/requests")
def get_requests(admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    reqs = db.query(ChangeRequest).filter_by(status="pending").order_by(ChangeRequest.created_at.desc()).all()

    result = []
    orphans = []  # ★ 用来收集废弃的请求
    for r in reqs:
        entry = r.entry
        if not entry:
            # ★ 如果这门课已经被删除了（比如重新生成了课表），把这条请求删掉
            orphans.append(r)
            continue

        result.append({
            "id": r.id,
            "entry_id": r.entry_id,
            "requester_name": r.requester.full_name,
            "requester_role": r.requester.roles[0].name if r.requester.roles else "unknown",
            "reason": r.reason,
            "created_at": r.created_at.isoformat(),
            "course_code": _course_code(entry),
            "course_name": _course_name(entry),
            "day": entry.day,
            "time_slot": _slot_label(entry),
            "room_code": _room_code(entry),
            "teacher_name": _teacher_name(entry),
        })

    if orphans:
        for o in orphans:
            db.delete(o)
        db.commit()

    return result


@router.put("/requests/{req_id}")
def update_request(req_id: int, data: ChangeRequestUpdate, admin: User = Depends(require_role("admin")),
                   db: Session = Depends(get_db)):
    req = db.query(ChangeRequest).filter_by(id=req_id).first()
    if not req: raise HTTPException(status_code=404, detail="Request not found")

    if req.status != "pending":
        raise HTTPException(status_code=400, detail="This request has already been decided.")
    req.status = data.status
    req.admin_note = data.admin_note
    db.commit()
    log_event(db, admin.id, "change_request_updated", True, f"request_id={req_id}, status={data.status}")
    return {"message": f"Request {data.status} successfully"}


@router.get("/requests/notifications")
def get_my_notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """获取当前用户已审批但未读的申请结果"""
    reqs = db.query(ChangeRequest).filter(
        ChangeRequest.requester_id == user.id,
        ChangeRequest.status != "pending",
        ChangeRequest.is_read == False
    ).all()

    result = []
    for r in reqs:
        entry = r.entry
        result.append({
            "id": r.id,
            "course_code": _course_code(entry) if entry else "N/A",
            "course_name": _course_name(entry) if entry else "N/A",
            "status": r.status,
            "admin_note": r.admin_note
        })
    return result


@router.put("/requests/{req_id}/read")
def mark_notification_read(req_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """将通知标记为已读"""
    req = db.query(ChangeRequest).filter(
        ChangeRequest.id == req_id,
        ChangeRequest.requester_id == user.id
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Notification not found")

    req.is_read = True
    db.commit()
    return {"message": "Marked as read"}