import time
import math
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import (
    Course, Room, Teacher, StudentGroup, TeacherAvailability,
    Constraint, SoftConstraint, User, ScheduleEntry,
    TimeSlot,
    Program,
)
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event
from services.scoring import score_schedule
from services.scheduling_data import read_availability, read_lunch
from services.time_slots import get_active_slots
from services.semester_logic import (
    get_active_semester, parse_semester_level, current_year_for_group,
)

router = APIRouter(prefix="/generator", tags=["generator"])

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


# ============================================================
# Scoring helpers
# ============================================================

# ============================================================
# Target group resolution
# ============================================================

def resolve_target_groups(db, course, semester):
    course_year, course_term = parse_semester_level(course.semester_level)
    if course_year is None:
        return []

    if course_term != semester.term:
        return []

    # 直接按 program_id 找组
    groups = db.query(StudentGroup).filter(
        StudentGroup.program_id == course.program_id
    ).all()

    matched = []
    for g in groups:
        # 检查年级
        if current_year_for_group(g, semester) != course_year:
            continue

        # 检查 track（如果课程限制了方向）
        if course.track:
            if g.track != course.track:
                continue

        matched.append(g)

    return matched


# ============================================================
# Helpers
# ============================================================

def expand_sessions(db, courses, semester):
    sessions = []
    for c in courses:
        groups = resolve_target_groups(db, c, semester)
        if not groups:
            continue

        for g in groups:
            base = {
                "course_id": c.id,
                "course_code": c.course_code,
                "course_name": c.course_name,
                "department": c.department_id,
                "is_elective": c.is_elective,
                "parent_group_code": g.group_code,
                "group_id": g.id,
                "sub_group_count": g.sub_group_count,
            }

            # 1. Lecture (大组)
            for _ in range(c.lecture_hours or 0):
                sessions.append({
                    **base,
                    "session_type": "lecture",
                    "group_code": g.group_code,
                    "sub_group": None,
                    "required_seats": g.student_count
                })

            # 2. Practice (子组)
            if (c.practice_hours or 0) > 0:
                sub_size = math.ceil(g.student_count / max(g.sub_group_count, 1))
                for sub_idx in range(g.sub_group_count):
                    sub_code = f"{g.group_code}-{sub_idx + 1}"
                    for _ in range(c.practice_hours):
                        sessions.append({
                            **base,
                            "session_type": "practice",
                            "group_code": sub_code,
                            "sub_group": str(sub_idx + 1),
                            "required_seats": sub_size
                        })

            # 3. Lab (子组)
            if (c.lab_hours or 0) > 0:
                sub_size = math.ceil(g.student_count / max(g.sub_group_count, 1))
                for sub_idx in range(g.sub_group_count):
                    sub_code = f"{g.group_code}-{sub_idx + 1}"
                    for _ in range(c.lab_hours):
                        sessions.append({
                            **base,
                            "session_type": "lab",
                            "group_code": sub_code,
                            "sub_group": str(sub_idx + 1),
                            "required_seats": sub_size
                        })

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


def build_teacher_cache(courses, teachers):
    cache = {}
    for c in courses:
        if c.course_name in cache:
            continue
        cache[c.course_name] = [t for t in teachers if teacher_qualified(t, c.course_name)]
    return cache


def build_room_cache(rooms):
    cache = {}
    for st in ["lecture", "practice", "lab"]:
        matched = [r for r in rooms if room_matches_session(r, st)]
        matched.sort(key=lambda r: r.capacity)
        cache[st] = matched
    return cache


# ============================================================
# Main generator
# ============================================================

