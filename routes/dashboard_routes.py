import json
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import (
    User, ScheduleEntry, Room, Course, StudentGroup, Teacher,
    SoftConstraint, StudentGroup as SG
)
from routes.auth_routes import get_current_user
from routes.conflict_routes import scan_conflicts

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
SLOTS = [
    "08:30-09:20",
    "09:30-10:20",
    "10:30-11:20",
    "11:30-12:20",
    "12:30-13:20",
    "13:30-14:20",
    "14:30-15:20",
    "15:30-16:20",
    "16:30-17:20",
    "17:30-18:20",
]

def today_abbrev():
    wd = datetime.now().weekday()   # 0=Mon ... 6=Sun
    if wd >= 5:
        return "Mon"
    return DAYS[wd]


def _score_schedule(entries):
    """Reuse the soft-constraint scoring logic to compute a live score."""
    soft_rows = {c.constraint_key: c for c in (
        []
    )}

    def penalty_minimize_gaps(entries):
        groups = {}
        for e in entries:
            for g in (e.target_groups or "").split(","):
                g = g.strip()
                if not g:
                    continue
                groups.setdefault((g, e.day), []).append(e.time_slot)
        total = 0
        for _, slots in groups.items():
            if len(slots) < 2:
                continue
            idxs = sorted(SLOTS.index(s) for s in slots if s in SLOTS)
            if len(idxs) < 2:
                continue
            span = idxs[-1] - idxs[0] + 1
            total += (span - len(idxs))
        return min(total * 15, 100)

    def penalty_early(entries):
        return min(sum(1 for e in entries if e.time_slot == SLOTS[0]) * 20, 100)

    def penalty_late(entries):
        return min(sum(1 for e in entries if e.time_slot == SLOTS[-1]) * 20, 100)

    def penalty_compact(entries):
        groups = {}
        for e in entries:
            for g in (e.target_groups or "").split(","):
                g = g.strip()
                if not g:
                    continue
                groups.setdefault(g, set()).add(e.day)
        excess = sum(max(0, len(days) - 3) for days in groups.values())
        return min(excess * 25, 100)

    fns = {
        "minimize_gaps": penalty_minimize_gaps,
        "avoid_early_mornings": penalty_early,
        "avoid_late_evenings": penalty_late,
        "compact_days": penalty_compact,
    }
    return fns


def _compute_live_score(db, entries):
    soft_rows = {c.constraint_key: c for c in db.query(SoftConstraint).all()}
    fns = _score_schedule(entries)
    total_penalty = 0
    breakdown = []
    for key, fn in fns.items():
        row = soft_rows.get(key)
        if not row or not row.is_enabled or row.weight == 0:
            continue
        raw = fn(entries)
        weighted = raw * row.weight / 10
        total_penalty += weighted
        breakdown.append({
            "constraint_key": key,
            "display_name": row.display_name,
            "weight": row.weight,
            "raw_penalty": raw,
            "weighted_penalty": round(weighted, 2),
        })
    return {
        "score": max(0, round(100 - total_penalty, 2)),
        "breakdown": breakdown,
    }


@router.get("/summary")
def summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    roles = [r.name for r in user.roles]
    today = today_abbrev()

    all_entries = db.query(ScheduleEntry).all()
    total_sessions = len(all_entries)

    # ----- common cards -----
    today_entries = [e for e in all_entries if e.day == today]

    # Next lecture = 当天第一条
    next_room = "-"
    if today_entries:
        # 按 time_slot 排序取第一条
        today_sorted = sorted(today_entries, key=lambda e: SLOTS.index(e.time_slot) if e.time_slot in SLOTS else 99)
        next_room = today_sorted[0].room_code or "-"

    # Timetable status
    if total_sessions == 0:
        status = "Not Generated"
    else:
        conflict_info = scan_conflicts(db)
        status = "Draft Ready" if conflict_info["error_count"] == 0 else "Has Conflicts"

    # Active conflicts count
    conflict_info = scan_conflicts(db)

    # Room utilization (used slots / total available)
    total_rooms = db.query(Room).count()
    total_slots = len(DAYS) * len(SLOTS) * max(total_rooms, 1)
    used_slots = len(set((e.room_id, e.day, e.time_slot) for e in all_entries if e.room_id))
    utilization = round(used_slots / total_slots * 100, 1) if total_slots else 0

    # Live score
    live = _compute_live_score(db, all_entries)

    base = {
        "user": {
            "full_name": user.full_name,
            "email": user.email,
            "roles": roles,
        }
    }

    cards = {
        "today_classes": len(today_entries),
        "next_room": next_room,
        "pending_requests": 0,   # 补课模块未做，固定 0
        "timetable_status": status,
    }

    if "admin" in roles:
        base["role"] = "admin"
        base["cards"] = cards
        base["admin"] = {
            "generation_status": "Completed" if total_sessions > 0 else "Not Started",
            "constraint_score": live["score"],
            "active_conflicts": conflict_info["error_count"],
            "utilization": utilization,
        }

    elif "teacher" in roles:
        base["role"] = "teacher"
        base["cards"] = cards

        # 用 email 找到对应教师
        teacher = db.query(Teacher).filter(Teacher.email == user.email).first()
        if teacher:
            teacher_entries = [e for e in all_entries if e.teacher_id == teacher.id]
            weekly_hours = len(teacher_entries)
            rooms = sorted(set(e.room_code for e in teacher_entries if e.room_code))
            groups = set()
            for e in teacher_entries:
                for g in (e.target_groups or "").split(","):
                    g = g.strip()
                    if g:
                        groups.add(g)

            weekly_schedule = [
                {
                    "day": e.day,
                    "time": e.time_slot,
                    "course": e.course_code,
                    "room": e.room_code,
                    "group": e.target_groups,
                }
                for e in sorted(teacher_entries, key=lambda x: (DAYS.index(x.day) if x.day in DAYS else 99, SLOTS.index(x.time_slot) if x.time_slot in SLOTS else 99))
            ]
        else:
            weekly_hours = 0
            rooms = []
            groups = []
            weekly_schedule = []

        base["teacher"] = {
            "weekly_hours": weekly_hours,
            "rooms": rooms,
            "groups": list(groups),
            "weekly_schedule": weekly_schedule,
        }

    else:
        # student — 用 student_id 或 email 找不到 group 时的兜底
        base["role"] = "student"
        base["cards"] = cards

        today_schedule = [
            {
                "time": e.time_slot,
                "course": e.course_code,
                "room": e.room_code,
                "teacher": e.teacher_name,
            }
            for e in sorted(today_entries, key=lambda x: SLOTS.index(x.time_slot) if x.time_slot in SLOTS else 99)
        ]

        # Next lecture
        next_lecture = None
        if today_schedule:
            first = today_schedule[0]
            next_lecture = {
                "course": first["course"],
                "time": first["time"],
                "room": first["room"],
            }

        base["student"] = {
            "today_schedule": today_schedule,
            "next_lecture": next_lecture or {
                "course": "-", "time": "-", "room": "-"
            },
        }

    return base