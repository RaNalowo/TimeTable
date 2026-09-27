import os

from db.database import Base, engine, SessionLocal
from db.models import User, Role, Room
from services.security import hash_password

Base.metadata.create_all(bind=engine)

db = SessionLocal()

# 1. 角色
for name in ["student", "teacher", "admin"]:
    if not db.query(Role).filter_by(name=name).first():
        db.add(Role(name=name, description=f"{name} role"))
db.commit()


# 2. 从 users.txt 读取初始用户
def load_users_from_file(path="users.txt"):
    if not os.path.exists(path):
        print(f"{path} not found, skipping user import")
        return

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            parts = line.split("|")
            if len(parts) < 4:
                print(f"Skipping invalid line: {line}")
                continue

            email = parts[0].strip()
            full_name = parts[1].strip()
            password = parts[2].strip()
            role_name = parts[3].strip()
            student_id = parts[4].strip() if len(parts) > 4 and parts[4].strip() else None
            employee_id = parts[5].strip() if len(parts) > 5 and parts[5].strip() else None

            if db.query(User).filter_by(email=email).first():
                print(f"User {email} already exists, skipping")
                continue

            role = db.query(Role).filter_by(name=role_name).first()
            if not role:
                print(f"Role {role_name} not found, skipping {email}")
                continue

            user = User(
                email=email,
                full_name=full_name,
                password_hash=hash_password(password),
                status="active",
                student_id=student_id,
                employee_id=employee_id,
            )
            user.roles.append(role)
            db.add(user)
            db.commit()
            print(f"Created: {email} ({role_name})")


# 3. 房间初始数据
def seed_rooms():
    if db.query(Room).count() > 0:
        print("Rooms already exist, skipping")
        return

    samples = [
        Room(campus="Main", building="Main Building", room_code="C102",
             capacity=50, room_type="Computer Lab", equipment="30 PCs, Projector"),
        Room(campus="Main", building="Main Building", room_code="G201",
             capacity=100, room_type="Lecture Hall", equipment="Projector, Smart Board"),
        Room(campus="Main", building="Science Building", room_code="L301",
             capacity=80, room_type="Physics Lab", equipment="Lab Kits, Projector"),
        Room(campus="Main", building="Science Building", room_code="S105",
             capacity=30, room_type="Seminar Room", equipment="Smart Board, AC"),
        Room(campus="Main", building="Engineering Building", room_code="E401",
             capacity=60, room_type="Regular Classroom", equipment="Projector, AC"),
    ]
    db.add_all(samples)
    db.commit()
    print(f"Seeded {len(samples)} rooms")

def seed_teachers():
    from db.models import Teacher
    if db.query(Teacher).count() > 0:
        print("Teachers already exist, skipping")
        return

    samples = [
        Teacher(full_name="Dr. Arman", email="arman@univ.edu",
                academic_title="Dr.", department="Computer Science",
                max_weekly_hours=18, max_daily_hours=4,
                qualified_subjects="Algorithms, Programming"),
        Teacher(full_name="Prof. Dana", email="dana@univ.edu",
                academic_title="Prof.", department="Computer Science",
                max_weekly_hours=20, max_daily_hours=4,
                qualified_subjects="Data Structures, Database Systems"),
        Teacher(full_name="Dr. Aidar", email="aidar@univ.edu",
                academic_title="Dr.", department="Mathematics",
                max_weekly_hours=16, max_daily_hours=4,
                qualified_subjects="Calculus, Linear Algebra"),
    ]
    db.add_all(samples)
    db.commit()
    print(f"Seeded {len(samples)} teachers")

def seed_student_groups():
    from db.models import StudentGroup
    if db.query(StudentGroup).count() > 0:
        print("Student groups already exist, skipping")
        return

    samples = [
        StudentGroup(group_code="CS-2201", program="Computer Science", year=2, student_count=25),
        StudentGroup(group_code="CS-2202", program="Computer Science", year=2, student_count=24),
        StudentGroup(group_code="CS-2301", program="Computer Science", year=3, student_count=22),
        StudentGroup(group_code="CS-2302", program="Computer Science", year=3, student_count=20),
        StudentGroup(group_code="SE-2301", program="Software Engineering", year=3, student_count=28),
    ]
    db.add_all(samples)
    db.commit()
    print(f"Seeded {len(samples)} student groups")

def seed_courses():
    from db.models import Course
    if db.query(Course).count() > 0:
        print("Courses already exist, skipping")
        return

    samples = [
        Course(course_code="CS201", course_name="Object-Oriented Programming",
               credits=5, semester_level="Year 2, Fall",
               total_hours=5, lecture_hours=3, practice_hours=0, lab_hours=2,
               target_groups="CS-2201, CS-2202", department="Computer Science"),
        Course(course_code="CS102", course_name="Database Systems",
               credits=5, semester_level="Year 1, Spring",
               total_hours=4, lecture_hours=2, practice_hours=0, lab_hours=2,
               target_groups="CS-2301", department="Computer Science"),
        Course(course_code="MATH101", course_name="Calculus I",
               credits=6, semester_level="Year 1, Fall",
               total_hours=6, lecture_hours=4, practice_hours=2, lab_hours=0,
               target_groups="CS-2301, CS-2302, SE-2301", department="Mathematics"),
        Course(course_code="CS301", course_name="Algorithms",
               credits=5, semester_level="Year 3, Fall",
               total_hours=5, lecture_hours=3, practice_hours=2, lab_hours=0,
               target_groups="CS-2201", department="Computer Science"),
    ]
    db.add_all(samples)
    db.commit()
    print(f"Seeded {len(samples)} courses")

def seed_preference_window():
    from db.models import PreferenceWindow
    if db.query(PreferenceWindow).count() > 0:
        print("Preference window already exists, skipping")
        return
    db.add(PreferenceWindow(semester="Current", is_frozen=False))
    db.commit()
    print("Seeded preference window (open)")


load_users_from_file()
seed_rooms()
seed_teachers()
seed_student_groups()
seed_courses()
seed_preference_window()
db.close()
print("Done.")