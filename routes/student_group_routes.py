from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import StudentGroup, User, Program, Department
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event

router = APIRouter(prefix="/student-groups", tags=["student-groups"])


class StudentGroupRequest(BaseModel):
    group_code: str = Field(min_length=1)
    program: str | None = None
    year: int | None = Field(default=None, ge=1, le=6)
    student_count: int = Field(default=0, ge=0, le=500)


def group_to_dict(g: StudentGroup, db: Session):
    program_name = None
    department_name = None

    if g.program_id:
        p = db.query(Program).filter_by(id=g.program_id).first()
        if p:
            program_name = p.program_name
            if p.department_id:
                d = db.query(Department).filter_by(id=p.department_id).first()
                department_name = d.name if d else None

    return {
        "id": g.id,
        "group_code": g.group_code,
        "program": program_name,
        "program_id": g.program_id,
        "department": department_name,
        "year": g.year,
        "student_count": g.student_count,
    }


@router.get("")
def list_groups(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    groups = db.query(StudentGroup).order_by(
        StudentGroup.year.asc(),
        StudentGroup.group_code.asc(),
    ).all()
    return [group_to_dict(g, db) for g in groups]


@router.get("/programs")
def list_programs(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    programs = db.query(Program).order_by(Program.program_name).all()
    return [{"id": p.id, "name": p.program_name, "code": p.program_code} for p in programs]


@router.get("/departments")
def list_departments_with_programs(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return departments with their nested programs (for the form dropdown)."""
    departments = db.query(Department).order_by(Department.name).all()
    result = []
    for d in departments:
        programs = db.query(Program).filter_by(department_id=d.id).all()
        result.append({
            "id": d.id,
            "name": d.name,
            "programs": [{"id": p.id, "name": p.program_name} for p in programs],
        })
    return result


@router.post("")
def create_group(
    data: StudentGroupRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    if db.query(StudentGroup).filter_by(group_code=data.group_code).first():
        raise HTTPException(status_code=400, detail="Group code already exists")

    program_id = None
    if data.program:
        p = db.query(Program).filter_by(program_name=data.program).first()
        if not p:
            raise HTTPException(status_code=400, detail=f"Program not found: {data.program}")
        program_id = p.id

    g = StudentGroup(
        group_code=data.group_code,
        program_id=program_id,
        year=data.year,
        student_count=data.student_count,
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    log_event(db, admin.id, "student_group_created", True, data.group_code)
    return group_to_dict(g, db)


@router.put("/{group_id}")
def update_group(
    group_id: int,
    data: StudentGroupRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    g = db.query(StudentGroup).filter_by(id=group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")

    dup = db.query(StudentGroup).filter(
        StudentGroup.group_code == data.group_code,
        StudentGroup.id != group_id,
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail="Group code already exists")

    program_id = None
    if data.program:
        p = db.query(Program).filter_by(program_name=data.program).first()
        if not p:
            raise HTTPException(status_code=400, detail=f"Program not found: {data.program}")
        program_id = p.id

    g.group_code = data.group_code
    g.program_id = program_id
    g.year = data.year
    g.student_count = data.student_count
    db.commit()
    db.refresh(g)

    log_event(db, admin.id, "student_group_updated", True, f"id={group_id}")
    return group_to_dict(g, db)


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
    log_event(db, admin.id, "student_group_deleted", True, f"id={group_id}")
    return {"message": "Group deleted"}