from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, ForeignKey, Table
)
from sqlalchemy.orm import relationship
from db.database import Base
from sqlalchemy import UniqueConstraint


user_roles = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id"), primary_key=True),
    Column("role_id", Integer, ForeignKey("roles.id"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    student_id = Column(String, unique=True, nullable=True)
    employee_id = Column(String, unique=True, nullable=True)
    password_hash = Column(String, nullable=False)
    full_name = Column(String, nullable=False)
    status = Column(String, default="active")
    failed_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime, nullable=True)
    last_login_at = Column(DateTime, nullable=True)
    roles = relationship("Role", secondary=user_roles, back_populates="users")


class Role(Base):
    __tablename__ = "roles"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)
    users = relationship("User", secondary=user_roles, back_populates="roles")


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    event = Column(String, nullable=False)
    success = Column(Boolean, nullable=False)
    detail = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token = Column(String, unique=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)

class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    campus = Column(String, nullable=True)          # 可选校区
    building = Column(String, nullable=False)       # 建筑名
    room_code = Column(String, nullable=False)      # 房间编号
    capacity = Column(Integer, nullable=False)      # 容量
    room_type = Column(String, nullable=False)      # Lecture Hall / Computer Lab / ...
    equipment = Column(String, nullable=True)       # 逗号分隔，如 "Projector, AC"

    __table_args__ = (
        UniqueConstraint("building", "room_code", name="uq_building_room"),
    )