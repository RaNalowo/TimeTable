from db.models import TimeSlot

DEFAULT_SLOTS = [
    "08:30-09:20",
    "09:30-10:20",
    "10:30-11:20",
    "11:30-12:20",
    "12:30-13:20",
    "13:30-14:20",
    "14:30-15:20",
    "15:30-16:20",
    "16:30-17:20",
    "17:30-18:20",
]


def get_active_slots(db):
    """Return only configured active slots; never invent schedulable periods."""
    rows = db.query(TimeSlot).filter_by(is_active=True).order_by(TimeSlot.sort_order).all()
    return [r.slot_label for r in rows]
