from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, OperationalError
import logging
from config import PROJECT_DIR
from routes.pages import register_pages

from db.database import engine, Base
from db import models
from routes.registry import ROUTERS






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
        "detail": "The database is unavailable or its structure is outdated. Back up the database file, then recreate it with python init_db.py."
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

for _router in ROUTERS:
    app.include_router(_router)




app.mount("/static", StaticFiles(directory=PROJECT_DIR / "static"), name="static")

register_pages(app)
