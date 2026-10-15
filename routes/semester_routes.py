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
    academic_year: int = Field(ge=2000, le=2100)
    term: str = Field(min_length=1, max_length=20)
    start_date: str
    end_date: str


def semester_to_dict(s: Semester):
    return {
        "id": s.id,
        "name": s.name,
        "academic_year": s.academic_year,
        "term": s.term,
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


def check_overlap(db: Session, start: str, end: str, exclude_id: int = None):
    """
    Return an existing semester whose date range overlaps with [start, end],
    or None if no overlap.
    """
    q = db.query(Semester)
    if exclude_id is not None:
        q = q.filter(Semester.id != exclude_id)

    for sem in q.all():
        # Two date ranges overlap if:
        #   new_start < existing_end  AND  new_end > existing_start
        if start < sem.end_date and end > sem.start_date:
            return sem
    return None


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

    # Duplicate name check
    if db.query(Semester).filter_by(name=name).first():
        raise HTTPException(
            status_code=400,
            detail="A semester with this name already exists",
        )

    # Date overlap check
    overlap = check_overlap(db, data.start_date, data.end_date)
    if overlap:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Date range overlaps with existing semester "
                f"'{overlap.name}' ({overlap.start_date} to {overlap.end_date})."
            ),
        )

    sem = Semester(
        name=name,
        academic_year=data.academic_year,
        term=data.term,
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

    # Duplicate name check (excluding self)
    dup = db.query(Semester).filter(
        Semester.name == name,
        Semester.id != semester_id,
    ).first()
    if dup:
        raise HTTPException(
            status_code=400,
            detail="A semester with this name already exists",
        )

    # Date overlap check (excluding self)
    overlap = check_overlap(
        db, data.start_date, data.end_date, exclude_id=semester_id
    )
    if overlap:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Date range overlaps with existing semester "
                f"'{overlap.name}' ({overlap.start_date} to {overlap.end_date})."
            ),
        )

    sem.name = name
    sem.academic_year = data.academic_year
    sem.term = data.term
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