import csv
import os

from db.database import Base, engine, SessionLocal
from db.models import (
    Course, Teacher, Room, StudentGroup,
    ScheduleEntry, TeacherAvailability, User,
    Department, Program, course_target_programs,
)

Base.metadata.create_all(bind=engine)
db = SessionLocal()

DATA_DIR = os.path.dirname(os.path.abspath(__file__))


def read_csv(name):
    path = os.path.join(DATA_DIR, name)
    if not os.path.exists(path):
        print(f"[SKIP] {name} not found")
        return []
    with open(path, "r", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def build_department_map():
    return {d.name.strip(): d.id for d in db.query(Department).all()}


def build_program_map():
    return {p.program_name.strip(): p.id for p in db.query(Program).all()}


# ---------- CLEAR ----------

def clear_old_data():
    print("Clearing old business data...")

    # 1. Detach users from student groups (otherwise FK breaks)
    db.query(User).filter(User.group_id.isnot(None)).update(
        {User.group_id: None}, synchronize_session=False
    )

    # 2. Clear join table first
    db.execute(course_target_programs.delete())

    # 3. Clear schedule entries + availability
    db.query(ScheduleEntry).delete()
    db.query(TeacherAvailability).delete()

    # 4. Clear business entities
    db.query(Course).delete()
    db.query(Teacher).delete()
    db.query(Room).delete()
    db.query(StudentGroup).delete()

    db.commit()
    print("  Cleared: course_target_programs, schedule_entries, "
          "teacher_availability, courses, teachers, rooms, student_groups")


# ---------- IMPORT ----------

def import_rooms():
    rows = read_csv("rooms.csv")
    count = 0
    for r in rows:
        db.add(Room(
            campus=(r.get("campus") or "Main").strip() or "Main",
            building=r["building"].strip(),
            room_code=r["room_code"].strip(),
            capacity=int(r["capacity"]),
            room_type=r["room_type"].strip(),
            equipment=(r.get("equipment") or "").strip() or None,
        ))
        count += 1
    db.commit()
    print(f"  Imported {count} rooms")


def import_teachers(dept_map):
    rows = read_csv("teachers.csv")
    count = 0
    missing_dept = []

    for r in rows:
        dept_name = (r.get("department") or "").strip()
        dept_id = dept_map.get(dept_name)
        if dept_name and dept_id is None:
            missing_dept.append(dept_name)

        db.add(Teacher(
            full_name=r["full_name"].strip(),
            email=r["email"].strip().lower(),
            academic_title=(r.get("academic_title") or "").strip() or None,
            department_id=dept_id,          # ← FK, not string
            max_weekly_hours=int(r["max_weekly_hours"]),
            max_daily_hours=int(r["max_daily_hours"]),
            qualified_subjects=(r.get("qualified_subjects") or "").strip() or None,
        ))
        count += 1

    db.commit()
    print(f"  Imported {count} teachers")

    if missing_dept:
        print(f"  [WARN] Departments not found in DB: {sorted(set(missing_dept))}")


def import_student_groups(prog_map):
    rows = read_csv("student_groups.csv")
    count = 0
    missing_prog = []

    for r in rows:
        prog_name = (r.get("program") or "").strip()
        prog_id = prog_map.get(prog_name)
        if prog_name and prog_id is None:
            missing_prog.append(prog_name)

        # enrollment_year is required-ish; if absent, derive from group_code like IS-26-A
        enrollment_year = None
        if r.get("enrollment_year"):
            enrollment_year = int(r["enrollment_year"])
        else:
            code = r["group_code"].strip()
            parts = code.split("-")
            if len(parts) >= 2 and parts[1].isdigit():
                enrollment_year = 2000 + int(parts[1])

        db.add(StudentGroup(
            group_code=r["group_code"].strip(),
            program_id=prog_id,             # ← FK
            enrollment_year=enrollment_year,
            year_override=None,             # CSV doesn't carry this
            student_count=int(r["student_count"]) if r.get("student_count") else 0,
        ))
        count += 1

    db.commit()
    print(f"  Imported {count} student groups")

    if missing_prog:
        print(f"  [WARN] Programs not found in DB: {sorted(set(missing_prog))}")


def import_courses(dept_map, prog_map):
    rows = read_csv("courses.csv")
    count = 0
    skipped = 0
    missing_dept = []
    missing_prog = []

    for r in rows:
        code = (r.get("course_code") or "").strip()
        if not code:
            skipped += 1
            continue

        dept_name = (r.get("department") or "").strip()
        dept_id = dept_map.get(dept_name)
        if dept_name and dept_id is None:
            missing_dept.append(dept_name)

        c = Course(
            course_code=code,
            course_name=r["course_name"].strip(),
            credits=int(r["credits"]) if r.get("credits") else 5,
            semester_level=(r.get("semester_level") or "").strip() or None,
            total_hours=int(r["total_hours"]),
            lecture_hours=int(r["lecture_hours"]) if r.get("lecture_hours") else 0,
            practice_hours=int(r["practice_hours"]) if r.get("practice_hours") else 0,
            lab_hours=int(r["lab_hours"]) if r.get("lab_hours") else 0,
            department_id=dept_id,          # ← FK
        )
        db.add(c)
        db.commit()
        db.refresh(c)

        # target_groups is a comma-separated list of PROGRAM NAMES
        target_str = (r.get("target_groups") or "").strip()
        if target_str:
            for prog_name in [p.strip() for p in target_str.split(",") if p.strip()]:
                prog_id = prog_map.get(prog_name)
                if prog_id is None:
                    missing_prog.append(prog_name)
                    continue
                db.execute(
                    course_target_programs.insert().values(
                        course_id=c.id, program_id=prog_id
                    )
                )
            db.commit()

        count += 1

    print(f"  Imported {count} courses (skipped {skipped})")

    if missing_dept:
        print(f"  [WARN] Departments not found in DB: {sorted(set(missing_dept))}")
    if missing_prog:
        print(f"  [WARN] Target programs not found in DB: {sorted(set(missing_prog))}")


def print_summary():
    print()
    print("=== DATABASE SUMMARY ===")
    print(f"  Departments:     {db.query(Department).count()}")
    print(f"  Programs:        {db.query(Program).count()}")
    print(f"  Rooms:           {db.query(Room).count()}")
    print(f"  Teachers:        {db.query(Teacher).count()}")
    print(f"  Student Groups:  {db.query(StudentGroup).count()}")
    print(f"  Courses:         {db.query(Course).count()}")
    print(f"  Schedule Entries:{db.query(ScheduleEntry).count()}")


if __name__ == "__main__":
    print("=== IMPORT FROM CSV ===")
    print()

    dept_map = build_department_map()
    prog_map = build_program_map()

    print(f"Loaded {len(dept_map)} departments, {len(prog_map)} programs from DB")
    print()

    clear_old_data()
    print()

    print("Importing...")
    import_rooms()
    import_teachers(dept_map)
    import_student_groups(prog_map)
    import_courses(dept_map, prog_map)

    print_summary()

    db.close()
    print()
    print("Done.")