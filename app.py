from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, OperationalError
import logging
from config import PROJECT_DIR

from db.database import engine, Base
from db import models
from routes.auth_routes import router as auth_router
from routes.dashboard_routes import router as dashboard_router
from routes.room_routes import router as room_router
from routes.teacher_routes import router as teacher_router
from routes.course_routes import router as course_router
from routes.availability_routes import router as availability_router
from routes.student_group_routes import router as group_router
from routes.constraint_routes import router as constraint_router
from routes.soft_constraint_routes import router as soft_constraint_router
from routes.generator_routes import router as generator_router
from routes.conflict_routes import router as conflict_router
from routes.room_fitting_routes import router as room_fitting_router
from routes.semester_routes import router as semester_router
from routes.time_slot_routes import router as time_slot_router
from routes.program_routes import router as program_router
from routes.validation_routes import router as validation_router






app = FastAPI(title="Secure Login API")


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request, exc):
    logging.getLogger(__name__).warning("Database integrity error on %s", request.url.path)
    return JSONResponse(status_code=409, content={
        "detail": "This change conflicts with existing data. Check duplicate identifiers and references; remove scheduled references before deleting a resource."
    })


@app.exception_handler(OperationalError)
async def database_error_handler(request, exc):
    logging.getLogger(__name__).exception("Database operation failed")
    return JSONResponse(status_code=503, content={
        "detail": "The database is unavailable or its structure is outdated. For the Sprint 3 demo, run python run_demo.py. Your existing database is preserved."
    })


@app.exception_handler(Exception)
async def unexpected_error_handler(request, exc):
    logging.getLogger(__name__).exception("Unexpected error on %s", request.url.path)
    return JSONResponse(status_code=500, content={
        "detail": "An unexpected server error occurred. Check the server terminal for details."
    })

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)

app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(room_router)
app.include_router(teacher_router)
app.include_router(course_router)
app.include_router(availability_router)
app.include_router(group_router)
app.include_router(constraint_router)
app.include_router(soft_constraint_router)
app.include_router(generator_router)
app.include_router(conflict_router)
app.include_router(room_fitting_router)
app.include_router(semester_router)
app.include_router(time_slot_router)
app.include_router(program_router)
app.include_router(validation_router)




app.mount("/static", StaticFiles(directory=PROJECT_DIR / "static"), name="static")

@app.get("/")
def index():
    return FileResponse(PROJECT_DIR / "templates/login.html")

@app.get("/login.html")
def login_page():
    return FileResponse(PROJECT_DIR / "templates/login.html")

@app.get("/dashboard.html")
def dashboard_page():
    return FileResponse(PROJECT_DIR / "templates/dashboard.html")

@app.get("/rooms.html")
def rooms_page():
    return FileResponse(PROJECT_DIR / "templates/rooms.html")

@app.get("/teachers.html")
def teachers_page():
    return FileResponse(PROJECT_DIR / "templates/teachers.html")

@app.get("/courses.html")
def courses_page():
    return FileResponse(PROJECT_DIR / "templates/courses.html")

@app.get("/availability.html")
def availability_page():
    return FileResponse(PROJECT_DIR / "templates/availability.html")

@app.get("/constraints.html")
def constraints_page():
    return FileResponse(PROJECT_DIR / "templates/constraints.html")

@app.get("/soft-constraints.html")
def soft_constraints_page():
    return FileResponse(PROJECT_DIR / "templates/soft_constraints.html")

@app.get("/generator.html")
def generator_page():
    return FileResponse(PROJECT_DIR / "templates/generator.html")

@app.get("/schedule.html")
def schedule_page():
    return FileResponse(PROJECT_DIR / "templates/schedule.html")

@app.get("/room-fitting.html")
def room_fitting_page():
    return FileResponse(PROJECT_DIR / "templates/room-fitting.html")

@app.get("/semesters.html")
def semesters_page():
    return FileResponse(PROJECT_DIR / "templates/semesters.html")

@app.get("/student-groups.html")
def student_groups_page():
    return FileResponse(PROJECT_DIR / "templates/student_groups.html")

@app.get("/time-slots.html")
def time_slots_page():
    return FileResponse(PROJECT_DIR / "templates/time-slots.html")

@app.get("/programs.html")
def programs_page():
    return FileResponse(PROJECT_DIR / "templates/programs.html")

@app.get("/validation.html")
def validation_page():
    return FileResponse(PROJECT_DIR / "templates/validation.html")
