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

@app.get("/forgot.html")
def forgot_page():
    return FileResponse("templates/forgot.html")

@app.get("/reset.html")
def reset_page():
    return FileResponse("templates/reset.html")

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