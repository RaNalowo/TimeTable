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
from services.time_slots import get_active_slots

router = APIRouter(prefix="/generator", tags=["generator"])

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]

# Default fallback — will be replaced at runtime by database values
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

# Room type requirements per session type
REQUIRED_ROOM_TYPES = {
    "lecture":  ["Lecture Hall", "Regular Classroom", "Seminar Room"],
    "practice": ["Seminar Room", "Regular Classroom", "Lecture Hall"],
    "lab":      ["Computer Lab", "Physics Lab"],
}

# Equipment requirements per session type (OR-group)
REQUIRED_EQUIPMENT_GROUPS = {
    "lecture":  [],
    "practice": [],
    "lab":      [["PCs", "Lab Kits"]],
}


# ---------- Scoring helpers ----------
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


# ---------- Target group resolution ----------
def resolve_target_groups(db, raw_groups, semester_level=None):
    """
    Expand program names into concrete student groups.

    If semester_level contains "Year N", only groups of that year
    are matched (so a Year 1 course doesn't get assigned to Year 4).
    """
    import re

    all_groups = db.query(StudentGroup).all()
    by_code = {g.group_code: g for g in all_groups}

    # Extract target year (e.g. "Year 1 Fall" -> 1)
    target_year = None
    if semester_level:
        m = re.search(r"Year\s*(\d)", semester_level)
        if m:
            target_year = int(m.group(1))

    resolved = []
    for token in raw_groups:
        token = token.strip()
        if not token:
            continue

        if token in by_code:
            resolved.append(token)
        else:
            matched = [
                g.group_code for g in all_groups
                if g.program == token
                and (target_year is None or g.year == target_year)
            ]
            if matched:
                resolved.extend(matched)
            else:
                # Fallback: same program, any year
                fallback = [g.group_code for g in all_groups if g.program == token]
                resolved.extend(fallback if fallback else [token])

    return sorted(set(resolved))


# ---------- Helpers ----------
def expand_sessions(courses, db):
    """
    Each course expands into individual sessions.
    Program names in target_groups are expanded into concrete
    student groups, filtered by the course's year level.
    """
    sessions = []

    for c in courses:
        raw = [g.strip() for g in (c.target_groups or "").split(",") if g.strip()]
        concrete_groups = resolve_target_groups(db, raw, c.semester_level)

        if not concrete_groups:
            continue

        for group in concrete_groups:
            base = {
                "course_id": c.id,
                "course_code": c.course_code,
                "course_name": c.course_name,
                "target_groups": [group],
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
    allowed = REQUIRED_ROOM_TYPES.get(session_type, [])
    if allowed and room.room_type not in allowed:
        return False

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
    global SLOTS
    t0 = time.time()
    TIMEOUT_SECONDS = 30

    # ---- Load active time slots from the database ----
    SLOTS = get_active_slots(db)

    log = []
    log.append(f"Using {len(SLOTS)} time slots: {', '.join(SLOTS)}")
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

    sessions = expand_sessions(courses, db)
    total_sessions = len(sessions)
    log.append(f"Expanded {len(courses)} courses into {total_sessions} sessions.")
    log.append(f"Timeout set to {TIMEOUT_SECONDS}s.")

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

    # Soft constraint weights
    soft_rows = {c.constraint_key: c for c in db.query(SoftConstraint).all()}

    def get_weight(key):
        row = soft_rows.get(key)
        if not row or not row.is_enabled:
            return 0
        return row.weight

    w_gaps = get_weight("minimize_gaps")
    w_early = get_weight("avoid_early_mornings")
    w_late = get_weight("avoid_late_evenings")
    w_compact = get_weight("compact_days")

    log.append(
        f"Soft weights: gaps={w_gaps}, early={w_early}, "
        f"late={w_late}, compact={w_compact}"
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
    day_load = {d: 0 for d in DAYS}

    placed = []
    failed = []
    timed_out = False

    for idx, session in enumerate(sessions):
        # Timeout check every 20 sessions
        if idx % 20 == 0 and (time.time() - t0) > TIMEOUT_SECONDS:
            timed_out = True
            remaining = sessions[idx:]
            failed.extend(remaining)
            log.append(
                f"[TIMEOUT] Reached {TIMEOUT_SECONDS}s limit after placing "
                f"{len(placed)} sessions. {len(remaining)} sessions skipped."
            )
            break

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

                        # ---------- Soft penalty (weighted) ----------
                        p = 0.0

                        # Daily load balance
                        p += day_load[day] * 4

                        # Early morning penalty
                        if slot == SLOTS[0]:
                            p += 20 * (w_early / 10)

                        # Late evening penalty
                        if slot == SLOTS[-1]:
                            p += 20 * (w_late / 10)

                        # Minimize gaps
                        if w_gaps > 0:
                            current_idx = SLOTS.index(slot)
                            for g in session["target_groups"]:
                                taken = [
                                    SLOTS.index(s)
                                    for (d, s) in group_slots.get(g, set())
                                    if d == day and s in SLOTS
                                ]
                                if taken:
                                    min_dist = min(abs(current_idx - t) for t in taken)
                                    if min_dist > 1:
                                        p += 15 * (w_gaps / 10)

                        # Compact days
                        if w_compact > 0:
                            for g in session["target_groups"]:
                                group_days = set(
                                    d for (d, s) in group_slots.get(g, set())
                                )
                                if group_days and day not in group_days:
                                    p += 10 * (w_compact / 10)

                        # Teacher preferred time bonus
                        if teacher.id in teacher_avail:
                            pref = teacher_avail[teacher.id].get(day, {}).get(slot, "neutral")
                            if pref == "preferred":
                                p -= 5

                        if p < best_penalty:
                            best_penalty = p
                            best = (day, slot, room, teacher)
                            if p <= -1:
                                break
                    if best and best_penalty <= -1:
                        break
                if best and best_penalty <= -1:
                    break
            if best and best_penalty <= -1:
                break

        if not best:
            failed.append(session)
            log.append(
                f"[FAIL] {session['course_code']} ({session['session_type']}) "
                f"[{', '.join(session['target_groups'])}] — no valid placement found"
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
        day_load[day] += 1

        log.append(
            f"[OK] {session['course_code']} ({session['session_type']}) → "
            f"{day} {slot}, room {room.room_code}, teacher {teacher.full_name} "
            f"[{', '.join(session['target_groups'])}]"
        )

    elapsed = round(time.time() - t0, 3)
    log.append(f"Generation finished in {elapsed}s")
    log.append(f"Placed: {len(placed)}, Failed: {len(failed)}")

    # Compute final soft-constraint score
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

    if timed_out or failed:
        status = "partial"
    else:
        status = "success"

    return {
        "status": status,
        "placed_count": len(placed),
        "failed_count": len(failed),
        "total_sessions": total_sessions,
        "timed_out": timed_out,
        "elapsed_seconds": elapsed,
        "score": score,
        "score_breakdown": breakdown,
        "log": log,
        "entries": placed,
        "failed_sessions": [
            {"course_code": s["course_code"], "session_type": s["session_type"]}
            for s in failed[:50]
        ],
    }


# ---------- Routes ----------
@router.post("/generate")
def run_generation(
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    db.query(ScheduleEntry).delete()
    db.commit()

    result = generate(db)

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