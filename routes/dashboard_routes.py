from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import (
    User, ScheduleEntry, Room, Course, StudentGroup, Teacher, SoftConstraint,
)
from routes.auth_routes import get_current_user
from routes.conflict_routes import scan_conflicts
from services.time_slots import get_active_slots
from services.semester_logic import get_active_semester

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]


# ---------- Relationship-safe accessors ----------

def _slot_label(e):
    return e.time_slot.slot_label if e.time_slot else None

def _room_code(e):
    return e.room.room_code if e.room else None

def _course_code(e):
    return e.course.course_code if e.course else None

def _teacher_name(e):
    return e.teacher.full_name if e.teacher else None

def _group_code(e):
    return e.group.group_code if e.group else None


def today_abbrev():
    wd = datetime.now().weekday()
    if wd >= 5:
        return "Mon"
    return DAYS[wd]


# ---------- Soft scoring (uses DB time slots) ----------

def _compute_live_score(db, entries):
    from services.scoring import score_schedule, saved_entries
    return score_schedule(db, saved_entries(entries))


# ---------- Route ----------

@router.get("/summary")
def summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    active = get_active_semester(db)
    roles = [r.name for r in user.roles]
    today = today_abbrev()
    slots = get_active_slots(db) or []

    # Only entries of the ACTIVE semester
    if active:
        all_entries = db.query(ScheduleEntry).filter_by(semester_id=active.id).all()
    else:
        all_entries = []

    # Personal cards must not include other groups' or teachers' classes.
    if "admin" not in roles:
        if "teacher" in roles:
            teacher = db.query(Teacher).filter((Teacher.user_id == user.id) | (Teacher.email == user.email)).first()
            all_entries = [e for e in all_entries if teacher and e.teacher_id == teacher.id]
        else:
            all_entries = [e for e in all_entries if user.group_id and e.group_id == user.group_id]

    total_sessions = len(all_entries)

    # ---- Common cards ----
    today_entries = [e for e in all_entries if e.day == today]

    next_room = "-"
    if today_entries:
        def slot_idx(e):
            label = _slot_label(e)
            return slots.index(label) if label in slots else 99
        today_sorted = sorted(today_entries, key=slot_idx)
        next_room = _room_code(today_sorted[0]) or "-"

    # Timetable status
    conflict_info = scan_conflicts(db)
    if total_sessions == 0:
        status = "Not Generated"
    else:
        status = "Draft Ready" if conflict_info["error_count"] == 0 else "Has Conflicts"

    # Utilization
    total_rooms = db.query(Room).count()
    total_capacity = len(DAYS) * len(slots) * max(total_rooms, 1)
    used_slots = len(set(
        (e.room_id, e.day, e.time_slot_id)
        for e in all_entries if e.room_id and e.time_slot_id
    ))
    utilization = round(used_slots / total_capacity * 100, 1) if total_capacity else 0

    live = _compute_live_score(db, all_entries)

    base = {
        "user": {
            "full_name": user.full_name,
            "email": user.email,
            "roles": roles,
        },
        "cards": {
            "today_classes": len(today_entries),
            "next_room": next_room,
            "pending_requests": 0,
            "timetable_status": status,
        },
    }

    if "admin" in roles:
        base["role"] = "admin"
        base["admin"] = {
            "generation_status": "Completed" if total_sessions > 0 else "Not Started",
            "constraint_score": live["score"],
            "active_conflicts": conflict_info["error_count"],
            "utilization": utilization,
        }

    elif "teacher" in roles:
        base["role"] = "teacher"
        teacher = db.query(Teacher).filter(Teacher.email == user.email).first()
        teacher_entries = (
            [e for e in all_entries if e.teacher_id == teacher.id]
            if teacher else []
        )
        base["teacher"] = {
            "weekly_hours": len(teacher_entries),
            "rooms": sorted({_room_code(e) for e in teacher_entries if _room_code(e)}),
            "groups": sorted({_group_code(e) for e in teacher_entries if _group_code(e)}),
            "weekly_schedule": [
                {
                    "day": e.day,
                    "time": _slot_label(e),
                    "course": _course_code(e),
                    "room": _room_code(e),
                    "group": _group_code(e),
                }
                for e in teacher_entries
            ],
        }

    else:
        base["role"] = "student"
        base["student"] = {
            "today_schedule": [
                {
                    "time": _slot_label(e),
                    "course": _course_code(e),
                    "room": _room_code(e),
                    "teacher": _teacher_name(e),
                }
                for e in today_entries
            ],
            "next_lecture": (
                {
                    "course": _course_code(today_entries[0]),
                    "time": _slot_label(today_entries[0]),
                    "room": _room_code(today_entries[0]),
                } if today_entries else
                {"course": "-", "time": "-", "room": "-"}
            ),
        }

    return base
