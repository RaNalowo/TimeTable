import json
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import (
    Course, Room, Teacher, StudentGroup, TeacherAvailability,
    Constraint, SoftConstraint, User, ScheduleEntry
)
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event

router = APIRouter(prefix="/generator", tags=["generator"])

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

# Equipment requirements per session type.
# Each inner list is an OR-group — at least one keyword must be present.
REQUIRED_EQUIPMENT_GROUPS = {
    "lecture":  [],
    "practice": [],
    "lab":      [["PCs", "Lab Kits"]],
}


# ---------- Scoring helpers (reuse soft constraint logic) ----------
def penalty_minimize_gaps(entries):
    groups = {}
    for e in entries:
        for g in (e["target_groups"] or "").split(","):
            g = g.strip()
            if not g:
                continue
            groups.setdefault((g, e["day"]), []).append(e["time_slot"])
    total = 0
    for _, slots in groups.items():
        if len(slots) < 2:
            continue
        idxs = sorted(SLOTS.index(s) for s in slots if s in SLOTS)
        span = idxs[-1] - idxs[0] + 1
        total += (span - len(idxs))
    return min(total * 15, 100)


def penalty_avoid_early_mornings(entries):
    return min(sum(1 for e in entries if e["time_slot"] == SLOTS[0]) * 20, 100)


def penalty_avoid_late_evenings(entries):
    return min(sum(1 for e in entries if e["time_slot"] == SLOTS[-1]) * 20, 100)


def penalty_compact_days(entries):
    groups = {}
    for e in entries:
        for g in (e["target_groups"] or "").split(","):
            g = g.strip()
            if not g:
                continue
            groups.setdefault(g, set()).add(e["day"])
    excess = sum(max(0, len(days) - 3) for days in groups.values())
    return min(excess * 25, 100)


PENALTY_FNS = {
    "minimize_gaps": penalty_minimize_gaps,
    "avoid_early_mornings": penalty_avoid_early_mornings,
    "avoid_late_evenings": penalty_avoid_late_evenings,
    "compact_days": penalty_compact_days,
}


# ---------- Helpers ----------
def expand_sessions(courses):
    """Each course expands into individual sessions by hour type."""
    sessions = []
    for c in courses:
        target_groups = [g.strip() for g in (c.target_groups or "").split(",") if g.strip()]
        base = {
            "course_id": c.id,
            "course_code": c.course_code,
            "course_name": c.course_name,
            "target_groups": target_groups,
            "department": c.department,
        }
        for _ in range(c.lecture_hours or 0):
            sessions.append({**base, "session_type": "lecture"})
        for _ in range(c.practice_hours or 0):
            sessions.append({**base, "session_type": "practice"})
        for _ in range(c.lab_hours or 0):
            sessions.append({**base, "session_type": "lab"})
    return sessions


def room_matches_session(room, session_type):
    # 1. Room type check
    allowed = REQUIRED_ROOM_TYPES.get(session_type, [])
    if allowed and room.room_type not in allowed:
        return False

    # 2. Equipment check
    groups = REQUIRED_EQUIPMENT_GROUPS.get(session_type, [])
    equip_lower = (room.equipment or "").lower()
    for group in groups:
        if not any(kw.lower() in equip_lower for kw in group):
            return False

    return True


def teacher_qualified(teacher, course_name):
    if not teacher.qualified_subjects:
        return False
    subjects = [s.strip().lower() for s in teacher.qualified_subjects.split(",")]
    name = course_name.lower()
    return any(s in name or name in s for s in subjects)


def slot_overlaps_lunch(slot, lunch_start, lunch_end):
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


