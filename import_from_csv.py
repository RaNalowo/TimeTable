import csv
import os

from db.database import Base, engine, SessionLocal
from db.models import (
    Course, Teacher, Room, StudentGroup,
    ScheduleEntry, TeacherAvailability, User, Role, user_roles
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


def clear_old_data():
    print("Clearing old data...")
    db.query(ScheduleEntry).delete()
    db.query(TeacherAvailability).delete()
    db.query(Course).delete()
    db.query(Teacher).delete()
    db.query(Room).delete()
    db.query(StudentGroup).delete()
    db.commit()
    print("  Cleared: schedule_entries, teacher_availability, courses, teachers, rooms, student_groups")


def import_rooms():
    rows = read_csv("rooms.csv")
    count = 0
    for r in rows:
        db.add(Room(
            campus=r.get("campus", "Main") or "Main",
            building=r["building"].strip(),
            room_code=r["room_code"].strip(),
            capacity=int(r["capacity"]),
            room_type=r["room_type"].strip(),
            equipment=(r.get("equipment") or "").strip() or None,
        ))
        count += 1
    db.commit()
    print(f"  Imported {count} rooms")


def import_teachers():
    rows = read_csv("teachers.csv")
    count = 0
    for r in rows:
        db.add(Teacher(
            full_name=r["full_name"].strip(),
            email=r["email"].strip().lower(),
            academic_title=(r.get("academic_title") or "").strip() or None,
            department=r["department"].strip(),
            max_weekly_hours=int(r["max_weekly_hours"]),
            max_daily_hours=int(r["max_daily_hours"]),
            qualified_subjects=(r.get("qualified_subjects") or "").strip() or None,
        ))
        count += 1
    db.commit()
    print(f"  Imported {count} teachers")


def import_student_groups():
    rows = read_csv("student_groups.csv")
    count = 0
    for r in rows:
        db.add(StudentGroup(
            group_code=r["group_code"].strip(),
            program=(r.get("program") or "").strip() or None,
            year=int(r["year"]) if r.get("year") else None,
            student_count=int(r["student_count"]) if r.get("student_count") else 0,
        ))
        count += 1
    db.commit()
    print(f"  Imported {count} student groups")


def import_courses():
    rows = read_csv("courses.csv")
    count = 0
    skipped = 0
    for r in rows:
        code = r["course_code"].strip()
        if not code:
            skipped += 1
            continue
        db.add(Course(
            course_code=code,
            course_name=r["course_name"].strip(),
            credits=int(r["credits"]) if r.get("credits") else 5,
            semester_level=(r.get("semester_level") or "").strip() or None,
            total_hours=int(r["total_hours"]),
            lecture_hours=int(r["lecture_hours"]),
            practice_hours=int(r["practice_hours"]),
            lab_hours=int(r["lab_hours"]),
            target_groups=(r.get("target_groups") or "").strip() or None,
            department=(r.get("department") or "").strip() or None,
        ))
        count += 1
    db.commit()
    print(f"  Imported {count} courses (skipped {skipped})")


def print_summary():
    print()
    print("=== DATABASE SUMMARY ===")
    print(f"  Rooms:           {db.query(Room).count()}")
    print(f"  Teachers:        {db.query(Teacher).count()}")
    print(f"  Student Groups:  {db.query(StudentGroup).count()}")
    print(f"  Courses:         {db.query(Course).count()}")
    print(f"  Schedule Entries:{db.query(ScheduleEntry).count()}")


if __name__ == "__main__":
    print("=== IMPORT FROM CSV ===")
    print()

    clear_old_data()
    print()

    print("Importing...")
    import_rooms()
    import_teachers()
    import_student_groups()
    import_courses()

    print_summary()

    db.close()
    print()
    print("Done.")