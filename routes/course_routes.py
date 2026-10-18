from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import (
    Course, User, Program, Department
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

    # ★ 新架构字段
    program_id: int
    is_elective: bool = False
    track: str | None = None
    department: str | None = None  # department name (string)


def course_to_dict(db: Session, c: Course):
    dept = None
    if c.department_id:
        d = db.query(Department).filter_by(id=c.department_id).first()
        dept = d.name if d else None

    prog = db.query(Program).filter_by(id=c.program_id).first()
    prog_name = prog.program_name if prog else None

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

        "program_id": c.program_id,
        "program_name": prog_name,
        "is_elective": c.is_elective,
        "track": c.track,

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

    # 检查 Program 是否存在
    prog = db.query(Program).filter_by(id=data.program_id).first()
    if not prog:
        raise HTTPException(status_code=400, detail="Program not found")

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
        program_id=data.program_id,
        is_elective=data.is_elective,
        track=data.track,
    )
    db.add(course)
    db.commit()
    db.refresh(course)

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

    # 检查 Program 是否存在
    prog = db.query(Program).filter_by(id=data.program_id).first()
    if not prog:
        raise HTTPException(status_code=400, detail="Program not found")

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

    course.program_id = data.program_id
    course.is_elective = data.is_elective
    course.track = data.track

    db.commit()
    db.refresh(course)

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

    db.delete(course)
    db.commit()

    log_event(db, admin.id, "course_deleted", True, f"course_id={course_id}")
    return {"message": "Course deleted"}