"""HTML page routes: one table maps every URL to its template file (relative to templates/)."""
from fastapi import FastAPI
from fastapi.responses import FileResponse

from config import PROJECT_DIR

PAGES = {
    "/": "core/login.html",
    "/login.html": "core/login.html",
    "/dashboard.html": "core/dashboard.html",
    "/rooms.html": "master_data/rooms.html",
    "/teachers.html": "master_data/teachers.html",
    "/courses.html": "master_data/courses.html",
    "/availability.html": "rules/availability.html",
    "/constraints.html": "rules/hard_constraints.html",
    "/soft-constraints.html": "rules/soft_constraints.html",
    "/generator.html": "scheduling/generator.html",
    "/schedule.html": "scheduling/schedule.html",
    "/room-fitting.html": "scheduling/room_fitting.html",
    "/semesters.html": "master_data/semesters.html",
    "/student-groups.html": "master_data/student_groups.html",
    "/time-slots.html": "master_data/time_slots.html",
    "/programs.html": "master_data/programs.html",
    "/validation.html": "scheduling/validation.html",
}


def _serve(template):
    path = PROJECT_DIR / "templates" / template

    def page():
        return FileResponse(path)

    return page


def register_pages(app: FastAPI):
    for url, template in PAGES.items():
        app.add_api_route(url, _serve(template), methods=["GET"], include_in_schema=False)
