from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

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




app = FastAPI(title="Secure Login API")

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




app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def index():
    return FileResponse("templates/login.html")

@app.get("/login.html")
def login_page():
    return FileResponse("templates/login.html")

@app.get("/dashboard.html")
def dashboard_page():
    return FileResponse("templates/dashboard.html")

@app.get("/rooms.html")
def rooms_page():
    return FileResponse("templates/rooms.html")

@app.get("/teachers.html")
def teachers_page():
    return FileResponse("templates/teachers.html")

@app.get("/courses.html")
def courses_page():
    return FileResponse("templates/courses.html")

@app.get("/availability.html")
def availability_page():
    return FileResponse("templates/availability.html")

@app.get("/constraints.html")
def constraints_page():
    return FileResponse("templates/constraints.html")

@app.get("/soft-constraints.html")
def soft_constraints_page():
    return FileResponse("templates/soft_constraints.html")

@app.get("/generator.html")
def generator_page():
    return FileResponse("templates/generator.html")

@app.get("/schedule.html")
def schedule_page():
    return FileResponse("templates/schedule.html")

@app.get("/room-fitting.html")
def room_fitting_page():
    return FileResponse("templates/room-fitting.html")