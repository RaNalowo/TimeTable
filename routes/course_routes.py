from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import (
    Course, User, Program, Department, course_target_programs
)
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event

router = APIRouter(prefix="/courses", tags=["courses"])


class CourseRequest(BaseModel):
    course_code: str = Field(min_length=1)
    course_name: str = Field(min_length=1)
    credits: int = Field(ge=1, le=30)
    semester_level: str | None = None
    total_hours: int = Field(ge=1, le=20)
    lecture_hours: int = Field(ge=0, le=20)
    practice_hours: int = Field(ge=0, le=20)
    lab_hours: int = Field(ge=0, le=20)
    target_groups: str | None = None     # comma-separated PROGRAM names
    department: str | None = None        # department name (string)


def get_course_target_groups(db: Session, course_id: int) -> str | None:
    """Return comma-separated program names for a course."""
    rows = db.execute(
        course_target_programs.select().where(
            course_target_programs.c.course_id == course_id
        )
    ).fetchall()
    if not rows:
        return None
    prog_ids = [r.program_id for r in rows]
    programs = db.query(Program).filter(Program.id.in_(prog_ids)).all()
    return ", ".join(sorted(p.program_name for p in programs)) or None


def course_to_dict(db: Session, c: Course):
    dept = None
    if c.department_id:
        d = db.query(Department).filter_by(id=c.department_id).first()
        dept = d.name if d else None

    return {
        "id": c.id,
        "course_code": c.course_code,
        "course_name": c.course_name,
        "credits": c.credits,
        "semester_level": c.semester_level,
        "total_hours": c.total_hours,
        "lecture_hours": c.lecture_hours,
        "practice_hours": c.practice_hours,
        "lab_hours": c.lab_hours,
        "target_groups": get_course_target_groups(db, c.id),
        "department": dept,
    }


def validate_hours(data: CourseRequest):
    total = data.lecture_hours + data.practice_hours + data.lab_hours
    if total != data.total_hours:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Total session hours ({total}) do not match Total Hours "
                f"({data.total_hours}). Lecture + Practice + Lab must equal Total."
            ),
        )


def save_target_groups(db: Session, course_id: int, target_str: str | None):
    """Clear and re-insert course_target_programs rows."""
    # Clear old
    db.execute(
        course_target_programs.delete().where(
            course_target_programs.c.course_id == course_id
        )
    )

    if not target_str:
        db.commit()
        return

    names = [n.strip() for n in target_str.split(",") if n.strip()]
    for name in names:
        p = db.query(Program).filter_by(program_name=name).first()
        if not p:
            raise HTTPException(
                status_code=400,
                detail=f"Target program not found: {name}",
            )
        db.execute(
            course_target_programs.insert().values(
                course_id=course_id, program_id=p.id
            )
        )
    db.commit()


# ---------- Routes ----------
@router.get("")
def list_courses(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    courses = db.query(Course).order_by(Course.course_code).all()
    return [course_to_dict(db, c) for c in courses]


@router.post("")
def create_course(
    data: CourseRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    if db.query(Course).filter_by(course_code=data.course_code).first():
        raise HTTPException(status_code=400, detail="Course code already exists")

    validate_hours(data)

    dept_id = None
    if data.department:
        d = db.query(Department).filter_by(name=data.department).first()
        dept_id = d.id if d else None

    course = Course(
        course_code=data.course_code,
        course_name=data.course_name,
        credits=data.credits,
        semester_level=data.semester_level,
        total_hours=data.total_hours,
        lecture_hours=data.lecture_hours,
        practice_hours=data.practice_hours,
        lab_hours=data.lab_hours,
        department_id=dept_id,
    )
    db.add(course)
    db.commit()
    db.refresh(course)

    save_target_groups(db, course.id, data.target_groups)

    log_event(db, admin.id, "course_created", True, data.course_code)
    return course_to_dict(db, course)


@router.put("/{course_id}")
def update_course(
    course_id: int,
    data: CourseRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    course = db.query(Course).filter_by(id=course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    dup = db.query(Course).filter(
        Course.course_code == data.course_code,
        Course.id != course_id,
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail="Course code already exists")

    validate_hours(data)

    dept_id = None
    if data.department:
        d = db.query(Department).filter_by(name=data.department).first()
        dept_id = d.id if d else None

    course.course_code = data.course_code
    course.course_name = data.course_name
    course.credits = data.credits
    course.semester_level = data.semester_level
    course.total_hours = data.total_hours
    course.lecture_hours = data.lecture_hours
    course.practice_hours = data.practice_hours
    course.lab_hours = data.lab_hours
    course.department_id = dept_id
    db.commit()
    db.refresh(course)

    save_target_groups(db, course.id, data.target_groups)

    log_event(db, admin.id, "course_updated", True, f"course_id={course_id}")
    return course_to_dict(db, course)


@router.delete("/{course_id}")
def delete_course(
    course_id: int,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    course = db.query(Course).filter_by(id=course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Remove program links first
    db.execute(
        course_target_programs.delete().where(
            course_target_programs.c.course_id == course_id
        )
    )
    db.delete(course)
    db.commit()

    log_event(db, admin.id, "course_deleted", True, f"course_id={course_id}")
    return {"message": "Course deleted"}