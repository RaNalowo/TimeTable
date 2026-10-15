from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, ForeignKey, Table, UniqueConstraint
)
from sqlalchemy.orm import relationship
from db.database import Base


# ============================================================
# Authentication
# ============================================================

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
    created_at = Column(DateTime, default=datetime.utcnow)

    # Student-specific
    group_id = Column(Integer, ForeignKey("student_groups.id"), nullable=True)

    roles = relationship("Role", secondary=user_roles, back_populates="users")
    group = relationship("StudentGroup", foreign_keys=[group_id])


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


# ============================================================
# Academic Hierarchy: Department → Program → Group
# ============================================================

class Department(Base):
    __tablename__ = "departments"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)


class Program(Base):
    __tablename__ = "programs"
    id = Column(Integer, primary_key=True, index=True)
    program_code = Column(String, unique=True, nullable=False)   # "0103"
    program_name = Column(String, nullable=False, index=True)    # "Information Systems"
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False)

    department = relationship("Department")


# ============================================================
# Resources
# ============================================================

class Room(Base):
    __tablename__ = "rooms"
    id = Column(Integer, primary_key=True, index=True)
    campus = Column(String, nullable=True)
    building = Column(String, nullable=False)
    room_code = Column(String, nullable=False)
    capacity = Column(Integer, nullable=False)
    room_type = Column(String, nullable=False)
    equipment = Column(String, nullable=True)

    __table_args__ = (
        UniqueConstraint("building", "room_code", name="uq_building_room"),
    )


class Teacher(Base):
    __tablename__ = "teachers"
    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)
    academic_title = Column(String, nullable=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    max_weekly_hours = Column(Integer, nullable=False, default=20)
    max_daily_hours = Column(Integer, nullable=False, default=4)
    qualified_subjects = Column(String, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)   # 可空

    department = relationship("Department")
    user = relationship("User", foreign_keys=[user_id])


class StudentGroup(Base):
    __tablename__ = "student_groups"

    id = Column(Integer, primary_key=True, index=True)
    group_code = Column(String, unique=True, nullable=False, index=True)
    program_id = Column(Integer, ForeignKey("programs.id"), nullable=True)
    enrollment_year = Column(Integer, nullable=True)   # ← 改这里（原来是 year）
    student_count = Column(Integer, default=0)

    program = relationship("Program")


class Course(Base):
    __tablename__ = "courses"
    id = Column(Integer, primary_key=True, index=True)
    course_code = Column(String, unique=True, nullable=False, index=True)
    course_name = Column(String, nullable=False)
    credits = Column(Integer, nullable=False, default=5)
    semester_level = Column(String, nullable=True)
    total_hours = Column(Integer, nullable=False)
    lecture_hours = Column(Integer, default=0)
    practice_hours = Column(Integer, default=0)
    lab_hours = Column(Integer, default=0)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)

    department = relationship("Department")


# Course ↔ Program many-to-many
course_target_programs = Table(
    "course_target_programs",
    Base.metadata,
    Column("course_id", Integer, ForeignKey("courses.id"), primary_key=True),
    Column("program_id", Integer, ForeignKey("programs.id"), primary_key=True),
)


# ============================================================
# Time / Semesters / Availability
# ============================================================

class Semester(Base):
    __tablename__ = "semesters"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)
    academic_year = Column(Integer, nullable=False)    # ← 加：2026
    term = Column(String, nullable=False)              # ← 加：Fall / Spring
    start_date = Column(String, nullable=False)
    end_date = Column(String, nullable=False)
    is_active = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class TimeSlot(Base):
    __tablename__ = "time_slots"
    id = Column(Integer, primary_key=True, index=True)
    slot_label = Column(String, unique=True, nullable=False, index=True)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class TeacherAvailability(Base):
    __tablename__ = "teacher_availability"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    matrix_json = Column(String, nullable=False, default="{}")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PreferenceWindow(Base):
    __tablename__ = "preference_windows"
    id = Column(Integer, primary_key=True, index=True)
    semester = Column(String, nullable=False, default="Current")
    is_frozen = Column(Boolean, default=False)
    freeze_date = Column(DateTime, nullable=True)


# ============================================================
# Constraints
# ============================================================

class Constraint(Base):
    __tablename__ = "constraints"
    id = Column(Integer, primary_key=True, index=True)
    constraint_type = Column(String, unique=True, nullable=False, index=True)
    is_active = Column(Boolean, default=True)
    config_json = Column(String, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SoftConstraint(Base):
    __tablename__ = "soft_constraints"
    id = Column(Integer, primary_key=True, index=True)
    constraint_key = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    weight = Column(Integer, default=5)
    is_enabled = Column(Boolean, default=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ============================================================
# Schedule Output
# ============================================================

class ScheduleEntry(Base):
    __tablename__ = "schedule_entries"
    id = Column(Integer, primary_key=True, index=True)
    day = Column(String, nullable=False)
    session_type = Column(String, nullable=True)

    # Foreign keys only — no redundant text
    time_slot_id = Column(Integer, ForeignKey("time_slots.id"), nullable=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=True)
    teacher_id = Column(Integer, ForeignKey("teachers.id"), nullable=True)
    group_id = Column(Integer, ForeignKey("student_groups.id"), nullable=True)
    semester_id = Column(Integer, ForeignKey("semesters.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    time_slot = relationship("TimeSlot")
    course = relationship("Course")
    room = relationship("Room")
    teacher = relationship("Teacher")
    group = relationship("StudentGroup")
    semester = relationship("Semester")