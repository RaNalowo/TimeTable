from datetime import datetime, timedelta
import random
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field, field_validator
from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from config import MAX_FAILED, LOCK_MINUTES
from db.database import get_db
from db.models import User, Role, Program, StudentGroup, Teacher
from services.security import (
    hash_password, verify_password, create_access_token, decode_token
)
from services.audit import log_event

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=256)


# 修改 Request，不再强制要求 email 和 password
class CreateUserRequest(BaseModel):
    role: str  # student | teacher | admin
    full_name: str
    email: str | None = None  # 仅老师/管理员需要
    enrollment_year: int | None = None  # 仅学生需要
    program_id: int | None = None  # 仅学生需要
    track: str | None = None  # 仅学生需要


def find_user(db: Session, identifier: str):
    return db.query(User).filter(
        (User.email == identifier) |
        (User.student_id == identifier) |
        (User.employee_id == identifier)
    ).first()


def get_current_user(authorization: str = Header(None), db: Session = Depends(get_db)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = decode_token(token)
        user_id = int(payload["sub"])
    except (InvalidTokenError, ValueError, TypeError, KeyError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="Account is not active")
    return user


def require_role(role: str):
    def checker(user: User = Depends(get_current_user)):
        if role not in [r.name for r in user.roles]:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user

    return checker


@router.post("/login")
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = find_user(db, data.identifier)
    if not user:
        log_event(db, None, "login_failed", False, "user not found")
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.status == "locked" and user.locked_until and user.locked_until > datetime.utcnow():
        raise HTTPException(status_code=403, detail="Account locked. Try again later.")
    if not verify_password(data.password, user.password_hash):
        user.failed_attempts += 1
        if user.failed_attempts >= MAX_FAILED:
            user.status = "locked"
            user.locked_until = datetime.utcnow() + timedelta(minutes=LOCK_MINUTES)
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user.failed_attempts = 0
    user.status = "active"
    user.locked_until = None
    user.last_login_at = datetime.utcnow()
    roles = [r.name for r in user.roles]
    token = create_access_token(user.id, roles)
    log_event(db, user.id, "login_success", True)
    db.commit()

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user.id, "email": user.email, "full_name": user.full_name, "roles": roles},
    }


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "full_name": user.full_name, "roles": [r.name for r in user.roles]}


@router.post("/logout")
def logout(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    log_event(db, user.id, "logout", True)
    return {"message": "Logged out"}


# ============================================================
# Admin: User Management (核心逻辑)
# ============================================================

@router.get("/admin/users")
def admin_users(user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    users = db.query(User).all()
    return [
        {
            "id": u.id, "email": u.email, "full_name": u.full_name,
            "roles": [r.name for r in u.roles], "status": u.status,
        } for u in users
    ]


@router.post("/admin/users")
def create_user(data: CreateUserRequest, admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    role_name = data.role.lower()
    role = db.query(Role).filter_by(name=role_name).first()
    if not role:
        raise HTTPException(status_code=400, detail="Invalid role")

    final_email = None
    student_id = None
    group_id = None
    group_code_str = None
    default_password = "Password123!"

    # ================= 如果是学生 =================
    if role_name == "student":
        if not data.enrollment_year or not data.program_id:
            raise HTTPException(status_code=400, detail="Student requires enrollment_year and program_id")

        program = db.query(Program).filter_by(id=data.program_id).first()
        if not program:
            raise HTTPException(status_code=400, detail="Program not found")

        # 1. 拼接 Group Code
        prog_prefix = "IS" if "Information" in program.program_name else "CS"
        year_short = str(data.enrollment_year)[-2:]
        track_str = data.track or ""
        target_group_code = f"{prog_prefix}-{year_short}-{track_str}".strip("-")

        group = db.query(StudentGroup).filter_by(group_code=target_group_code).first()
        if not group:
            raise HTTPException(status_code=400,
                                detail=f"Target group '{target_group_code}' does not exist in the system.")

        group_id = group.id
        group_code_str = group.group_code
        group.student_count += 1  # ★ 组内人数+1

        # 2. 生成绝对不重复的学号
        while True:
            rand_digits = random.randint(100, 999)
            new_sid = f"{year_short}{program.program_code}{rand_digits}"
            if not db.query(User).filter_by(student_id=new_sid).first():
                student_id = new_sid
                break

        # 3. 自动生成邮箱
        final_email = f"{student_id}@sdu.edu.kz"
        default_password = "Student123!"

        # ================= 如果是老师/管理员 =================
    else:
        if not data.email:
            raise HTTPException(status_code=400, detail="Email is required for teachers and admins")

        raw_email = data.email.strip().lower()
        # 如果用户多手打了 @sdu.edu.kz，截断它
        if "@" in raw_email:
            raw_email = raw_email.split("@")[0]

        final_email = f"{raw_email}@sdu.edu.kz"

        if db.query(User).filter_by(email=final_email).first():
            raise HTTPException(status_code=400, detail="Email prefix already exists")

        default_password = "Teacher123!" if role_name == "teacher" else "Admin123!"

    # ================= 创建 User =================
    user = User(
        email=final_email,
        full_name=data.full_name,
        password_hash=hash_password(default_password),
        status="active",
        student_id=student_id,
        employee_id=None,
        group_id=group_id,
    )
    user.roles.append(role)
    db.add(user)
    db.flush()

    # ================= 如果是老师，同步创建空档案 =================
    if role_name == "teacher":
        t = Teacher(
            full_name=data.full_name,
            email=final_email,
            department_id=None,
            max_weekly_hours=0,
            max_daily_hours=0,
            qualified_subjects=None,
            user_id=user.id
        )
        db.add(t)

    db.commit()
    db.refresh(user)
    log_event(db, admin.id, "user_created", True, f"created {final_email}")

    return {
        "message": "User created",
        "user": {
            "email": user.email,
            "student_id": student_id,
            "group_code": group_code_str,  # ★ 把组名返回给前端
            "default_password": default_password
        }
    }