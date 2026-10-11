from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Semester, User
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event

router = APIRouter(prefix="/semesters", tags=["semesters"])


class SemesterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    start_date: str
    end_date: str


def semester_to_dict(s: Semester):
    return {
        "id": s.id,
        "name": s.name,
        "start_date": s.start_date,
        "end_date": s.end_date,
        "is_active": s.is_active,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


def validate_dates(start: str, end: str):
    fmt = "%Y-%m-%d"
    try:
        s = datetime.strptime(start, fmt)
        e = datetime.strptime(end, fmt)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid date format. Use YYYY-MM-DD.",
        )
    if s >= e:
        raise HTTPException(
            status_code=400,
            detail="Start date must be before end date.",
        )


@router.get("")
def list_semesters(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.query(Semester).order_by(Semester.start_date.desc()).all()
    return [semester_to_dict(s) for s in rows]


@router.get("/active")
def get_active_semester(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    active = db.query(Semester).filter_by(is_active=True).first()
    if not active:
        return {"active": None}
    return {"active": semester_to_dict(active)}


@router.post("")
def create_semester(
    data: SemesterRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    name = data.name.strip()
    validate_dates(data.start_date, data.end_date)

    if db.query(Semester).filter_by(name=name).first():
        raise HTTPException(
            status_code=400,
            detail="A semester with this name already exists",
        )

    sem = Semester(
        name=name,
        start_date=data.start_date,
        end_date=data.end_date,
        is_active=False,
    )
    db.add(sem)
    db.commit()
    db.refresh(sem)

    log_event(db, admin.id, "semester_created", True, name)
    return semester_to_dict(sem)


@router.put("/{semester_id}")
def update_semester(
    semester_id: int,
    data: SemesterRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    sem = db.query(Semester).filter_by(id=semester_id).first()
    if not sem:
        raise HTTPException(status_code=404, detail="Semester not found")

    name = data.name.strip()
    validate_dates(data.start_date, data.end_date)

    dup = db.query(Semester).filter(
        Semester.name == name,
        Semester.id != semester_id,
    ).first()
    if dup:
        raise HTTPException(
            status_code=400,
            detail="A semester with this name already exists",
        )

    sem.name = name
    sem.start_date = data.start_date
    sem.end_date = data.end_date
    db.commit()
    db.refresh(sem)

    log_event(db, admin.id, "semester_updated", True, f"id={semester_id}")
    return semester_to_dict(sem)


@router.post("/{semester_id}/activate")
def activate_semester(
    semester_id: int,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    sem = db.query(Semester).filter_by(id=semester_id).first()
    if not sem:
        raise HTTPException(status_code=404, detail="Semester not found")

    # Deactivate all others
    db.query(Semester).update({Semester.is_active: False})
    sem.is_active = True
    db.commit()
    db.refresh(sem)

    log_event(db, admin.id, "semester_activated", True, sem.name)
    return semester_to_dict(sem)


@router.delete("/{semester_id}")
def delete_semester(
    semester_id: int,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    sem = db.query(Semester).filter_by(id=semester_id).first()
    if not sem:
        raise HTTPException(status_code=404, detail="Semester not found")

    if sem.is_active:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the active semester. Activate another one first.",
        )

    db.delete(sem)
    db.commit()
    log_event(db, admin.id, "semester_deleted", True, f"id={semester_id}")
    return {"message": "Semester deleted"}