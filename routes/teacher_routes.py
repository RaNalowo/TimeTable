from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Teacher, User
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event

router = APIRouter(prefix="/teachers", tags=["teachers"])


class TeacherRequest(BaseModel):
    full_name: str = Field(min_length=1)
    email: str = Field(min_length=3)
    academic_title: str | None = None
    department: str = Field(min_length=1)
    max_weekly_hours: int = Field(ge=1, le=40)
    max_daily_hours: int = Field(ge=1, le=12)
    qualified_subjects: str | None = None
    user_id: int | None = None


def teacher_to_dict(t: Teacher):
    return {
        "id": t.id,
        "full_name": t.full_name,
        "email": t.email,
        "academic_title": t.academic_title,
        "department": t.department,
        "max_weekly_hours": t.max_weekly_hours,
        "max_daily_hours": t.max_daily_hours,
        "qualified_subjects": t.qualified_subjects,
        "user_id": t.user_id,
    }


@router.get("")
def list_teachers(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    teachers = db.query(Teacher).order_by(Teacher.department, Teacher.full_name).all()
    return [teacher_to_dict(t) for t in teachers]


@router.post("")
def create_teacher(
    data: TeacherRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    if db.query(Teacher).filter_by(email=data.email).first():
        raise HTTPException(status_code=400, detail="Faculty email already exists")

    teacher = Teacher(
        full_name=data.full_name,
        email=data.email,
        academic_title=data.academic_title,
        department=data.department,
        max_weekly_hours=data.max_weekly_hours,
        max_daily_hours=data.max_daily_hours,
        qualified_subjects=data.qualified_subjects,
        user_id=data.user_id,
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)

    log_event(db, admin.id, "teacher_created", True, data.email)
    return teacher_to_dict(teacher)


@router.put("/{teacher_id}")
def update_teacher(
    teacher_id: int,
    data: TeacherRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    teacher = db.query(Teacher).filter_by(id=teacher_id).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    dup = db.query(Teacher).filter(
        Teacher.email == data.email,
        Teacher.id != teacher_id,
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail="Faculty email already exists")

    teacher.full_name = data.full_name
    teacher.email = data.email
    teacher.academic_title = data.academic_title
    teacher.department = data.department
    teacher.max_weekly_hours = data.max_weekly_hours
    teacher.max_daily_hours = data.max_daily_hours
    teacher.qualified_subjects = data.qualified_subjects
    teacher.user_id = data.user_id

    db.commit()
    db.refresh(teacher)
    log_event(db, admin.id, "teacher_updated", True, f"teacher_id={teacher_id}")
    return teacher_to_dict(teacher)


@router.delete("/{teacher_id}")
def delete_teacher(
    teacher_id: int,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    teacher = db.query(Teacher).filter_by(id=teacher_id).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    db.delete(teacher)
    db.commit()
    log_event(db, admin.id, "teacher_deleted", True, f"teacher_id={teacher_id}")
    return {"message": "Teacher deleted"}