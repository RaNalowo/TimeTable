import time
import math
import json
import hashlib
from typing import Literal
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from fastapi import Body

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
from services.qualifications import teacher_qualified
from services.ai_scheduler import (
    ai_status, require_ai_key, candidate_fingerprint, candidate_summary, choose_candidate,
)
from services.scheduling_data import read_availability, read_lunch
from services.time_slots import get_active_slots
from services.semester_logic import (
    get_active_semester, parse_semester_level, current_year_for_group,
)

router = APIRouter(prefix="/generator", tags=["generator"])

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]

SLOTS = [
    "08:30-09:20", "09:30-10:20", "10:30-11:20", "11:30-12:20", "12:30-13:20",
    "13:30-14:20", "14:30-15:20", "15:30-16:20", "16:30-17:20", "17:30-18:20",
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


def resolve_target_groups(db, course, semester):
    course_year, course_term = parse_semester_level(course.semester_level)
    if course_year is None:
        return []
    if course_term != semester.term:
        return []

    groups = db.query(StudentGroup).filter(
        StudentGroup.program_id == course.program_id
    ).all()

    matched = []
    for g in groups:
        if current_year_for_group(g, semester) != course_year:
            continue
        if course.track:
            if g.track != course.track:
                continue
        matched.append(g)
    return matched


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

            # 1. Lecture (大组) - 连堂
            if (c.lecture_hours or 0) > 0:
                sessions.append({
                    **base, "session_type": "lecture", "group_code": g.group_code,
                    "sub_group": None, "required_seats": g.student_count,
                    "block_size": c.lecture_hours
                })

            # 2. Practice (子组) - 连堂
            if (c.practice_hours or 0) > 0:
                sub_size = math.ceil(g.student_count / max(g.sub_group_count, 1))
                for sub_idx in range(g.sub_group_count):
                    sub_code = f"{g.group_code}-{sub_idx + 1}"
                    sessions.append({
                        **base, "session_type": "practice", "group_code": sub_code,
                        "sub_group": str(sub_idx + 1), "required_seats": sub_size,
                        "block_size": c.practice_hours
                    })

            # 3. Lab (子组) - 连堂
            if (c.lab_hours or 0) > 0:
                sub_size = math.ceil(g.student_count / max(g.sub_group_count, 1))
                for sub_idx in range(g.sub_group_count):
                    sub_code = f"{g.group_code}-{sub_idx + 1}"
                    sessions.append({
                        **base, "session_type": "lab", "group_code": sub_code,
                        "sub_group": str(sub_idx + 1), "required_seats": sub_size,
                        "block_size": c.lab_hours
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
        if c.course_code in cache:
            continue
        cache[c.course_code] = [t for t in teachers if teacher_qualified(t, c.course_code, c.course_name)]
    return cache


def build_room_cache(rooms):
    cache = {}
    for st in ["lecture", "practice", "lab"]:
        matched = [r for r in rooms if room_matches_session(r, st)]
        matched.sort(key=lambda r: r.capacity)
        cache[st] = matched
    return cache


def generate(db, strategy="balanced", deadline=None):
    t0 = time.time()
    default_timeout = 600 if deadline is None else 300
    stop_at = min(t0 + default_timeout, deadline) if deadline is not None else t0 + default_timeout

    log = []
    log.append(f"Candidate strategy: {strategy}")

    active = get_active_semester(db)
    if not active:
        raise HTTPException(status_code=400, detail="No active semester. Activate one first.")
    log.append(f"Active semester: {active.name} ({active.term} {active.academic_year})")

    slots = get_active_slots(db)
    if not slots:
        raise HTTPException(status_code=400, detail="No active time slots. Define them first.")
    log.append(f"Using {len(slots)} time slots")

    slot_idx = {s: i for i, s in enumerate(slots)}

    courses = db.query(Course).all()
    rooms = db.query(Room).all()
    teachers = db.query(Teacher).all()

    if not courses or not rooms or not teachers:
        raise HTTPException(status_code=400, detail="Missing required data (courses, rooms, or teachers).")

    teacher_cache = build_teacher_cache(courses, teachers)
    room_cache = build_room_cache(rooms)

    sessions = expand_sessions(db, courses, active)
    total_sessions = len(sessions)
    log.append(f"Expanded {len(courses)} courses into {total_sessions} sessions.")

    if total_sessions == 0:
        raise HTTPException(status_code=400, detail="No courses match the active semester.")

    sessions.sort(key=lambda s: (
        s["block_size"],
        0 if s["session_type"] == "lab" else (1 if s["session_type"] == "practice" else 2)
    ), reverse=True)

    hard = {c.constraint_type: c for c in db.query(Constraint).all()}
    lunch_cfg = None
    if hard.get("lunch_break") and hard["lunch_break"].is_active:
        lunch_cfg = read_lunch(hard["lunch_break"].config_json)

    soft_rows = {c.constraint_key: c for c in db.query(SoftConstraint).all()}

    def get_weight(key):
        row = soft_rows.get(key)
        return row.weight if row and row.is_enabled else 0

    w_gaps = get_weight("minimize_gaps")
    w_early = get_weight("avoid_early_mornings")
    w_late = get_weight("avoid_late_evenings")
    w_compact = get_weight("compact_days")

    user_by_email = {u.email: u.id for u in db.query(User).all()}
    avail_by_uid = {a.user_id: read_availability(a.matrix_json) for a in db.query(TeacherAvailability).all()}
    teacher_avail = {}
    for t in teachers:
        uid = t.user_id or user_by_email.get(t.email)
        if uid and uid in avail_by_uid:
            teacher_avail[t.id] = avail_by_uid[uid]

    room_slots = {r.id: set() for r in rooms}
    teacher_slots = {t.id: set() for t in teachers}
    mandatory_slots = {}
    elective_slots = {}
    teacher_hours = {t.id: 0 for t in teachers}
    teacher_daily = {t.id: {d: 0 for d in DAYS} for t in teachers}
    day_load = {d: 0 for d in DAYS}

    placed = []
    failed = []
    timed_out = False

    for idx, session in enumerate(sessions):
        if time.time() > stop_at:
            timed_out = True
            failed.extend(sessions[idx:])
            log.append(f"[TIMEOUT] Stopped after {len(placed)} placements.")
            break

        block_size = session.get("block_size", 1)
        required_seats = session["required_seats"]
        parent_group = session["parent_group_code"]
        current_group = session["group_code"]
        is_elective = session["is_elective"]

        candidates_teachers = teacher_cache.get(session["course_code"], [])
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
            for start_i in range(len(slots) - block_size + 1):
                block_slots = slots[start_i: start_i + block_size]

                if lunch_cfg and day in lunch_cfg.get("days", []):
                    if any(slot_overlaps_lunch(s, lunch_cfg["start"], lunch_cfg["end"]) for s in block_slots):
                        continue

                for room in candidates_rooms:
                    if room.capacity < required_seats:
                        continue
                    if any((day, s) in room_slots[room.id] for s in block_slots):
                        continue

                    for teacher in candidates_teachers:
                        if any((day, s) in teacher_slots[teacher.id] for s in block_slots):
                            continue
                        if teacher_hours[teacher.id] + block_size > teacher.max_weekly_hours:
                            continue
                        if teacher_daily[teacher.id][day] + block_size > teacher.max_daily_hours:
                            continue

                        if teacher.id in teacher_avail:
                            if any(teacher_avail[teacher.id].get(day, {}).get(s, "neutral") == "blocked" for s in
                                   block_slots):
                                continue

                        group_busy = False
                        check_groups = [parent_group, current_group] if current_group != parent_group else [
                            parent_group]

                        # 正常的互斥判断（大班和子组互不干扰）
                        for s in block_slots:
                            for g in check_groups:
                                if (day, s) in mandatory_slots.get(g, set()):
                                    group_busy = True
                                    break
                                if not is_elective and (day, s) in elective_slots.get(g, set()):
                                    group_busy = True
                                    break

                            if session["session_type"] == "lecture":
                                for i in range(1, session["sub_group_count"] + 1):
                                    subgroup = f"{parent_group}-{i}"
                                    if (day, s) in mandatory_slots.get(subgroup, set()) or (
                                            not is_elective and (day, s) in elective_slots.get(subgroup, set())):
                                        group_busy = True
                                        break
                            if group_busy:
                                break

                        if group_busy:
                            continue

                        p = 0.0
                        p += day_load[day] * 4
                        n = len(slots)
                        mid = (n - 1) / 2
                        center_slot_i = start_i + (block_size - 1) / 2.0
                        edge_distance = abs(center_slot_i - mid)

                        if w_early > 0:
                            p += (n - 1 - start_i) * 6 * (w_early / 10)
                        if w_late > 0:
                            p += start_i * 6 * (w_late / 10)

                        p -= (mid - edge_distance) * 1.5

                        if w_gaps > 0:
                            taken = [
                                slot_idx[s] for (d, s) in mandatory_slots.get(current_group, set())
                                if d == day and s in slot_idx
                            ]
                            if taken:
                                min_dist = min(abs(start_i - t) for t in taken)
                                if min_dist > 1:
                                    p += 15 * (w_gaps / 10)

                        if w_compact > 0:
                            group_days = set(d for (d, s) in mandatory_slots.get(current_group, set()))
                            if group_days and day not in group_days:
                                p += 10 * (w_compact / 10)

                        if strategy == "compact":
                            attended = [parent_group, current_group]
                            days_used = {d for g in attended for d, _ in mandatory_slots.get(g, set())}
                            if days_used and day not in days_used:
                                p += 35
                            p -= day_load[day] * 3.5
                        elif strategy == "later_starts":
                            p += max(0, 2 - start_i) * 30

                        if teacher.id in teacher_avail:
                            pref = teacher_avail[teacher.id].get(day, {}).get(block_slots[0], "neutral")
                            if pref == "preferred":
                                p -= 5

                        if p < best_penalty:
                            best_penalty = p
                            best = (day, block_slots, room, teacher)
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
                f"[FAIL] {session['course_code']} ({session['session_type']}) [{current_group}] — cannot find {block_size} consecutive slot(s)")
            continue

        day, block_slots, room, teacher = best

        # 正常的资源占用，不再强制大班互斥
        for s in block_slots:
            room_slots[room.id].add((day, s))
            teacher_slots[teacher.id].add((day, s))

            occupied = elective_slots if is_elective else mandatory_slots
            occupied.setdefault(current_group, set()).add((day, s))

        teacher_hours[teacher.id] += block_size
        teacher_daily[teacher.id][day] += block_size
        day_load[day] += block_size

        for s in block_slots:
            placed.append({
                "day": day, "time_slot": s, "room_id": room.id, "room_code": room.room_code,
                "teacher_id": teacher.id, "teacher_name": teacher.full_name,
                "course_id": session["course_id"], "course_code": session["course_code"],
                "course_name": session["course_name"], "session_type": session["session_type"],
                "group_id": session["group_id"], "sub_group": session["sub_group"],
                "group_code": current_group,
                "attendee_groups": ([current_group] if session["sub_group"] else
                                    [f"{parent_group}-{i}" for i in range(1, session["sub_group_count"] + 1)]),
            })

        log.append(
            f"[OK] {session['course_code']} ({session['session_type']}) → {day} {block_slots[0]}~{block_slots[-1]}, {room.room_code}, {teacher.full_name} [{current_group}]")

    elapsed = round(time.time() - t0, 3)
    log.append(f"Finished in {elapsed}s")
    log.append(f"Placed: {len(placed)} entries, Failed: {len(failed)} sessions")

    evaluation = score_schedule(db, placed)
    coverage = round(len(placed) / total_sessions * 100, 1) if total_sessions else 100
    status = "success" if not failed else ("partial" if placed else "failed")

    return {
        "status": status, "placed_count": len(placed), "failed_count": len(failed),
        "total_sessions": total_sessions, "coverage": coverage, "timed_out": timed_out,
        "elapsed_seconds": elapsed, "score": evaluation["score"], "score_breakdown": evaluation["breakdown"],
        "log": log, "entries": placed,
        "failed_sessions": [
            {"course_code": s["course_code"], "session_type": s["session_type"], "group_code": s["group_code"]} for s in
            failed[:50]
        ],
    }


class GenerationRequest(BaseModel):
    mode: Literal["ai_assisted", "heuristic"] = "heuristic"
    preferences: str = Field(default="", max_length=1500)


def scheduling_fingerprint(db):
    inputs = {}
    for model in [Course, Room, Teacher, StudentGroup, TimeSlot, Constraint,
                  SoftConstraint, TeacherAvailability]:
        inputs[model.__tablename__] = [
            {col.name: getattr(row, col.name) for col in model.__table__.columns}
            for row in db.query(model).populate_existing().order_by(model.id).all()
        ]
    from db.models import Semester
    inputs["semesters"] = [
        {col.name: getattr(row, col.name) for col in Semester.__table__.columns}
        for row in db.query(Semester).populate_existing().order_by(Semester.id).all()
    ]
    return hashlib.sha256(json.dumps(inputs, sort_keys=True, default=str).encode()).hexdigest()


def transient_entries(db, result, semester_id):
    slots = {s.slot_label: s for s in db.query(TimeSlot).filter_by(is_active=True).all()}
    courses = {row.id: row for row in db.query(Course).all()}
    rooms = {row.id: row for row in db.query(Room).all()}
    teachers = {row.id: row for row in db.query(Teacher).all()}
    groups = {row.id: row for row in db.query(StudentGroup).all()}
    entries = []
    for idx, entry in enumerate(result["entries"], 1):
        slot = slots.get(entry["time_slot"])
        if slot is None:
            raise HTTPException(status_code=409, detail="Time slots changed. Previous timetable was preserved.")
        entries.append(ScheduleEntry(
            id=-idx, day=entry["day"], time_slot_id=slot.id, time_slot=slot,
            course_id=entry["course_id"], course=courses.get(entry["course_id"]),
            room_id=entry["room_id"], room=rooms.get(entry["room_id"]),
            teacher_id=entry["teacher_id"], teacher=teachers.get(entry["teacher_id"]),
            group_id=entry["group_id"], group=groups.get(entry["group_id"]),
            semester_id=semester_id, sub_group=entry["sub_group"], session_type=entry["session_type"],
        ))
    return entries


def ai_generation(db, request, active):
    from routes.conflict_routes import scan_conflicts
    require_ai_key()
    deadline = time.time() + 240
    candidates, summaries, seen = {}, [], set()
    slots = get_active_slots(db)
    for index, strategy in enumerate(["balanced", "compact", "later_starts"], 1):
        if time.time() > deadline:
            break
        result = generate(db, strategy=strategy, deadline=deadline)
        if not result["entries"]:
            continue
        fingerprint = candidate_fingerprint(result["entries"])
        if fingerprint in seen:
            continue
        scan = scan_conflicts(db, entries=transient_entries(db, result, active.id))
        if scan["error_count"]:
            continue
        candidate_id = f"candidate-{index}"
        seen.add(fingerprint)
        candidates[candidate_id] = result
        summaries.append(candidate_summary(candidate_id, strategy, result, slots))
    if not candidates:
        raise HTTPException(status_code=409,
                            detail="No conflict-free candidate could be built. Previous timetable was preserved.")
    decision = choose_candidate(summaries, request.preferences)
    result = candidates[decision["candidate_id"]]
    result["generation"] = {
        "mode": "ai_assisted", "ai_used": True, "preferences": request.preferences,
        "selection": decision, "candidates": summaries,
    }
    result["log"].append(f"[AI] {decision['model']} selected {decision['candidate_id']}: {decision['reason']}")
    return result


@router.get("/ai-status")
def get_ai_status(admin: User = Depends(require_role("admin"))):
    return ai_status()


@router.get("/last-run")
def get_last_run(admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    from db.models import AuditLog
    active = get_active_semester(db)
    if not active:
        return {"generation": None}
    rows = db.query(AuditLog).filter_by(event="timetable_generated").order_by(AuditLog.id.desc()).all()
    for row in rows:
        try:
            metadata = json.loads(row.detail or "")
        except (ValueError, TypeError):
            continue
        if isinstance(metadata, dict) and metadata.get("semester_id") == active.id:
            return {"generation": metadata.get("generation"), "generated_at": row.created_at.isoformat()}
    return {"generation": None}


@router.post("/generate")
def run_generation(
        data: GenerationRequest | None = Body(default=None),
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
        raise HTTPException(status_code=400,
                            detail="Fix Prepare Data errors before generating. Previous timetable was preserved.")

    request = data or GenerationRequest()
    started_at = time.time()
    original_inputs = scheduling_fingerprint(db)
    try:
        result = ai_generation(db, request, active) if request.mode == "ai_assisted" else generate(db)
        if request.mode == "heuristic":
            result["generation"] = {
                "mode": "heuristic", "ai_used": False, "selection": None, "candidates": [],
                "preferences": "",
            }
        if not result["entries"]:
            raise HTTPException(status_code=409,
                                detail="No sessions could be scheduled. Previous timetable was preserved.")
        if scheduling_fingerprint(db) != original_inputs:
            raise HTTPException(status_code=409,
                                detail="Scheduling data changed during generation. Retry with the updated data. Previous timetable was preserved.")

        candidate_scan = scan_conflicts(db, entries=transient_entries(db, result, active.id))
        if candidate_scan["error_count"]:
            raise HTTPException(status_code=409,
                                detail="Candidate failed conflict validation. Previous timetable was preserved.")

        slot_by_label = {s.slot_label: s.id for s in db.query(TimeSlot).filter_by(is_active=True).all()}
        db.query(ScheduleEntry).filter_by(semester_id=active.id).delete(synchronize_session=False)

        active.is_published = False

        for e in result["entries"]:
            slot_id = slot_by_label.get(e["time_slot"])
            if slot_id is None:
                raise HTTPException(status_code=409,
                                    detail="Time slots changed during generation. Previous timetable was preserved.")
            db.add(ScheduleEntry(
                day=e["day"], time_slot_id=slot_id, course_id=e["course_id"],
                room_id=e["room_id"], teacher_id=e["teacher_id"], group_id=e["group_id"],
                sub_group=e["sub_group"], semester_id=active.id, session_type=e["session_type"],
            ))
        db.flush()
        scan = scan_conflicts(db)
        if scan["error_count"]:
            raise HTTPException(status_code=409,
                                detail="Generated timetable failed conflict validation. Previous timetable was preserved.")
        result["conflicts"] = scan
        result["elapsed_seconds"] = round(time.time() - started_at, 3)
        log_event(db, admin.id, "timetable_generated", True,
                  json.dumps({"semester_id": active.id, "placed": result["placed_count"],
                              "failed": result["failed_count"], "coverage": result["coverage"],
                              "generation": result["generation"]}),
                  commit=False)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


@router.get("/entries")
def list_entries(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    active = get_active_semester(db)
    if not active: return []
    entries = db.query(ScheduleEntry).filter_by(semester_id=active.id).all()
    return [
        {
            "id": e.id, "day": e.day, "time_slot": e.time_slot.slot_label if e.time_slot else None,
            "course_code": e.course.course_code if e.course else None, "session_type": e.session_type,
            "sub_group": e.sub_group, "room_code": e.room.room_code if e.room else None,
            "teacher_name": e.teacher.full_name if e.teacher else None,
            "target_groups": e.group.group_code if e.group else None,
        }
        for e in entries
    ]