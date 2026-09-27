from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import StudentGroup, User
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event

router = APIRouter(prefix="/student-groups", tags=["student-groups"])


class StudentGroupRequest(BaseModel):
    group_code: str = Field(min_length=1)
    program: str | None = None
    year: int | None = Field(default=None, ge=1, le=6)
    student_count: int = Field(default=0, ge=0, le=500)


def group_to_dict(g: StudentGroup):
    return {
        "id": g.id,
        "group_code": g.group_code,
        "program": g.program,
        "year": g.year,
        "student_count": g.student_count,
    }


@router.get("")
def list_groups(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    groups = db.query(StudentGroup).order_by(StudentGroup.group_code).all()
    return [group_to_dict(g) for g in groups]


@router.post("")
def create_group(
    data: StudentGroupRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    if db.query(StudentGroup).filter_by(group_code=data.group_code).first():
        raise HTTPException(status_code=400, detail="Group code already exists")

    g = StudentGroup(
        group_code=data.group_code,
        program=data.program,
        year=data.year,
        student_count=data.student_count,
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    log_event(db, admin.id, "student_group_created", True, data.group_code)
    return group_to_dict(g)


@router.delete("/{group_id}")
def delete_group(
    group_id: int,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    g = db.query(StudentGroup).filter_by(id=group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    db.delete(g)
    db.commit()
    return {"message": "Group deleted"}