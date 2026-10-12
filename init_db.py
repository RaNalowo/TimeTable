import os
import json

from db.database import Base, engine, SessionLocal
from db.models import (
    User, Role, Room, Teacher, StudentGroup, Course,
    Department, Program, Semester, TimeSlot, PreferenceWindow,
    Constraint, SoftConstraint, course_target_programs
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
    ("0103", "Information Systems", "Engineering and Natural Sciences"),
    ("0104", "Computer Science",      "Engineering and Natural Sciences"),
]

program_map = {}
for code, name, dept_name in PROGRAMS:
    p = db.query(Program).filter_by(program_code=code).first()
    if not p:
        p = Program(
            program_code=code,
            program_name=name,
            department_id=dept_map[dept_name],
        )
        db.add(p)
        db.commit()
        db.refresh(p)
    program_map[name] = p.id

print(f"Seeded {len(program_map)} programs")


# ============================================================
# 4. Teachers (5 with account + 44 without)
# ============================================================

def load_teachers_from_csv(path="teachers.csv"):
    import csv
    if not os.path.exists(path):
        print(f"{path} not found, skipping")
        return

    ACCOUNT_EMAILS = {
        "a.sabitov@sdu.edu.kz",
        "d.kuanyshbay@sdu.edu.kz",
        "k.berikbayev@sdu.edu.kz",
        "m.zhailau@sdu.edu.kz",
        "a.yergaliyeva@sdu.edu.kz",
    }

    teacher_role = db.query(Role).filter_by(name="teacher").first()

    with open(path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            email = row["email"].strip().lower()
            if db.query(Teacher).filter_by(email=email).first():
                continue

            dept_id = dept_map.get(row["department"].strip())

            user_id = None
            if email in ACCOUNT_EMAILS:
                # Create matching user account
                if not db.query(User).filter_by(email=email).first():
                    u = User(
                        email=email,
                        full_name=row["full_name"].strip(),
                        password_hash=hash_password("Teacher123!"),
                        status="active",
                    )
                    u.roles.append(teacher_role)
                    db.add(u)
                    db.commit()
                    db.refresh(u)
                    user_id = u.id

            t = Teacher(
                full_name=row["full_name"].strip(),
                email=email,
                academic_title=row.get("academic_title", "").strip() or None,
                department_id=dept_id,
                max_weekly_hours=int(row["max_weekly_hours"]),
                max_daily_hours=int(row["max_daily_hours"]),
                qualified_subjects=row.get("qualified_subjects", "").strip() or None,
                user_id=user_id,
            )
            db.add(t)
            db.commit()

    print("Imported teachers from CSV")


load_teachers_from_csv()


# ============================================================
# 5. Student Groups (22 from CSV)
# ============================================================

def load_groups_from_csv(path="student_groups.csv"):
    import csv
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
                year=int(row["year"]) if row.get("year") else None,
                student_count=int(row["student_count"]) if row.get("student_count") else 0,
            ))
    db.commit()
    print("Imported student groups from CSV")


load_groups_from_csv()


# ============================================================
# 6. Rooms (from CSV)
# ============================================================

def load_rooms_from_csv(path="rooms.csv"):
    import csv
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
# 7. Courses (from CSV, with course_target_programs)
# ============================================================

def load_courses_from_csv(path="courses.csv"):
    import csv
    if not os.path.exists(path):
        print(f"{path} not found, skipping")
        return

    with open(path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            code = row["course_code"].strip()
            existing = db.query(Course).filter_by(course_code=code).first()
            if existing:
                continue

            dept_name = row.get("department", "").strip()
            dept_id = dept_map.get(dept_name)

            c = Course(
                course_code=code,
                course_name=row["course_name"].strip(),
                credits=int(row["credits"]) if row.get("credits") else 5,
                semester_level=row.get("semester_level", "").strip() or None,
                total_hours=int(row["total_hours"]),
                lecture_hours=int(row["lecture_hours"]),
                practice_hours=int(row["practice_hours"]),
                lab_hours=int(row["lab_hours"]),
                department_id=dept_id,
            )
            db.add(c)
            db.commit()
            db.refresh(c)

            # target_groups → course_target_programs
            target_str = row.get("target_groups", "").strip()
            if target_str:
                for prog_name in [p.strip() for p in target_str.split(",") if p.strip()]:
                    prog_id = program_map.get(prog_name)
                    if prog_id:
                        db.execute(
                            course_target_programs.insert().values(
                                course_id=c.id, program_id=prog_id
                            )
                        )
                db.commit()

    print("Imported courses from CSV")


load_courses_from_csv()


# ============================================================
# 8. Semesters
# ============================================================

if db.query(Semester).count() == 0:
    db.add_all([
        Semester(name="2026 Fall", start_date="2026-09-01",
                 end_date="2026-12-20", is_active=True),
        Semester(name="2027 Spring", start_date="2027-01-15",
                 end_date="2027-05-30", is_active=False),
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
        "no_overlap_rooms":    (True,  None),
        "no_overlap_teachers": (True,  None),
        "lunch_break":         (False, {"start": "12:00", "end": "13:00",
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
        ("minimize_gaps",         "Minimize Gaps",         "Reduce idle time between classes.", 5),
        ("avoid_early_mornings",  "Avoid Early Mornings",  "Penalize 08:30 slots.", 5),
        ("avoid_late_evenings",   "Avoid Late Evenings",   "Penalize 17:00 slots.", 5),
        ("compact_days",          "Compact Days",          "Prefer fewer days with more classes.", 5),
    ]
    for key, name, desc, w in defaults:
        db.add(SoftConstraint(
            constraint_key=key, display_name=name, description=desc,
            weight=w, is_enabled=True,
        ))
    db.commit()
    print("Seeded soft constraints")


# ============================================================
# 13. Default Users (admin + 5 students)
# ============================================================

# Admin
admin_role = db.query(Role).filter_by(name="admin").first()
if not db.query(User).filter_by(email="admin@sdu.edu.kz").first():
    admin = User(
        email="admin@sdu.edu.kz",
        employee_id="EMP001",
        full_name="System Admin",
        password_hash=hash_password("Admin123!"),
        status="active",
    )
    admin.roles.append(admin_role)
    db.add(admin)
    db.commit()
    print("Created admin@sdu.edu.kz")


# 5 Students
STUDENTS = [
    ("230103191", "IS-4-A", "Aibek Nurlan"),
    ("230103192", "IS-4-B", "Dana Bekova"),
    ("230103193", "IS-4-C", "Arman Serikov"),
    ("240103101", "IS-3-A", "Aigerim Zhumabek"),
    ("240103102", "IS-3-B", "Dias Tolegenov"),
]

student_role = db.query(Role).filter_by(name="student").first()

for student_id, group_code, full_name in STUDENTS:
    email = f"{student_id}@sdu.edu.kz"
    if db.query(User).filter_by(email=email).first():
        continue

    group = db.query(StudentGroup).filter_by(group_code=group_code).first()

    u = User(
        email=email,
        student_id=student_id,
        full_name=full_name,
        password_hash=hash_password("Student123!"),
        status="active",
        group_id=group.id if group else None,
    )
    u.roles.append(student_role)
    db.add(u)
    db.commit()

print("Created 5 student accounts")

db.close()
print()
print("=== DATABASE SEEDED ===")
print("Run: uvicorn app:app --reload")