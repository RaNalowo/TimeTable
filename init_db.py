import os
import json
import csv

from db.database import Base, engine, SessionLocal
from db.models import (
    User, Role, Room, Teacher, StudentGroup, Course,
    Department, Program, Semester, TimeSlot, PreferenceWindow,
    Constraint, SoftConstraint
)
from services.security import hash_password

Base.metadata.create_all(bind=engine)
db = SessionLocal()

# ============================================================
# 1. Roles
# ============================================================

for name in ["student", "teacher", "admin"]:
    if not db.query(Role).filter_by(name=name).first():
        db.add(Role(name=name, description=f"{name} role"))
db.commit()
print("Seeded roles")

# ============================================================
# 2. Departments (4)
# ============================================================

DEPARTMENTS = [
    "Engineering and Natural Sciences",
    "Education and Humanities",
    "Business School",
    "Law and Social Sciences",
]

dept_map = {}
for name in DEPARTMENTS:
    d = db.query(Department).filter_by(name=name).first()
    if not d:
        d = Department(name=name)
        db.add(d)
        db.commit()
        db.refresh(d)
    dept_map[name] = d.id

print(f"Seeded {len(dept_map)} departments")

# ============================================================
# 3. Programs (2)
# ============================================================

PROGRAMS = [
    ("0103", "Information Systems", "Engineering and Natural Sciences", "AI,CYBER,FRONT,BACK"),
    ("0104", "Computer Science", "Engineering and Natural Sciences", "AI,CYBER,SOFT,HARD"),
]

program_map = {}
for code, name, dept_name, tracks_str in PROGRAMS:
    p = db.query(Program).filter_by(program_code=code).first()
    if not p:
        p = Program(
            program_code=code,
            program_name=name,
            department_id=dept_map[dept_name],
            tracks=tracks_str,
        )
        db.add(p)
        db.commit()
        db.refresh(p)
    else:
        p.tracks = tracks_str
        db.commit()
    program_map[name] = p.id

print(f"Seeded {len(program_map)} programs")


# ============================================================
# 4. Teachers
# ============================================================

