from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from db.database import engine, Base
from db import models
from routes.auth_routes import router as auth_router
from routes.dashboard_routes import router as dashboard_router
from routes.room_routes import router as room_router


# 1. 先创建 app
app = FastAPI(title="Secure Login API")

# 2. 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. 建表
Base.metadata.create_all(bind=engine)

# 4. 挂路由
app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(room_router)


# 5. 静态文件
app.mount("/static", StaticFiles(directory="static"), name="static")

# 6. 页面路由
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