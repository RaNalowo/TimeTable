"""Single place that lists every API router, in registration order."""
from routes.core.auth import router as auth_router
from routes.core.dashboard import router as dashboard_router
from routes.master_data.rooms import router as room_router
from routes.master_data.teachers import router as teacher_router
from routes.master_data.courses import router as course_router
from routes.rules.availability import router as availability_router
from routes.master_data.student_groups import router as group_router
from routes.rules.hard_constraints import router as constraint_router
from routes.rules.soft_constraints import router as soft_constraint_router
from routes.scheduling.generator import router as generator_router
from routes.scheduling.conflicts import router as conflict_router
from routes.scheduling.room_fitting import router as room_fitting_router
from routes.master_data.semesters import router as semester_router
from routes.master_data.time_slots import router as time_slot_router
from routes.master_data.programs import router as program_router
from routes.scheduling.validation import router as validation_router

ROUTERS = [
    auth_router,
    dashboard_router,
    room_router,
    teacher_router,
    course_router,
    availability_router,
    group_router,
    constraint_router,
    soft_constraint_router,
    generator_router,
    conflict_router,
    room_fitting_router,
    semester_router,
    time_slot_router,
    program_router,
    validation_router,
]
