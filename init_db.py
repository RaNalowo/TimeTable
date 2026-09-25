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


load_users_from_file()
seed_rooms()
db.close()
print("Done.")