from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Program, Department, StudentGroup, User
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event

router = APIRouter(prefix="/programs", tags=["programs"])


class ProgramRequest(BaseModel):
    program_code: str
    program_name: str
    department_id: int
    tracks: str | None = None  # ★ 新增


def program_to_dict(db: Session, p: Program):
    dept = db.query(Department).filter_by(id=p.department_id).first()
    group_count = db.query(StudentGroup).filter_by(program_id=p.id).count()
    return {
        "id": p.id,
        "program_code": p.program_code,
        "program_name": p.program_name,
        "department_id": p.department_id,
        "department_name": dept.name if dept else None,
        "tracks": p.tracks,    # ★ 新增
        "group_count": group_count,
    }


@router.get("")
def list_programs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    progs = db.query(Program).order_by(Program.program_name).all()
    return [program_to_dict(db, p) for p in progs]


@router.get("/departments")
def list_departments(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    depts = db.query(Department).order_by(Department.name).all()
    return [{"id": d.id, "name": d.name} for d in depts]


@router.post("")
def create_program(data: ProgramRequest, admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    if db.query(Program).filter_by(program_code=data.program_code).first():
        raise HTTPException(status_code=400, detail="Program code already exists")

    dept = db.query(Department).filter_by(id=data.department_id).first()
    if not dept:
        raise HTTPException(status_code=400, detail="Department not found")

    p = Program(
        program_code=data.program_code,
        program_name=data.program_name,
        department_id=data.department_id,
        tracks=data.tracks   # ★ 新增
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    log_event(db, admin.id, "program_created", True, data.program_code)
    return program_to_dict(db, p)


@router.put("/{program_id}")
def update_program(program_id: int, data: ProgramRequest, admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    p = db.query(Program).filter_by(id=program_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Program not found")

    dup = db.query(Program).filter(Program.program_code == data.program_code, Program.id != program_id).first()
    if dup:
        raise HTTPException(status_code=400, detail="Program code already exists")

    if not db.get(Department, data.department_id):
        raise HTTPException(status_code=400, detail="Department not found")

    p.program_code = data.program_code
    p.program_name = data.program_name
    p.department_id = data.department_id
    p.tracks = data.tracks   # ★ 新增
    db.commit()
    db.refresh(p)

    log_event(db, admin.id, "program_updated", True, f"id={program_id}")
    return program_to_dict(db, p)


@router.delete("/{program_id}")
def delete_program(program_id: int, admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    p = db.query(Program).filter_by(id=program_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Program not found")
    db.delete(p)
    db.commit()
    log_event(db, admin.id, "program_deleted", True, f"id={program_id}")
    return {"message": "Program deleted"}