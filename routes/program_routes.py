from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Program, Department, StudentGroup, User
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event

router = APIRouter(prefix="/programs", tags=["programs"])


class ProgramRequest(BaseModel):
    program_code: str = Field(min_length=1, max_length=10)
    program_name: str = Field(min_length=1, max_length=100)
    department_id: int


def program_to_dict(p: Program, db: Session):
    dept = db.query(Department).filter_by(id=p.department_id).first()
    group_count = db.query(StudentGroup).filter_by(program_id=p.id).count()
    return {
        "id": p.id,
        "program_code": p.program_code,
        "program_name": p.program_name,
        "department_id": p.department_id,
        "department_name": dept.name if dept else None,
        "group_count": group_count,
    }


@router.get("")
def list_programs(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    programs = db.query(Program).order_by(Program.program_name).all()
    return [program_to_dict(p, db) for p in programs]


@router.get("/departments")
def list_departments(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    departments = db.query(Department).order_by(Department.name).all()
    return [{"id": d.id, "name": d.name} for d in departments]


@router.post("")
def create_program(
    data: ProgramRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    if db.query(Program).filter_by(program_code=data.program_code).first():
        raise HTTPException(status_code=400, detail="Program code already exists")

    if db.query(Program).filter_by(program_name=data.program_name).first():
        raise HTTPException(status_code=400, detail="Program name already exists")

    dept = db.query(Department).filter_by(id=data.department_id).first()
    if not dept:
        raise HTTPException(status_code=400, detail="Department not found")

    p = Program(
        program_code=data.program_code,
        program_name=data.program_name,
        department_id=data.department_id,
    )
    db.add(p)
    db.commit()
    db.refresh(p)

    log_event(db, admin.id, "program_created", True, data.program_code)
    return program_to_dict(p, db)


@router.put("/{program_id}")
def update_program(
    program_id: int,
    data: ProgramRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    p = db.query(Program).filter_by(id=program_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Program not found")

    dup_code = db.query(Program).filter(
        Program.program_code == data.program_code,
        Program.id != program_id,
    ).first()
    if dup_code:
        raise HTTPException(status_code=400, detail="Program code already exists")

    dup_name = db.query(Program).filter(
        Program.program_name == data.program_name,
        Program.id != program_id,
    ).first()
    if dup_name:
        raise HTTPException(status_code=400, detail="Program name already exists")

    dept = db.query(Department).filter_by(id=data.department_id).first()
    if not dept:
        raise HTTPException(status_code=400, detail="Department not found")

    p.program_code = data.program_code
    p.program_name = data.program_name
    p.department_id = data.department_id
    db.commit()
    db.refresh(p)

    log_event(db, admin.id, "program_updated", True, f"id={program_id}")
    return program_to_dict(p, db)


@router.delete("/{program_id}")
def delete_program(
    program_id: int,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    p = db.query(Program).filter_by(id=program_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Program not found")

    used = db.query(StudentGroup).filter_by(program_id=program_id).count()
    if used > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete: {used} student group(s) still use this program.",
        )

    db.delete(p)
    db.commit()
    log_event(db, admin.id, "program_deleted", True, f"id={program_id}")
    return {"message": "Program deleted"}