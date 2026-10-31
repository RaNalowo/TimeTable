from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Teacher, User, Department
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event

router = APIRouter(prefix="/teachers", tags=["teachers"])


class TeacherRequest(BaseModel):
    full_name: str = Field(min_length=1)
    email: str = Field(min_length=3)
    academic_title: str | None = None
    department: str | None = None          # department NAME (string)
    max_weekly_hours: int = Field(ge=1, le=40)
    max_daily_hours: int = Field(ge=1, le=12)
    qualified_subjects: str | None = None
    user_id: int | None = None


def teacher_to_dict(t: Teacher, db: Session):
    dept_name = None
    if t.department_id:
        d = db.query(Department).filter_by(id=t.department_id).first()
        dept_name = d.name if d else None

    return {
        "id": t.id,
        "full_name": t.full_name,
        "email": t.email,
        "academic_title": t.academic_title,
        "department": dept_name,
        "department_id": t.department_id,
        "max_weekly_hours": t.max_weekly_hours,
        "max_daily_hours": t.max_daily_hours,
        "qualified_subjects": t.qualified_subjects,
        "user_id": t.user_id,
    }


@router.get("")
def list_teachers(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    teachers = db.query(Teacher).all()

    def sort_key(t):
        is_incomplete = (not t.academic_title or not t.max_weekly_hours or not t.qualified_subjects)
        return (0 if is_incomplete else 1, t.full_name)

    teachers.sort(key=sort_key)
    return [teacher_to_dict(t, db) for t in teachers]


@router.post("")
def create_teacher(
    data: TeacherRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    if db.query(Teacher).filter_by(email=data.email).first():
        raise HTTPException(status_code=400, detail="Faculty email already exists")

    dept_id = None
    if data.department:
        d = db.query(Department).filter_by(name=data.department).first()
        if not d:
            raise HTTPException(status_code=400, detail="Department not found")
        dept_id = d.id

    teacher = Teacher(
        full_name=data.full_name,
        email=data.email,
        academic_title=data.academic_title,
        department_id=dept_id,
        max_weekly_hours=data.max_weekly_hours,
        max_daily_hours=data.max_daily_hours,
        qualified_subjects=data.qualified_subjects,
        user_id=data.user_id,
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)

    log_event(db, admin.id, "teacher_created", True, data.email)
    return teacher_to_dict(teacher, db)


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

    dept_id = None
    if data.department:
        d = db.query(Department).filter_by(name=data.department).first()
        if not d:
            raise HTTPException(status_code=400, detail="Department not found")
        dept_id = d.id

    teacher.full_name = data.full_name
    teacher.email = data.email
    teacher.academic_title = data.academic_title
    teacher.department_id = dept_id
    teacher.max_weekly_hours = data.max_weekly_hours
    teacher.max_daily_hours = data.max_daily_hours
    teacher.qualified_subjects = data.qualified_subjects
    teacher.user_id = data.user_id

    db.commit()
    db.refresh(teacher)
    log_event(db, admin.id, "teacher_updated", True, f"teacher_id={teacher_id}")
    return teacher_to_dict(teacher, db)


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