from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import User
from routes.auth_routes import get_current_user

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary")
def summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    roles = [r.name for r in user.roles]

    base = {
        "user": {
            "full_name": user.full_name,
            "email": user.email,
            "roles": roles,
        }
    }

    if "admin" in roles:
        base["role"] = "admin"
        base["cards"] = {
            "today_classes": 12,
            "next_room": "B-204",
            "pending_requests": 3,
            "timetable_status": "Draft Ready",
        }
        base["admin"] = {
            "generation_status": "Completed",
            "constraint_score": 92,
            "active_conflicts": 0,
            "utilization": 78,
        }
    elif "teacher" in roles:
        base["role"] = "teacher"
        base["cards"] = {
            "today_classes": 3,
            "next_room": "A-105",
            "pending_requests": 1,
            "timetable_status": "Published",
        }
        base["teacher"] = {
            "weekly_hours": 14,
            "rooms": ["A-105", "B-202", "C-301"],
            "groups": ["CS-21", "CS-22", "SE-21", "IT-21"],
            "weekly_schedule": [
                {"day": "Mon", "time": "08:30", "course": "Algorithms", "room": "A-105", "group": "CS-21"},
                {"day": "Mon", "time": "10:15", "course": "Databases", "room": "B-202", "group": "CS-22"},
                {"day": "Tue", "time": "12:00", "course": "Algorithms", "room": "A-105", "group": "SE-21"},
                {"day": "Wed", "time": "14:00", "course": "Databases", "room": "C-301", "group": "IT-21"},
            ],
        }
    else:
        base["role"] = "student"
        base["cards"] = {
            "today_classes": 6,
            "next_room": "A-203",
            "pending_requests": 0,
            "timetable_status": "Published",
        }
        base["student"] = {
            "today_schedule": [
                {"time": "08:30", "course": "Math", "room": "A-203", "teacher": "Dr. Smith"},
                {"time": "10:15", "course": "Physics", "room": "B-101", "teacher": "Dr. Lee"},
                {"time": "12:00", "course": "Programming", "room": "Lab-2", "teacher": "Dr. Ali"},
                {"time": "13:30", "course": "English", "room": "C-305", "teacher": "Ms. Jones"},
                {"time": "15:15", "course": "Data Structures", "room": "Lab-1", "teacher": "Prof. Dana"},
                {"time": "17:00", "course": "Discrete Math", "room": "A-101", "teacher": "Dr. Aidar"},
            ],
            "next_lecture": {
                "course": "Math",
                "time": "08:30",
                "room": "A-203",
            },
        }
    return base