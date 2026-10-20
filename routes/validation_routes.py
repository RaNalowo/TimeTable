import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import (
    Course, Teacher, Room, StudentGroup, Program,
    TimeSlot, Semester, User, TeacherAvailability, Constraint,
)
from routes.auth_routes import get_current_user
from services.scheduling_data import read_availability, read_lunch
from services.semester_logic import parse_semester_level

router = APIRouter(prefix="/validation", tags=["validation"])


def check_basics(db: Session):
    issues = []
    if db.query(Semester).filter_by(is_active=True).count() == 0:
        issues.append({"severity": "error", "category": "semester",
                       "message": "No active semester. Activate one before generating."})
    active_slots = db.query(TimeSlot).filter_by(is_active=True).count()
    if active_slots == 0:
        issues.append({"severity": "error", "category": "time_slots", "message": "No active time slots defined."})
    elif active_slots < 4:
        issues.append({"severity": "warning", "category": "time_slots",
                       "message": f"Only {active_slots} active time slots. Scheduling may be tight."})
    if db.query(Room).count() == 0:
        issues.append({"severity": "error", "category": "rooms", "message": "No rooms defined."})
    if db.query(Teacher).count() == 0:
        issues.append({"severity": "error", "category": "teachers", "message": "No teachers defined."})
    if db.query(Course).count() == 0:
        issues.append({"severity": "error", "category": "courses", "message": "No courses defined."})
    if db.query(StudentGroup).count() == 0:
        issues.append({"severity": "error", "category": "student_groups", "message": "No student groups defined."})
    return issues


def check_courses(db: Session):
    issues = []
    courses = db.query(Course).all()
    teachers = db.query(Teacher).all()

    for c in courses:
        if not c.program_id:
            issues.append({"severity": "error", "category": "courses",
                           "message": f"Course {c.course_code} has no program assigned."})
        else:
            if not db.query(Program).filter_by(id=c.program_id).first():
                issues.append({"severity": "error", "category": "courses",
                               "message": f"Course {c.course_code} points to invalid program ID {c.program_id}."})

        if parse_semester_level(c.semester_level)[0] is None:
            issues.append({"severity": "error", "category": "courses",
                           "message": f"Course {c.course_code} needs semester level 'Year N Fall' or 'Year N Spring'."})

        total = (c.lecture_hours or 0) + (c.practice_hours or 0) + (c.lab_hours or 0)
        if total != (c.total_hours or 0):
            issues.append({"severity": "error", "category": "courses",
                           "message": f"Course {c.course_code}: hours sum {total} ≠ total {c.total_hours}."})
        if total <= 0 or any((h or 0) < 0 for h in (c.lecture_hours, c.practice_hours, c.lab_hours)):
            issues.append(
                {"severity": "error", "category": "courses", "message": f"Course {c.course_code} has invalid hours."})

        # ★ 修改点：老师资质使用 ccode
        ccode = (c.course_code or "").lower()
        qualified = [
            t for t in teachers
            if t.qualified_subjects and any(
                s.strip().lower() == ccode for s in t.qualified_subjects.split(",")
            )
        ]
        if not qualified:
            issues.append({"severity": "error", "category": "courses",
                           "message": f"Course {c.course_code} has no qualified teacher."})

        if c.is_elective and not c.track:
            issues.append({"severity": "warning", "category": "courses",
                           "message": f"Course {c.course_code} is elective but has no track specified."})
        elif not c.is_elective and c.track:
            issues.append({"severity": "warning", "category": "courses",
                           "message": f"Course {c.course_code} has track '{c.track}' but is not marked as elective."})

    return issues


def check_teachers(db: Session):
    issues = []
    for t in db.query(Teacher).all():
        if not t.max_weekly_hours or t.max_weekly_hours < 1 or not t.max_daily_hours or t.max_daily_hours < 1:
            issues.append({"severity": "error", "category": "teachers",
                           "message": f"Teacher {t.full_name} has invalid max weekly hours."})
        if not t.qualified_subjects:
            issues.append({"severity": "warning", "category": "teachers",
                           "message": f"Teacher {t.full_name} has no qualified subjects."})
    return issues


def check_rooms(db: Session):
    issues = []
    for r in db.query(Room).all():
        if not r.capacity or r.capacity < 1:
            issues.append(
                {"severity": "error", "category": "rooms", "message": f"Room {r.room_code} has invalid capacity."})
        if not r.room_type:
            issues.append(
                {"severity": "warning", "category": "rooms", "message": f"Room {r.room_code} has no type specified."})
    return issues