def generate(db):
    t0 = time.time()
    TIMEOUT_SECONDS = 60

    log = []

    active = get_active_semester(db)
    if not active:
        raise HTTPException(status_code=400, detail="No active semester. Activate one first.")
    log.append(f"Active semester: {active.name} ({active.term} {active.academic_year})")

    slots = get_active_slots(db)
    if not slots:
        raise HTTPException(status_code=400, detail="No active time slots. Define them first.")
    log.append(f"Using {len(slots)} time slots")

    slot_idx = {s: i for i, s in enumerate(slots)}

    unknown_slots = [s for s in slots if s not in SLOTS]
    if unknown_slots:
        log.append(f"[WARN] DB slots not in hardcoded SLOTS list: {unknown_slots}")

    courses = db.query(Course).all()
    rooms = db.query(Room).all()
    teachers = db.query(Teacher).all()

    if not courses or not rooms or not teachers:
        raise HTTPException(
            status_code=400,
            detail="Missing required data (courses, rooms, or teachers).",
        )

    teacher_cache = build_teacher_cache(courses, teachers)
    room_cache = build_room_cache(rooms)
    log.append(
        f"Cached {len(teacher_cache)} course→teacher maps, "
        f"{sum(len(v) for v in room_cache.values())} room candidates"
    )

    sessions = expand_sessions(db, courses, active)
    total_sessions = len(sessions)
    log.append(f"Expanded {len(courses)} courses into {total_sessions} sessions.")

    if total_sessions == 0:
        log.append("No sessions to schedule.")
        raise HTTPException(status_code=400, detail="No courses match the active semester, program, year and track. Previous timetable was preserved.")

    # 优先排最难的：Lab -> Practice -> Lecture
    sessions.sort(key=lambda s: (
        0 if s["session_type"] == "lab" else (1 if s["session_type"] == "practice" else 2),
    ))

    hard = {c.constraint_type: c for c in db.query(Constraint).all()}
    lunch_cfg = None
    if hard.get("lunch_break") and hard["lunch_break"].is_active:
        lunch_cfg = read_lunch(hard["lunch_break"].config_json)
        log.append(f"Lunch break: {lunch_cfg.get('start')}-{lunch_cfg.get('end')}")

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

    log.append(f"Weights: gaps={w_gaps}, early={w_early}, late={w_late}, compact={w_compact}")

    user_by_email = {u.email: u.id for u in db.query(User).all()}
    avail_by_uid = {
        a.user_id: read_availability(a.matrix_json)
        for a in db.query(TeacherAvailability).all()
    }
    teacher_avail = {}
    for t in teachers:
        uid = t.user_id or user_by_email.get(t.email)
        if uid and uid in avail_by_uid:
            teacher_avail[t.id] = avail_by_uid[uid]

    # 状态记录
    room_slots = {r.id: set() for r in rooms}
    teacher_slots = {t.id: set() for t in teachers}

    # 必修/选修分开记录，方便选修课重叠逻辑
    mandatory_slots = {}  # {group_code: set((day, slot))}
    elective_slots = {}  # {group_code: set((day, slot))}

    teacher_hours = {t.id: 0 for t in teachers}
    teacher_daily = {t.id: {d: 0 for d in DAYS} for t in teachers}
    day_load = {d: 0 for d in DAYS}

    placed = []
    failed = []
    timed_out = False

    for idx, session in enumerate(sessions):
        if (time.time() - t0) > TIMEOUT_SECONDS:
            timed_out = True
            failed.extend(sessions[idx:])
            log.append(f"[TIMEOUT] Stopped after {len(placed)} placements.")
            break

        required_seats = session["required_seats"]
        parent_group = session["parent_group_code"]
        current_group = session["group_code"]
        is_elective = session["is_elective"]

        candidates_teachers = teacher_cache.get(session["course_name"], [])
        if not candidates_teachers:
            failed.append(session)
            log.append(
                f"[FAIL] {session['course_code']} ({session['session_type']}) [{current_group}] — no qualified teacher")
            continue

        candidates_rooms = room_cache.get(session["session_type"], [])
        if not candidates_rooms:
            failed.append(session)
            log.append(
                f"[FAIL] {session['course_code']} ({session['session_type']}) [{current_group}] — no suitable room")
            continue

        best = None
        best_penalty = float("inf")

        for day in DAYS:
            for slot in slots:
                for room in candidates_rooms:
                    if room.capacity < required_seats:
                        continue
                    if (day, slot) in room_slots[room.id]:
                        continue

                    for teacher in candidates_teachers:
                        if (day, slot) in teacher_slots[teacher.id]:
                            continue
                        if teacher_hours[teacher.id] >= teacher.max_weekly_hours:
                            continue
                        if teacher_daily[teacher.id][day] >= teacher.max_daily_hours:
                            continue

                        if teacher.id in teacher_avail:
                            st_status = teacher_avail[teacher.id].get(day, {}).get(slot, "neutral")
                            if st_status == "blocked":
                                continue

                        # ====================================================
                        # 检查组冲突 (层级逻辑)
                        # ====================================================
                        group_busy = False

                        # 1. 查必修占用
                        # 如果当前是大组(Lecture)，检查它自己及其所有子组
                        # 如果当前是子组(Practice)，检查它自己以及父组
                        check_groups = [parent_group]
                        if current_group != parent_group:
                            check_groups.append(current_group)

                        for g in check_groups:
                            if (day, slot) in mandatory_slots.get(g, set()):
                                group_busy = True
                                break

                        # 2. 查选修占用 (只有排必修课时才查)
                        if not group_busy and not is_elective:
                            for g in check_groups:
                                if (day, slot) in elective_slots.get(g, set()):
                                    group_busy = True
                                    break

                        if not group_busy and session["session_type"] == "lecture":
                            for i in range(1, session["sub_group_count"] + 1):
                                subgroup = f"{parent_group}-{i}"
                                busy = (day, slot) in mandatory_slots.get(subgroup, set())
                                if not is_elective:
                                    busy = busy or (day, slot) in elective_slots.get(subgroup, set())
                                if busy:
                                    group_busy = True
                                    break

                        if group_busy:
                            continue

                        if lunch_cfg and day in lunch_cfg.get("days", []):
                            if slot_overlaps_lunch(slot, lunch_cfg["start"], lunch_cfg["end"]):
                                continue

                        # Soft penalty
                        p = 0.0
                        p += day_load[day] * 4

                        n = len(slots)
                        mid = (n - 1) / 2
                        slot_i = slot_idx[slot]
                        edge_distance = abs(slot_i - mid)

                        if w_early > 0:
                            p += (n - 1 - slot_i) * 6 * (w_early / 10)
                        if w_late > 0:
                            p += slot_i * 6 * (w_late / 10)

                        p -= (mid - edge_distance) * 1.5

                        # 用 current_group 计算 gap
                        if w_gaps > 0:
                            current_i = slot_idx[slot]
                            taken = [
                                slot_idx[s]
                                for (d, s) in mandatory_slots.get(current_group, set())
                                if d == day and s in slot_idx
                            ]
                            if taken:
                                min_dist = min(abs(current_i - t) for t in taken)
                                if min_dist > 1:
                                    p += 15 * (w_gaps / 10)

                        if w_compact > 0:
                            group_days = set(d for (d, s) in mandatory_slots.get(current_group, set()))
                            if group_days and day not in group_days:
                                p += 10 * (w_compact / 10)

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
            log.append(f"[FAIL] {session['course_code']} ({session['session_type']}) [{current_group}]")
            continue

        day, slot, room, teacher = best

        # 记录占用
        room_slots[room.id].add((day, slot))
        teacher_slots[teacher.id].add((day, slot))

        occupied = elective_slots if is_elective else mandatory_slots
        occupied.setdefault(current_group, set()).add((day, slot))

        teacher_hours[teacher.id] += 1
        teacher_daily[teacher.id][day] += 1
        day_load[day] += 1

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
            "group_id": session["group_id"],
            "sub_group": session["sub_group"],
            "group_code": current_group,
            "attendee_groups": ([current_group] if session["sub_group"] else
                [f"{parent_group}-{i}" for i in range(1, session["sub_group_count"] + 1)]),
        })

        log.append(
            f"[OK] {session['course_code']} ({session['session_type']}) → "
            f"{day} {slot}, {room.room_code}, {teacher.full_name} [{current_group}]"
        )

    elapsed = round(time.time() - t0, 3)
    log.append(f"Finished in {elapsed}s")
    log.append(f"Placed: {len(placed)}, Failed: {len(failed)}")

    evaluation = score_schedule(db, placed)
    score = evaluation["score"]
    breakdown = evaluation["breakdown"]

    coverage = (
        round(len(placed) / total_sessions * 100, 1) if total_sessions else 100
    )
    if not failed:
        status = "success"
    elif placed:
        status = "partial"
    else:
        status = "failed"

    log.append(f"Coverage: {coverage}%  ({len(placed)}/{total_sessions})")

    return {
        "status": status,
        "placed_count": len(placed),
        "failed_count": len(failed),
        "total_sessions": total_sessions,
        "coverage": coverage,
        "timed_out": timed_out,
        "elapsed_seconds": elapsed,
        "score": score,
        "score_breakdown": breakdown,
        "log": log,
        "entries": placed,
        "failed_sessions": [
            {
                "course_code": s["course_code"],
                "session_type": s["session_type"],
                "group_code": s["group_code"],
            }
            for s in failed[:50]
        ],
    }