def load_teachers_from_csv(path="teachers.csv"):
    if not os.path.exists(path):
        print(f"{path} not found, skipping")
        return

    with open(path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            email = row["email"].strip().lower()
            if db.query(Teacher).filter_by(email=email).first():
                continue

            dept_id = dept_map.get(row["department"].strip())

            t = Teacher(
                full_name=row["full_name"].strip(),
                email=email,
                academic_title=row.get("academic_title", "").strip() or None,
                department_id=dept_id,
                max_weekly_hours=int(row["max_weekly_hours"]),
                max_daily_hours=int(row["max_daily_hours"]),
                qualified_subjects=row.get("qualified_subjects", "").strip() or None,
            )
            db.add(t)
            db.commit()

    print("Imported teachers from CSV")


load_teachers_from_csv()


# ============================================================
# 5. Student Groups
# ============================================================

def load_groups_from_csv(path="student_groups.csv"):
    if not os.path.exists(path):
        print(f"{path} not found, skipping")
        return

    with open(path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            code = row["group_code"].strip()
            if db.query(StudentGroup).filter_by(group_code=code).first():
                continue

            program_name = row["program"].strip()
            program_id = program_map.get(program_name)

            db.add(StudentGroup(
                group_code=code,
                program_id=program_id,
                enrollment_year=int(row["enrollment_year"]) if row.get("enrollment_year") else None,
                student_count=int(row["student_count"]) if row.get("student_count") else 0,
                sub_group_count=int(row["sub_group_count"]) if row.get("sub_group_count") else 3,
                track=row.get("track", "").strip() or None,
            ))
    db.commit()
    print("Imported student groups from CSV")


load_groups_from_csv()


# ============================================================
# 6. Rooms
# ============================================================

def load_rooms_from_csv(path="rooms.csv"):
    if not os.path.exists(path):
        print(f"{path} not found, skipping")
        return

    with open(path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            code = row["room_code"].strip()
            building = row["building"].strip()
            if db.query(Room).filter_by(building=building, room_code=code).first():
                continue
            db.add(Room(
                campus=row.get("campus", "Main").strip() or "Main",
                building=building,
                room_code=code,
                capacity=int(row["capacity"]),
                room_type=row["room_type"].strip(),
                equipment=row.get("equipment", "").strip() or None,
            ))
    db.commit()
    print("Imported rooms from CSV")


load_rooms_from_csv()


# ============================================================
# 7. Courses (按 program 分文件导入)
# ============================================================

def load_courses_from_csv(path, program_name):
    if not os.path.exists(path):
        print(f"{path} not found, skipping")
        return

    program = db.query(Program).filter_by(program_name=program_name).first()
    if not program:
        print(f"[WARN] Program '{program_name}' not found, skipping {path}")
        return

    with open(path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            code = row["course_code"].strip()
            existing = db.query(Course).filter_by(course_code=code).first()
            if existing:
                continue

            dept_name = row.get("department", "").strip()
            dept_id = dept_map.get(dept_name)

            is_elective_val = row.get("is_elective", "0").strip()
            is_elective = is_elective_val in ("1", "True", "true")

            c = Course(
                course_code=code,
                course_name=row["course_name"].strip(),
                credits=int(row["credits"]) if row.get("credits") else 5,
                semester_level=row.get("semester_level", "").strip() or None,
                total_hours=int(row["total_hours"]),
                lecture_hours=int(row["lecture_hours"] or 0),
                practice_hours=int(row["practice_hours"] or 0),
                lab_hours=int(row["lab_hours"] or 0),
                department_id=dept_id,
                program_id=program.id,
                is_elective=is_elective,
                track=row.get("track", "").strip() or None,
            )
            db.add(c)
            db.commit()

    print(f"Imported courses from {path} → {program_name}")


load_courses_from_csv("courses_is.csv", "Information Systems")
load_courses_from_csv("courses_cs.csv", "Computer Science")

# ============================================================
# 8. Semesters
# ============================================================

if db.query(Semester).count() == 0:
    db.add_all([
        Semester(name="2026 Fall", academic_year=2026, term="Fall",
                 start_date="2026-09-01", end_date="2026-12-20",
                 is_active=True),
        Semester(name="2027 Spring", academic_year=2027, term="Spring",
                 start_date="2027-01-15", end_date="2027-05-30",
                 is_active=False),
    ])
    db.commit()
    print("Seeded 2 semesters")

# ============================================================
# 9. Time Slots (10, SDU real)
# ============================================================

if db.query(TimeSlot).count() == 0:
    slots = [
        ("08:30-09:20", 1),
        ("09:30-10:20", 2),
        ("10:30-11:20", 3),
        ("11:30-12:20", 4),
        ("12:30-13:20", 5),
        ("13:30-14:20", 6),
        ("14:30-15:20", 7),
        ("15:30-16:20", 8),
        ("16:30-17:20", 9),
        ("17:30-18:20", 10),
    ]
    for label, order in slots:
        db.add(TimeSlot(slot_label=label, sort_order=order, is_active=True))
    db.commit()
    print("Seeded 10 time slots")

# ============================================================
# 10. Preference Window
# ============================================================

if db.query(PreferenceWindow).count() == 0:
    db.add(PreferenceWindow(semester="Current", is_frozen=False))
    db.commit()
    print("Seeded preference window")

# ============================================================
# 11. Hard Constraints
# ============================================================

if db.query(Constraint).count() == 0:
    defaults = {
        "no_overlap_rooms": (True, None),
        "no_overlap_teachers": (True, None),
        "lunch_break": (False, {"start": "12:00", "end": "13:00",
                                "days": ["Mon", "Tue", "Wed", "Thu", "Fri"]}),
    }
    for ctype, (active, cfg) in defaults.items():
        db.add(Constraint(
            constraint_type=ctype,
            is_active=active,
            config_json=json.dumps(cfg) if cfg else None,
        ))
    db.commit()
    print("Seeded hard constraints")

# ============================================================
# 12. Soft Constraints
# ============================================================

if db.query(SoftConstraint).count() == 0:
    defaults = [
        ("minimize_gaps", "Minimize Gaps", "Reduce idle time between classes.", 5),
        ("avoid_early_mornings", "Avoid Early Mornings", "Penalize 08:30 slots.", 5),
        ("avoid_late_evenings", "Avoid Late Evenings", "Penalize 17:00 slots.", 5),
        ("compact_days", "Compact Days", "Prefer fewer days with more classes.", 5),
    ]
    for key, name, desc, w in defaults:
        db.add(SoftConstraint(
            constraint_key=key, display_name=name, description=desc,
            weight=w, is_enabled=True,
        ))
    db.commit()
    print("Seeded soft constraints")


# ============================================================
# 13. Users (from users.csv)
# ============================================================

def load_users_from_csv(path="users.csv"):
    if not os.path.exists(path):
        print(f"{path} not found, skipping")
        return

    count = 0
    with open(path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            email = row["email"].strip().lower()
            if db.query(User).filter_by(email=email).first():
                continue

            role_name = row["role"].strip().lower()
            role = db.query(Role).filter_by(name=role_name).first()
            if not role:
                continue

            # 根据角色分配默认密码
            if role_name == "admin":
                default_pwd = "Admin123!"
            elif role_name == "teacher":
                default_pwd = "Teacher123!"
            else:
                default_pwd = "Student123!"

            # 如果学生填了 group_code，就去库里反查 group_id
            group_id = None
            if row.get("group_code"):
                g = db.query(StudentGroup).filter_by(group_code=row["group_code"].strip()).first()
                if g:
                    group_id = g.id

            u = User(
                email=email,
                full_name=row["full_name"].strip(),
                password_hash=hash_password(default_pwd),  # ★ 统一分配初始密码
                status="active",
                student_id=row.get("student_id", "").strip() or None,
                employee_id=row.get("employee_id", "").strip() or None,
                group_id=group_id,
            )
            u.roles.append(role)
            db.add(u)
            count += 1

    db.commit()
    print(f"Imported {count} users from CSV (Default passwords assigned)")


load_users_from_csv()

db.close()
print()
print("=== DATABASE SEEDED ===")
print("Run: uvicorn app:app --reload")