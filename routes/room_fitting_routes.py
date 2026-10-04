from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Room, StudentGroup, User
from routes.auth_routes import get_current_user

router = APIRouter(prefix="/room-fitting", tags=["room-fitting"])


# Which room types are allowed for each session type
REQUIRED_ROOM_TYPES = {
    "lecture":  ["Lecture Hall", "Regular Classroom", "Seminar Room"],
    "practice": ["Seminar Room", "Regular Classroom", "Lecture Hall"],
    "lab":      ["Computer Lab", "Physics Lab"],
}

# Which equipment keywords a session type requires
REQUIRED_EQUIPMENT = {
    "lecture":  [],
    "practice": [],
    "lab":      ["PCs", "Lab Kits"],   # matches either keyword
}


class SuggestRequest(BaseModel):
    session_type: str              # lecture | practice | lab
    target_groups: list[str]       # e.g. ["CS-2301", "SE-2301"]
    course_code: str | None = None


def _required_seats(db: Session, target_groups: list[str]) -> int:
    sizes = {g.group_code: g.student_count for g in db.query(StudentGroup).all()}
    return sum(sizes.get(g, 0) for g in target_groups)


def _room_has_equipment(room: Room, required: list[str]) -> tuple[bool, list[str]]:
    """Return (match, missing_list)."""
    if not required:
        return True, []
    room_equip = (room.equipment or "").lower()
    missing = [r for r in required if r.lower() not in room_equip]
    return len(missing) == 0, missing


def _score_room(room, required_seats, session_type):
    """Higher score = better fit."""
    score = 100

    # Capacity: prefer tight fit; big rooms waste space
    if room.capacity < required_seats:
        score -= 200   # disqualify-ish
    else:
        waste = room.capacity - required_seats
        score -= min(waste, 60)   # penalize 1 point per wasted seat

    # Room type must match
    if room.room_type not in REQUIRED_ROOM_TYPES.get(session_type, []):
        score -= 150

    # Equipment
    req_eq = REQUIRED_EQUIPMENT.get(session_type, [])
    ok, missing = _room_has_equipment(room, req_eq)
    if not ok:
        score -= 100

    return score


def suggest_rooms(db: Session, session_type: str, target_groups: list[str]):
    required_seats = _required_seats(db, target_groups)
    rooms = db.query(Room).all()

    results = []
    for r in rooms:
        req_eq = REQUIRED_EQUIPMENT.get(session_type, [])
        gear_ok, missing = _room_has_equipment(r, req_eq)
        type_ok = r.room_type in REQUIRED_ROOM_TYPES.get(session_type, [])
        cap_ok = r.capacity >= required_seats

        results.append({
            "room_id": r.id,
            "room_code": r.room_code,
            "building": r.building,
            "room_type": r.room_type,
            "capacity": r.capacity,
            "equipment": r.equipment or "",
            "score": _score_room(r, required_seats, session_type),
            "capacity_ok": cap_ok,
            "type_ok": type_ok,
            "gear_ok": gear_ok,
            "missing_gear": missing,
            "excess_seats": max(0, r.capacity - required_seats),
        })

    results.sort(key=lambda x: x["score"], reverse=True)

    return {
        "session_type": session_type,
        "target_groups": target_groups,
        "required_seats": required_seats,
        "required_room_types": REQUIRED_ROOM_TYPES.get(session_type, []),
        "required_equipment": REQUIRED_EQUIPMENT.get(session_type, []),
        "candidates": results,
    }


@router.get("/rules")
def get_rules(user: User = Depends(get_current_user)):
    return {
        "required_room_types": REQUIRED_ROOM_TYPES,
        "required_equipment": REQUIRED_EQUIPMENT,
    }


@router.post("/suggest")
def suggest(
    data: SuggestRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if data.session_type not in REQUIRED_ROOM_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown session type: {data.session_type}",
        )
    if not data.target_groups:
        raise HTTPException(status_code=400, detail="No target groups provided")

    return suggest_rooms(db, data.session_type, data.target_groups)


class CheckRequest(BaseModel):
    session_type: str
    target_groups: list[str]
    room_id: int


@router.post("/check")
def check_room(
    data: CheckRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = db.query(Room).filter_by(id=data.room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    required_seats = _required_seats(db, data.target_groups)
    req_eq = REQUIRED_EQUIPMENT.get(data.session_type, [])
    gear_ok, missing = _room_has_equipment(room, req_eq)
    type_ok = room.room_type in REQUIRED_ROOM_TYPES.get(data.session_type, [])
    cap_ok = room.capacity >= required_seats

    issues = []
    if not cap_ok:
        issues.append({
            "type": "capacity",
            "message": f"Room capacity {room.capacity} < required {required_seats} "
                       f"(overflow by {required_seats - room.capacity})",
        })
    if not type_ok:
        issues.append({
            "type": "room_type",
            "message": f"Room type '{room.room_type}' is not suitable for {data.session_type}",
        })
    if not gear_ok:
        issues.append({
            "type": "equipment",
            "message": f"Missing required equipment: {', '.join(missing)}",
        })

    return {
        "valid": len(issues) == 0,
        "issues": issues,
        "room": {
            "id": room.id,
            "room_code": room.room_code,
            "capacity": room.capacity,
            "room_type": room.room_type,
            "equipment": room.equipment or "",
        },
        "required_seats": required_seats,
    }