# ============================================================
# Routes
# ============================================================

@router.post("/generate")
def run_generation(
        admin: User = Depends(require_role("admin")),
        db: Session = Depends(get_db),
):
    active = get_active_semester(db)
    if not active:
        raise HTTPException(status_code=400, detail="No active semester.")

    from routes.validation_routes import build_report
    from routes.conflict_routes import scan_conflicts

    report = build_report(db)
    if not report["ok"]:
        raise HTTPException(status_code=400, detail="Fix Prepare Data errors before generating. Previous timetable was preserved.")

    try:
        result = generate(db)
        if not result["entries"]:
            raise HTTPException(status_code=409, detail="No sessions could be scheduled. Previous timetable was preserved.")
        slot_by_label = {s.slot_label: s.id for s in db.query(TimeSlot).filter_by(is_active=True).all()}
        db.query(ScheduleEntry).filter_by(semester_id=active.id).delete(synchronize_session=False)
        for e in result["entries"]:
            slot_id = slot_by_label.get(e["time_slot"])
            if slot_id is None:
                raise HTTPException(status_code=409, detail="Time slots changed during generation. Previous timetable was preserved.")
            db.add(ScheduleEntry(
                day=e["day"], time_slot_id=slot_id, course_id=e["course_id"],
                room_id=e["room_id"], teacher_id=e["teacher_id"], group_id=e["group_id"],
                sub_group=e["sub_group"], semester_id=active.id, session_type=e["session_type"],
            ))
        db.flush()
        scan = scan_conflicts(db)
        if scan["error_count"]:
            raise HTTPException(status_code=409, detail="Generated timetable failed conflict validation. Previous timetable was preserved.")
        result["conflicts"] = scan
        log_event(db, admin.id, "timetable_generated", True,
                  f"placed={result['placed_count']} failed={result['failed_count']} coverage={result['coverage']}%",
                  commit=False)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


@router.get("/entries")
def list_entries(
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
):
    active = get_active_semester(db)
    if not active:
        return []

    entries = db.query(ScheduleEntry).filter_by(semester_id=active.id).all()
    return [
        {
            "id": e.id,
            "day": e.day,
            "time_slot": e.time_slot.slot_label if e.time_slot else None,
            "course_code": e.course.course_code if e.course else None,
            "session_type": e.session_type,
            "sub_group": e.sub_group,
            "room_code": e.room.room_code if e.room else None,
            "teacher_name": e.teacher.full_name if e.teacher else None,
            "target_groups": e.group.group_code if e.group else None,
        }
        for e in entries
    ]