# ---------- Main generator ----------
def generate(db):
    t0 = time.time()
    log = []
    log.append("Loading input data...")

    courses = db.query(Course).all()
    rooms = db.query(Room).all()
    teachers = db.query(Teacher).all()
    groups = db.query(StudentGroup).all()
    group_sizes = {g.group_code: g.student_count for g in groups}

    if not courses or not rooms or not teachers:
        raise HTTPException(
            status_code=400,
            detail="Missing required data (courses, rooms, or teachers).",
        )

    sessions = expand_sessions(courses)
    log.append(f"Expanded {len(courses)} courses into {len(sessions)} sessions.")

    # Sort: labs first (most constrained), then bigger groups
    sessions.sort(key=lambda s: (
        0 if s["session_type"] == "lab" else 1,
        -len(s["target_groups"]),
    ))

    # Hard constraints
    hard = {c.constraint_type: c for c in db.query(Constraint).all()}
    lunch_cfg = None
    if hard.get("lunch_break") and hard["lunch_break"].is_active:
        lunch_cfg = json.loads(hard["lunch_break"].config_json or "{}")
        log.append(
            f"Lunch break active: {lunch_cfg.get('start')}-{lunch_cfg.get('end')}"
        )

    # Teacher availability
    user_by_email = {u.email: u.id for u in db.query(User).all()}
    avail_by_uid = {
        a.user_id: json.loads(a.matrix_json)
        for a in db.query(TeacherAvailability).all()
    }
    teacher_avail = {}
    for t in teachers:
        uid = user_by_email.get(t.email)
        if uid and uid in avail_by_uid:
            teacher_avail[t.id] = avail_by_uid[uid]

    # State trackers
    room_slots = {r.id: set() for r in rooms}
    teacher_slots = {t.id: set() for t in teachers}
    group_slots = {g.group_code: set() for g in groups}
    teacher_hours = {t.id: 0 for t in teachers}
    teacher_daily = {t.id: {d: 0 for d in DAYS} for t in teachers}

    placed = []
    failed = []

    for session in sessions:
        required_seats = sum(group_sizes.get(g, 0) for g in session["target_groups"])

        best = None
        best_penalty = float("inf")

        for day in DAYS:
            for slot in SLOTS:
                for room in rooms:
                    if not room_matches_session(room, session["session_type"]):
                        continue
                    if room.capacity < required_seats:
                        continue
                    if (day, slot) in room_slots[room.id]:
                        continue

                    for teacher in teachers:
                        if not teacher_qualified(teacher, session["course_name"]):
                            continue
                        if (day, slot) in teacher_slots[teacher.id]:
                            continue
                        if teacher_hours[teacher.id] >= teacher.max_weekly_hours:
                            continue
                        if teacher_daily[teacher.id][day] >= teacher.max_daily_hours:
                            continue

                        if teacher.id in teacher_avail:
                            st = teacher_avail[teacher.id].get(day, {}).get(slot, "neutral")
                            if st == "blocked":
                                continue

                        group_busy = False
                        for g in session["target_groups"]:
                            if (day, slot) in group_slots.get(g, set()):
                                group_busy = True
                                break
                        if group_busy:
                            continue

                        if lunch_cfg and day in lunch_cfg.get("days", []):
                            if slot_overlaps_lunch(slot, lunch_cfg["start"], lunch_cfg["end"]):
                                continue

                        # Soft penalty for this candidate slot
                        p = 0
                        if slot == SLOTS[0]:
                            p += 20
                        if slot == SLOTS[-1]:
                            p += 20

                        if p < best_penalty:
                            best_penalty = p
                            best = (day, slot, room, teacher)
                            if p == 0:
                                break
                    if best and best_penalty == 0:
                        break
                if best and best_penalty == 0:
                    break
            if best and best_penalty == 0:
                break

        if not best:
            failed.append(session)
            log.append(
                f"[FAIL] {session['course_code']} ({session['session_type']}) "
                f"— no valid placement found"
            )
            continue

        day, slot, room, teacher = best
        placed.append({
            "day": day,
            "time_slot": slot,
            "room_id": room.id,
            "room_code": room.room_code,
            "teacher_id": teacher.id,
            "teacher_name": teacher.full_name,
            "course_id": session["course_id"],
            "course_code": session["course_code"],
            "course_name": session["course_name"],
            "session_type": session["session_type"],
            "target_groups": ", ".join(session["target_groups"]),
        })

        room_slots[room.id].add((day, slot))
        teacher_slots[teacher.id].add((day, slot))
        for g in session["target_groups"]:
            group_slots.setdefault(g, set()).add((day, slot))
        teacher_hours[teacher.id] += 1
        teacher_daily[teacher.id][day] += 1

        log.append(
            f"[OK] {session['course_code']} ({session['session_type']}) → "
            f"{day} {slot}, room {room.room_code}, teacher {teacher.full_name}"
        )

    elapsed = round(time.time() - t0, 3)
    log.append(f"Generation finished in {elapsed}s")
    log.append(f"Placed: {len(placed)}, Failed: {len(failed)}")

    # Compute soft-constraint score
    soft_rows = {c.constraint_key: c for c in db.query(SoftConstraint).all()}
    breakdown = []
    total_penalty = 0
    for key, fn in PENALTY_FNS.items():
        row = soft_rows.get(key)
        if not row or not row.is_enabled or row.weight == 0:
            continue
        raw = fn(placed)
        weighted = raw * row.weight / 10
        total_penalty += weighted
        breakdown.append({
            "constraint_key": key,
            "display_name": row.display_name,
            "weight": row.weight,
            "raw_penalty": raw,
            "weighted_penalty": round(weighted, 2),
        })

    score = max(0, round(100 - total_penalty, 2))

    return {
        "status": "success" if not failed else "partial",
        "placed_count": len(placed),
        "failed_count": len(failed),
        "elapsed_seconds": elapsed,
        "score": score,
        "score_breakdown": breakdown,
        "log": log,
        "entries": placed,
        "failed_sessions": [
            {"course_code": s["course_code"], "session_type": s["session_type"]}
            for s in failed
        ],
    }


# ---------- Routes ----------
@router.post("/generate")
def run_generation(
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    # Clear previous entries
    db.query(ScheduleEntry).delete()
    db.commit()

    result = generate(db)

    # Persist entries
    for e in result["entries"]:
        db.add(ScheduleEntry(
            day=e["day"],
            time_slot=e["time_slot"],
            course_id=e["course_id"],
            course_code=e["course_code"],
            session_type=e["session_type"],
            room_id=e["room_id"],
            room_code=e["room_code"],
            teacher_id=e["teacher_id"],
            teacher_name=e["teacher_name"],
            target_groups=e["target_groups"],
        ))
    db.commit()

    log_event(
        db, admin.id, "timetable_generated", True,
        f"placed={result['placed_count']} failed={result['failed_count']} score={result['score']}"
    )

    return result


@router.get("/entries")
def list_entries(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entries = db.query(ScheduleEntry).all()
    return [
        {
            "id": e.id,
            "day": e.day,
            "time_slot": e.time_slot,
            "course_code": e.course_code,
            "session_type": e.session_type,
            "room_code": e.room_code,
            "teacher_name": e.teacher_name,
            "target_groups": e.target_groups,
        }
        for e in entries
    ]