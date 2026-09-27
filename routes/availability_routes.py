import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import TeacherAvailability, PreferenceWindow, User, Teacher, Role
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event

router = APIRouter(prefix="/availability", tags=["availability"])

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
TIME_SLOTS = [
    "08:30-10:00",
    "10:15-11:45",
    "12:00-13:30",
    "13:30-15:00",
    "15:15-16:45",
    "17:00-18:30",
]
SLOT_HOURS = 1.5
VALID_STATUS = {"preferred", "neutral", "blocked"}
DEFAULT_MAX_HOURS = 20


class MatrixPayload(BaseModel):
    matrix: dict


def get_or_create_window(db: Session) -> PreferenceWindow:
    w = db.query(PreferenceWindow).first()
    if not w:
        w = PreferenceWindow(semester="Current", is_frozen=False)
        db.add(w)
        db.commit()
        db.refresh(w)
    return w


def default_matrix() -> dict:
    return {
        day: {slot: "neutral" for slot in TIME_SLOTS}
        for day in DAYS
    }


def get_teacher_for_user(db: Session, user: User):
    return db.query(Teacher).filter(Teacher.email == user.email).first()


def compute_stats(matrix: dict, max_hours: int):
    available_slots = 0
    total_slots = 0
    for day in DAYS:
        for slot in TIME_SLOTS:
            total_slots += 1
            if matrix.get(day, {}).get(slot, "neutral") != "blocked":
                available_slots += 1
    available_hours = available_slots * SLOT_HOURS
    required_hours = max_hours * 1.5
    return {
        "available_hours": available_hours,
        "required_hours": required_hours,
        "available_slots": available_slots,
        "total_slots": total_slots,
        "ok": available_hours >= required_hours,
    }


@router.get("/config")
def get_config(user: User = Depends(get_current_user)):
    return {
        "days": DAYS,
        "time_slots": TIME_SLOTS,
        "slot_hours": SLOT_HOURS,
    }


@router.get("/status")
def get_status(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    w = get_or_create_window(db)
    return {
        "is_frozen": w.is_frozen,
        "semester": w.semester,
        "freeze_date": w.freeze_date.isoformat() if w.freeze_date else None,
    }


@router.post("/freeze")
def toggle_freeze(
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    w = get_or_create_window(db)
    w.is_frozen = not w.is_frozen
    w.freeze_date = datetime.utcnow() if w.is_frozen else None
    db.commit()
    log_event(db, admin.id, "preference_freeze_toggled", True, f"is_frozen={w.is_frozen}")
    return {"is_frozen": w.is_frozen}


@router.get("/me")
def get_my_availability(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(TeacherAvailability).filter_by(user_id=user.id).first()
    matrix = json.loads(row.matrix_json) if row else default_matrix()

    # 补齐缺失的 slot（防止旧数据缺键）
    for day in DAYS:
        matrix.setdefault(day, {})
        for slot in TIME_SLOTS:
            matrix[day].setdefault(slot, "neutral")

    teacher = get_teacher_for_user(db, user)
    max_hours = teacher.max_weekly_hours if teacher else DEFAULT_MAX_HOURS

    w = get_or_create_window(db)

    return {
        "matrix": matrix,
        "max_hours": max_hours,
        "is_frozen": w.is_frozen,
        "stats": compute_stats(matrix, max_hours),
    }


@router.post("/me")
def save_my_availability(
    data: MatrixPayload,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 只有 teacher 角色可以提交
    role_names = [r.name for r in user.roles]
    if "teacher" not in role_names:
        raise HTTPException(status_code=403, detail="Only teachers can submit availability preferences")

    w = get_or_create_window(db)
    if w.is_frozen:
        raise HTTPException(status_code=403, detail="Preference submission period is closed")

    # 校验矩阵
    matrix = data.matrix
    for day in DAYS:
        if day not in matrix:
            raise HTTPException(status_code=400, detail=f"Missing day: {day}")
        for slot in TIME_SLOTS:
            status = matrix[day].get(slot, "neutral")
            if status not in VALID_STATUS:
                raise HTTPException(status_code=400, detail=f"Invalid status: {status}")

    # 校验 150% 约束
    teacher = get_teacher_for_user(db, user)
    max_hours = teacher.max_weekly_hours if teacher else DEFAULT_MAX_HOURS
    stats = compute_stats(matrix, max_hours)

    if not stats["ok"]:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Available timeslots must cover at least {stats['required_hours']} hours "
                f"(150% of {max_hours}h load). Currently available: {stats['available_hours']}h."
            ),
        )

    # 保存
    row = db.query(TeacherAvailability).filter_by(user_id=user.id).first()
    if not row:
        row = TeacherAvailability(user_id=user.id, matrix_json=json.dumps(matrix))
        db.add(row)
    else:
        row.matrix_json = json.dumps(matrix)
    db.commit()

    log_event(db, user.id, "availability_saved", True, f"slots={stats['available_slots']}")

    return {
        "message": "Availability preferences saved",
        "stats": stats,
    }


@router.get("/teacher/{user_id}")
def get_teacher_availability(
    user_id: int,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    target = db.query(User).filter_by(id=user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    row = db.query(TeacherAvailability).filter_by(user_id=user_id).first()
    matrix = json.loads(row.matrix_json) if row else default_matrix()

    teacher = get_teacher_for_user(db, target)
    max_hours = teacher.max_weekly_hours if teacher else DEFAULT_MAX_HOURS

    return {
        "user_id": target.id,
        "full_name": target.full_name,
        "email": target.email,
        "matrix": matrix,
        "max_hours": max_hours,
        "stats": compute_stats(matrix, max_hours),
    }


@router.get("/teachers")
def list_teachers_for_admin(
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    teacher_role = db.query(Role).filter_by(name="teacher").first()
    if not teacher_role:
        return []
    users = (
        db.query(User)
        .join(User.roles)
        .filter(Role.name == "teacher")
        .all()
    )
    return [{"id": u.id, "full_name": u.full_name, "email": u.email} for u in users]