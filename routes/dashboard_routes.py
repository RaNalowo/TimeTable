from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import User, ScheduleEntry, Room, Course, StudentGroup, Teacher
from routes.auth_routes import get_current_user
from routes.conflict_routes import scan_conflicts
from services.time_slots import get_active_slots
from services.semester_logic import get_active_semester
from services.scoring import score_schedule, saved_entries

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]


def today_abbrev():
    wd = datetime.now().weekday()
    if wd >= 5: return "Mon"
    return DAYS[wd]


def _slot_label(e): return e.time_slot.slot_label if e.time_slot else None


def _room_code(e): return e.room.room_code if e.room else None


def _course_code(e): return e.course.course_code if e.course else None


def _teacher_name(e): return e.teacher.full_name if e.teacher else None


def _group_code(e): return e.group.group_code if e.group else None


@router.get("/summary")
def summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    active = get_active_semester(db)
    roles = [r.name for r in user.roles]
    today = today_abbrev()
    slots = get_active_slots(db) or []

    # 获取当前学期的所有排课
    if active:
        all_entries = db.query(ScheduleEntry).filter_by(semester_id=active.id).all()
    else:
        all_entries = []

    base = {
        "user": {"full_name": user.full_name, "email": user.email, "roles": roles},
    }

    # ================= 👑 管理员视角 =================
    if "admin" in roles:
        conflict_info = scan_conflicts(db)
        total_rooms = db.query(Room).count()
        total_capacity = len(DAYS) * len(slots) * max(total_rooms, 1)
        used_slots = len(set((e.room_id, e.day, e.time_slot_id) for e in all_entries if e.room_id))

        base["role"] = "admin"
        base["admin"] = {
            "total_courses": db.query(Course).count(),
            "total_teachers": db.query(Teacher).count(),
            "total_groups": db.query(StudentGroup).count(),
            "active_conflicts": conflict_info["error_count"],
            "utilization": round(used_slots / total_capacity * 100, 1) if total_capacity else 0,
            "generation_status": "Completed" if len(all_entries) > 0 else "Not Started",
            "constraint_score": score_schedule(db, saved_entries(all_entries))["score"]
        }

    # ================= 👨‍🏫 老师视角 =================
    elif "teacher" in roles:
        teacher = db.query(Teacher).filter((Teacher.user_id == user.id) | (Teacher.email == user.email)).first()
        my_entries = [e for e in all_entries if teacher and e.teacher_id == teacher.id] if teacher else []
        today_entries = [e for e in my_entries if e.day == today]

        # 按时间排序找下一节课
        today_sorted = sorted(
            today_entries,
            key=lambda e: slots.index(_slot_label(e)) if _slot_label(e) in slots else 99
        )

        base["role"] = "teacher"
        base["teacher"] = {
            "weekly_hours": len(my_entries),
            "today_classes": len(today_entries),
            "next_class": {
                "course": _course_code(today_sorted[0]) if today_sorted else "-",
                "room": _room_code(today_sorted[0]) if today_sorted else "-",
                "time": _slot_label(today_sorted[0]) if today_sorted else "-",
            },
            "weekly_schedule": [
                {"day": e.day, "time": _slot_label(e), "course": _course_code(e), "room": _room_code(e),
                 "group": _group_code(e)}
                for e in my_entries
            ]
        }

    # ================= 👨‍🎓 学生视角 =================
    else:
        my_entries = [e for e in all_entries if user.group_id and e.group_id == user.group_id]
        today_entries = [e for e in my_entries if e.day == today]

        today_sorted = sorted(
            today_entries,
            key=lambda e: slots.index(_slot_label(e)) if _slot_label(e) in slots else 99
        )

        base["role"] = "student"
        base["student"] = {
            "today_classes": len(today_entries),
            "next_class": {
                "course": _course_code(today_sorted[0]) if today_sorted else "-",
                "room": _room_code(today_sorted[0]) if today_sorted else "-",
                "time": _slot_label(today_sorted[0]) if today_sorted else "-",
            },
            "today_schedule": [
                {"time": _slot_label(e), "course": _course_code(e), "room": _room_code(e), "teacher": _teacher_name(e)}
                for e in today_sorted
            ]
        }

    return base