def check_student_groups(db: Session):
    issues = []
    for g in db.query(StudentGroup).all():
        if not g.program_id:
            issues.append({"severity": "error", "category": "student_groups",
                           "message": f"Group {g.group_code} has no program assigned."})
        if not g.student_count or g.student_count < 1:
            issues.append({"severity": "error", "category": "student_groups",
                           "message": f"Group {g.group_code} has invalid student count."})
        if not g.sub_group_count or g.sub_group_count < 1 or g.sub_group_count > (g.student_count or 0):
            issues.append({"severity": "error", "category": "student_groups",
                           "message": f"Group {g.group_code} has invalid sub_group_count."})
    return issues


def check_configuration(db):
    from routes.time_slot_routes import parse_slot
    issues = []
    if db.query(Semester).filter_by(is_active=True).count() > 1:
        issues.append({"severity": "error", "category": "semester", "message": "More than one semester is active."})
    slots = db.query(TimeSlot).filter_by(is_active=True).order_by(TimeSlot.sort_order).all()
    previous_end = None
    orders = set()
    for slot in slots:
        parsed = parse_slot(slot.slot_label)
        if (not parsed or parsed[1] - parsed[0] != 50 or (previous_end is not None and parsed[
            0] < previous_end) or slot.sort_order in orders or not 1 <= slot.sort_order <= 10):
            issues.append({"severity": "error", "category": "time_slots",
                           "message": f"Invalid, overlapping or unordered slot: {slot.slot_label}."})
        if parsed: previous_end = parsed[1]
        orders.add(slot.sort_order)
    for row in db.query(TeacherAvailability).all():
        try:
            matrix = read_availability(row.matrix_json)
            if any(key not in {s.slot_label for s in slots} for values in matrix.values() for key in values):
                issues.append({"severity": "warning", "category": "availability",
                               "message": f"Availability for user {row.user_id} contains outdated slots; re-save it."})
        except HTTPException as exc:
            issues.append(
                {"severity": "error", "category": "availability", "message": f"User {row.user_id}: {exc.detail}"})
    submitted = {r.user_id for r in db.query(TeacherAvailability).all()}
    missing_availability = []
    for teacher in db.query(Teacher).all():
        user = db.query(User).filter_by(email=teacher.email).first()
        uid = teacher.user_id or (user.id if user else None)
        if not uid or uid not in submitted:
            missing_availability.append(teacher.full_name)
    if missing_availability:
        issues.append({"severity": "warning", "category": "availability",
                       "message": f"{len(missing_availability)} teacher(s) have no submitted availability; unspecified periods are treated as neutral. Examples: {', '.join(missing_availability[:3])}."})
    lunch = db.query(Constraint).filter_by(constraint_type="lunch_break", is_active=True).first()
    for row in db.query(Constraint).filter(
            Constraint.constraint_type.in_(["no_overlap_rooms", "no_overlap_teachers"])).all():
        if not row.is_active:
            issues.append({"severity": "error", "category": "constraints",
                           "message": f"Enable mandatory rule {row.constraint_type} in Hard Constraints."})
    if lunch:
        try:
            read_lunch(lunch.config_json)
        except HTTPException as exc:
            issues.append({"severity": "error", "category": "constraints", "message": exc.detail})
    return issues


@router.get("/report")
def get_report(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return build_report(db)


def build_report(db):
    all_issues = []
    all_issues.extend(check_basics(db))
    all_issues.extend(check_courses(db))
    all_issues.extend(check_teachers(db))
    all_issues.extend(check_rooms(db))
    all_issues.extend(check_student_groups(db))
    all_issues.extend(check_configuration(db))

    errors = [i for i in all_issues if i["severity"] == "error"]
    warnings = [i for i in all_issues if i["severity"] == "warning"]

    return {
        "ok": len(errors) == 0, "error_count": len(errors), "warning_count": len(warnings), "issues": all_issues,
        "summary": {
            "courses": db.query(Course).count(), "teachers": db.query(Teacher).count(),
            "rooms": db.query(Room).count(), "student_groups": db.query(StudentGroup).count(),
            "active_slots": db.query(TimeSlot).filter_by(is_active=True).count(),
            "active_semester": (
                db.query(Semester).filter_by(is_active=True).first().name if db.query(Semester).filter_by(
                    is_active=True).first() else None),
        },
    }