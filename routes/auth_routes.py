import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import MAX_FAILED, LOCK_MINUTES
from db.database import get_db
from db.models import User, Role, PasswordResetToken
from services.security import (
    hash_password, verify_password, create_access_token, decode_token
)
from services.audit import log_event

router = APIRouter(prefix="/auth", tags=["auth"])


# ---------- Schemas ----------
class LoginRequest(BaseModel):
    identifier: str
    password: str


class ForgotRequest(BaseModel):
    email: str


class ResetRequest(BaseModel):
    token: str
    new_password: str


class CreateUserRequest(BaseModel):
    email: str
    full_name: str
    password: str
    role: str            # student | teacher | admin
    student_id: str | None = None
    employee_id: str | None = None


# ---------- Helpers ----------
def find_user(db: Session, identifier: str):
    return db.query(User).filter(
        (User.email == identifier) |
        (User.student_id == identifier) |
        (User.employee_id == identifier)
    ).first()


def get_current_user(authorization: str = Header(None), db: Session = Depends(get_db)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ")[1]
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.query(User).filter_by(id=int(payload["sub"])).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_role(role: str):
    def checker(user: User = Depends(get_current_user)):
        if role not in [r.name for r in user.roles]:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user
    return checker


# ---------- Auth Routes ----------
@router.post("/login")
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = find_user(db, data.identifier)

    if not user:
        log_event(db, None, "login_failed", False, "user not found")
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if user.status == "locked" and user.locked_until and user.locked_until > datetime.utcnow():
        log_event(db, user.id, "login_failed", False, "account locked")
        raise HTTPException(status_code=403, detail="Account locked. Try again later.")

    if not verify_password(data.password, user.password_hash):
        user.failed_attempts += 1
        if user.failed_attempts >= MAX_FAILED:
            user.status = "locked"
            user.locked_until = datetime.utcnow() + timedelta(minutes=LOCK_MINUTES)
            log_event(db, user.id, "account_locked", False, f"{MAX_FAILED} failed attempts")
        else:
            log_event(db, user.id, "login_failed", False, "wrong password")
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid credentials")

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
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "roles": roles,
        },
    }


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "roles": [r.name for r in user.roles],
    }


@router.post("/logout")
def logout(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    log_event(db, user.id, "logout", True)
    return {"message": "Logged out"}


# ---------- Password Reset ----------
@router.post("/forgot-password")
def forgot_password(data: ForgotRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(email=data.email).first()
    if user:
        token = secrets.token_urlsafe(32)
        db.add(PasswordResetToken(
            user_id=user.id,
            token=token,
            expires_at=datetime.utcnow() + timedelta(minutes=15),
        ))
        db.commit()
        print(f"[RESET LINK] http://127.0.0.1:8000/reset.html?token={token}")
    return {"message": "If the email exists, a reset link has been sent."}


@router.post("/reset-password")
def reset_password(data: ResetRequest, db: Session = Depends(get_db)):
    record = db.query(PasswordResetToken).filter_by(token=data.token).first()
    if not record or record.used or record.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    user = db.query(User).filter_by(id=record.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")

    user.password_hash = hash_password(data.new_password)
    user.failed_attempts = 0
    user.status = "active"
    user.locked_until = None
    record.used = True
    log_event(db, user.id, "password_reset", True)
    db.commit()
    return {"message": "Password reset successful"}


# ---------- Admin: User Management ----------
@router.get("/admin/users")
def admin_users(
    user: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    users = db.query(User).all()
    return [
        {
            "id": u.id,
            "email": u.email,
            "full_name": u.full_name,
            "roles": [r.name for r in u.roles],
            "status": u.status,
        }
        for u in users
    ]


@router.post("/admin/users")
def create_user(
    data: CreateUserRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    if db.query(User).filter_by(email=data.email).first():
        raise HTTPException(status_code=400, detail="Email already exists")

    role = db.query(Role).filter_by(name=data.role).first()
    if not role:
        raise HTTPException(status_code=400, detail="Invalid role")

    user = User(
        email=data.email,
        full_name=data.full_name,
        password_hash=hash_password(data.password),
        status="active",
        student_id=data.student_id or None,
        employee_id=data.employee_id or None,
    )
    user.roles.append(role)
    db.add(user)
    db.commit()
    db.refresh(user)

    log_event(db, admin.id, "user_created", True, f"created {data.email}")

    return {
        "message": "User created",
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "roles": [r.name for r in user.roles],
        },
    }