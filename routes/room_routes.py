from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Room, User
from routes.auth_routes import get_current_user, require_role
from services.audit import log_event

router = APIRouter(prefix="/rooms", tags=["rooms"])

ROOM_TYPES = [
    "Lecture Hall",
    "Computer Lab",
    "Physics Lab",
    "Seminar Room",
    "Regular Classroom",
]


class RoomRequest(BaseModel):
    campus: str | None = None
    building: str = Field(min_length=1)
    room_code: str = Field(min_length=1)
    capacity: int = Field(gt=0)
    room_type: str
    equipment: str | None = None


def room_to_dict(r: Room):
    return {
        "id": r.id,
        "campus": r.campus,
        "building": r.building,
        "room_code": r.room_code,
        "capacity": r.capacity,
        "room_type": r.room_type,
        "equipment": r.equipment,
    }


@router.get("")
def list_rooms(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rooms = db.query(Room).order_by(Room.building, Room.room_code).all()
    return [room_to_dict(r) for r in rooms]


@router.get("/types")
def get_room_types():
    return ROOM_TYPES


@router.post("")
def create_room(
    data: RoomRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    if data.room_type not in ROOM_TYPES:
        raise HTTPException(status_code=400, detail="Invalid room type")

    dup = db.query(Room).filter_by(
        building=data.building,
        room_code=data.room_code,
    ).first()
    if dup:
        raise HTTPException(
            status_code=400,
            detail="Room code already exists in this building",
        )

    room = Room(
        campus=data.campus,
        building=data.building,
        room_code=data.room_code,
        capacity=data.capacity,
        room_type=data.room_type,
        equipment=data.equipment,
    )
    db.add(room)
    db.commit()
    db.refresh(room)

    log_event(db, admin.id, "room_created", True, f"{data.building}-{data.room_code}")
    return room_to_dict(room)


@router.put("/{room_id}")
def update_room(
    room_id: int,
    data: RoomRequest,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    room = db.query(Room).filter_by(id=room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    if data.room_type not in ROOM_TYPES:
        raise HTTPException(status_code=400, detail="Invalid room type")

    # 唯一性检查（排除自己）
    dup = db.query(Room).filter(
        Room.building == data.building,
        Room.room_code == data.room_code,
        Room.id != room_id,
    ).first()
    if dup:
        raise HTTPException(
            status_code=400,
            detail="Room code already exists in this building",
        )

    room.campus = data.campus
    room.building = data.building
    room.room_code = data.room_code
    room.capacity = data.capacity
    room.room_type = data.room_type
    room.equipment = data.equipment
    db.commit()
    db.refresh(room)

    log_event(db, admin.id, "room_updated", True, f"room_id={room_id}")
    return room_to_dict(room)


@router.delete("/{room_id}")
def delete_room(
    room_id: int,
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    room = db.query(Room).filter_by(id=room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    db.delete(room)
    db.commit()
    log_event(db, admin.id, "room_deleted", True, f"room_id={room_id}")
    return {"message": "Room deleted"}