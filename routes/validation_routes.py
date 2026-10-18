import re
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import (
    Course, Teacher, Room, StudentGroup, Program,
    TimeSlot, Semester, User,
)
from routes.auth_routes import get_current_user

router = APIRouter(prefix="/validation", tags=["validation"])


def check_basics(db: Session):
    """Ensure minimum required data exists."""
    issues = []

    if db.query(Semester).filter_by(is_active=True).count() == 0:
        issues.append({
            "severity": "error",
            "category": "semester",
            "message": "No active semester. Activate one before generating.",
        })

    active_slots = db.query(TimeSlot).filter_by(is_active=True).count()
    if active_slots == 0:
        issues.append({
            "severity": "error",
            "category": "time_slots",
            "message": "No active time slots defined.",
        })
    elif active_slots < 4:
        issues.append({
            "severity": "warning",
            "category": "time_slots",
            "message": f"Only {active_slots} active time slots. Scheduling may be tight.",
        })

    if db.query(Room).count() == 0:
        issues.append({
            "severity": "error",
            "category": "rooms",
            "message": "No rooms defined.",
        })

    if db.query(Teacher).count() == 0:
        issues.append({
            "severity": "error",
            "category": "teachers",
            "message": "No teachers defined.",
        })

    if db.query(Course).count() == 0:
        issues.append({
            "severity": "error",
            "category": "courses",
            "message": "No courses defined.",
        })

    if db.query(StudentGroup).count() == 0:
        issues.append({
            "severity": "error",
            "category": "student_groups",
            "message": "No student groups defined.",
        })

    return issues


def check_courses(db: Session):
    """Each course must have: valid program, matching teacher, valid hours."""
    issues = []
    courses = db.query(Course).all()
    teachers = db.query(Teacher).all()

    for c in courses:
        # --- Program assigned ---
        if not c.program_id:
            issues.append({
                "severity": "error",
                "category": "courses",
                "message": f"Course {c.course_code} has no program assigned.",
            })
        else:
            # 确保 program_id 是有效的
            p = db.query(Program).filter_by(id=c.program_id).first()
            if not p:
                issues.append({
                    "severity": "error",
                    "category": "courses",
                    "message": f"Course {c.course_code} points to invalid program ID {c.program_id}.",
                })

        # --- Hours sum ---
        total = (c.lecture_hours or 0) + (c.practice_hours or 0) + (c.lab_hours or 0)
        if total != (c.total_hours or 0):
            issues.append({
                "severity": "error",
                "category": "courses",
                "message": f"Course {c.course_code}: hours sum {total} ≠ total {c.total_hours}.",
            })

        # --- Qualified teacher ---
        name = (c.course_name or "").lower()
        qualified = [
            t for t in teachers
            if t.qualified_subjects and any(
                s.strip().lower() in name or name in s.strip().lower()
                for s in t.qualified_subjects.split(",")
            )
        ]
        if not qualified:
            issues.append({
                "severity": "error",
                "category": "courses",
                "message": f"Course {c.course_code} has no qualified teacher.",
            })

        # --- Track validation ---
        if c.is_elective and not c.track:
            issues.append({
                "severity": "warning",
                "category": "courses",
                "message": f"Course {c.course_code} is elective but has no track specified.",
            })
        elif not c.is_elective and c.track:
            issues.append({
                "severity": "warning",
                "category": "courses",
                "message": f"Course {c.course_code} has track '{c.track}' but is not marked as elective.",
            })

    return issues


def check_teachers(db: Session):
    """Each teacher should have availability and a valid workload."""
    issues = []
    teachers = db.query(Teacher).all()

    for t in teachers:
        if not t.max_weekly_hours or t.max_weekly_hours < 1:
            issues.append({
                "severity": "error",
                "category": "teachers",
                "message": f"Teacher {t.full_name} has invalid max weekly hours.",
            })
        if not t.qualified_subjects:
            issues.append({
                "severity": "warning",
                "category": "teachers",
                "message": f"Teacher {t.full_name} has no qualified subjects.",
            })

    return issues


def check_rooms(db: Session):
    """Each room must have valid capacity and type."""
    issues = []
    rooms = db.query(Room).all()

    for r in rooms:
        if not r.capacity or r.capacity < 1:
            issues.append({
                "severity": "error",
                "category": "rooms",
                "message": f"Room {r.room_code} has invalid capacity.",
            })
        if not r.room_type:
            issues.append({
                "severity": "warning",
                "category": "rooms",
                "message": f"Room {r.room_code} has no type specified.",
            })

    return issues


def check_student_groups(db: Session):
    """Each group must have a program and a positive size."""
    issues = []
    groups = db.query(StudentGroup).all()

    for g in groups:
        if not g.program_id:
            issues.append({
                "severity": "error",
                "category": "student_groups",
                "message": f"Group {g.group_code} has no program assigned.",
            })
        if not g.student_count or g.student_count < 1:
            issues.append({
                "severity": "error",
                "category": "student_groups",
                "message": f"Group {g.group_code} has invalid student count.",
            })
        if not g.sub_group_count or g.sub_group_count < 1:
            issues.append({
                "severity": "error",
                "category": "student_groups",
                "message": f"Group {g.group_code} has invalid sub_group_count.",
            })

    return issues


@router.get("/report")
def get_report(
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
):
    """
    Full pre-flight validation report.
    Called BEFORE the AI generator runs.
    """
    all_issues = []
    all_issues.extend(check_basics(db))
    all_issues.extend(check_courses(db))
    all_issues.extend(check_teachers(db))
    all_issues.extend(check_rooms(db))
    all_issues.extend(check_student_groups(db))

    errors = [i for i in all_issues if i["severity"] == "error"]
    warnings = [i for i in all_issues if i["severity"] == "warning"]

    return {
        "ok": len(errors) == 0,
        "error_count": len(errors),
        "warning_count": len(warnings),
        "issues": all_issues,
        "summary": {
            "courses": db.query(Course).count(),
            "teachers": db.query(Teacher).count(),
            "rooms": db.query(Room).count(),
            "student_groups": db.query(StudentGroup).count(),
            "active_slots": db.query(TimeSlot).filter_by(is_active=True).count(),
            "active_semester": (
                db.query(Semester).filter_by(is_active=True).first().name
                if db.query(Semester).filter_by(is_active=True).first()
                else None
            ),
        },
    }