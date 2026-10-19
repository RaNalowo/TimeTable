"""Regression tests use temporary databases; never the user's database.db."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

_temp = tempfile.TemporaryDirectory(prefix="timetable-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_temp.name) / 'test.db'}"

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.exc import OperationalError
from fastapi import HTTPException
from app import app
from db.database import Base, get_db
from db.models import (Role, User, Department, Program, StudentGroup, Course,
                       Teacher, Room, Semester, TimeSlot, ScheduleEntry,
                       SoftConstraint, TeacherAvailability, Constraint)
from services.security import create_access_token, hash_password
from services.time_slots import DEFAULT_SLOTS
from routes.generator_routes import expand_sessions


class Sprint3Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password_hash = hash_password("Admin123!")

    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        from sqlalchemy import event
        event.listen(self.engine, "connect", lambda connection, _: connection.execute("PRAGMA foreign_keys=ON"))
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        with self.sessions() as db:
            admin_role = Role(name="admin")
            teacher_role = Role(name="teacher")
            self.admin = User(email="admin@test.edu", full_name="Admin", password_hash=self.password_hash, roles=[admin_role])
            teacher_user = User(email="teacher@test.edu", full_name="Teacher", password_hash=self.password_hash, roles=[teacher_role])
            db.add_all([self.admin, teacher_user]); db.flush()
            self.admin_id, self.teacher_user_id = self.admin.id, teacher_user.id
            department = Department(name="Computing")
            db.add(department); db.flush()
            program = Program(program_code="IS", program_name="Information Systems", department_id=department.id)
            db.add(program); db.flush()
            group = StudentGroup(group_code="IS-26-A", program_id=program.id, enrollment_year=2026, student_count=31, sub_group_count=2)
            course = Course(course_code="IS101", course_name="Programming", credits=5, semester_level="Year 1 Fall", total_hours=3,
                            lecture_hours=1, practice_hours=1, lab_hours=1, program_id=program.id)
            teacher = Teacher(full_name="Teacher", email=teacher_user.email, user_id=teacher_user.id, max_weekly_hours=40,
                              max_daily_hours=10, qualified_subjects="Programming")
            semester = Semester(name="2026 Fall", academic_year=2026, term="Fall", start_date="2026-09-01", end_date="2026-12-20", is_active=True)
            rooms = [Room(building="A", room_code="Lecture", capacity=40, room_type="Lecture Hall"),
                     Room(building="A", room_code="Lab", capacity=16, room_type="Computer Lab", equipment="PCs")]
            db.add_all([group, course, teacher, semester, *rooms]); db.flush()
            self.group_id, self.course_id, self.teacher_id = group.id, course.id, teacher.id
            self.semester_id, self.room_id, self.lab_id = semester.id, rooms[0].id, rooms[1].id
            for i, slot in enumerate(DEFAULT_SLOTS, 1):
                db.add(TimeSlot(slot_label=slot, sort_order=i, is_active=True))
            for key in ["minimize_gaps", "avoid_early_mornings", "avoid_late_evenings", "compact_days"]:
                db.add(SoftConstraint(constraint_key=key, display_name=key, weight=5))
            db.commit()

        def override_db():
            with self.sessions() as db:
                try:
                    yield db
                except Exception:
                    db.rollback()
                    raise
        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app, raise_server_exceptions=False)
        self.headers = {"Authorization": "Bearer " + create_access_token(self.admin_id, ["admin"])}

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def request(self, method, path, **kwargs):
        return self.client.request(method, path, headers=self.headers, **kwargs)

    def generate(self):
        return self.request("POST", "/generator/generate")

    def add_saved_entry(self, **overrides):
        with self.sessions() as db:
            values = dict(day="Mon", time_slot_id=1, course_id=self.course_id, teacher_id=self.teacher_id,
                          room_id=self.room_id, group_id=self.group_id, semester_id=self.semester_id, session_type="lecture")
            values.update(overrides)
            entry = ScheduleEntry(**values)
            db.add(entry); db.commit()
            return entry.id

    def test_login_and_authentication_errors(self):
        self.assertEqual(self.client.post("/auth/login", json={"identifier":"admin@test.edu", "password":"Admin123!"}).status_code, 200)
        for header in [None, "Bearer ", "Bearer nonsense", "Bearer " + create_access_token("invalid", [])]:
            response = self.client.get("/auth/me", headers={"Authorization":header} if header else {})
            self.assertEqual(response.status_code, 401, response.text)
        self.assertEqual(self.client.post("/auth/login", json={"identifier":"admin@test.edu", "password":"x" * 100}).status_code, 401)

    def test_locked_account_cannot_use_existing_token(self):
        with self.sessions() as db:
            db.get(User, self.admin_id).status = "locked"; db.commit()
        self.assertEqual(self.request("GET", "/auth/me").status_code, 403)

    def test_non_admin_cannot_generate(self):
        response = self.client.post("/generator/generate", headers={"Authorization":"Bearer " + create_access_token(self.teacher_user_id, ["teacher"])})
        self.assertEqual(response.status_code, 403)

    def test_end_to_end_generation_scan_and_consistent_score(self):
        self.assertTrue(self.request("GET", "/validation/report").json()["ok"])
        response = self.generate()
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["total_sessions"], 5)
        self.assertEqual(data["coverage"], 100)
        self.assertEqual(self.request("GET", "/conflicts/scan").json()["error_count"], 0)
        self.assertEqual(self.request("GET", "/dashboard/summary").json()["admin"]["constraint_score"], data["score"])
        self.assertEqual(len(self.request("GET", "/generator/entries").json()), 5)
        self.assertEqual(self.request("GET", "/conflicts/grid").status_code, 200)

    def test_subgroup_capacity_rounds_up(self):
        with self.sessions() as db:
            sessions = expand_sessions(db, db.query(Course).all(), db.get(Semester, self.semester_id))
            self.assertEqual({s["required_seats"] for s in sessions if s["sub_group"]}, {16})
        entry_id = self.add_saved_entry(session_type="lab", sub_group="1", room_id=self.lab_id)
        with self.sessions() as db:
            db.get(Room, self.lab_id).capacity = 15; db.commit()
        scan = self.request("GET", "/conflicts/scan").json()
        self.assertTrue(any(c["type"] == "capacity_overflow" and c["severity"] == "error" for c in scan["conflicts"]))

    def test_distinct_subgroups_can_share_a_time(self):
        self.add_saved_entry(session_type="practice", sub_group="1")
        self.add_saved_entry(session_type="practice", sub_group="2", room_id=self.lab_id, teacher_id=None)
        scan = self.request("GET", "/conflicts/scan").json()
        self.assertFalse(any(c["type"] == "group_double_booking" for c in scan["conflicts"]))
        self.add_saved_entry(session_type="lecture")
        scan = self.request("GET", "/conflicts/scan").json()
        self.assertTrue(any(c["type"] == "group_double_booking" for c in scan["conflicts"]))

    def test_subgroups_not_unnecessarily_serialized_by_generator(self):
        with self.sessions() as db:
            c = db.get(Course, self.course_id)
            c.lecture_hours = 0; c.lab_hours = 1; c.practice_hours = 0; c.total_hours = 1
            db.add(Teacher(full_name="Teacher2", email="other@test.edu", qualified_subjects="Programming", max_daily_hours=10, max_weekly_hours=40))
            db.add(Room(building="B", room_code="Lab2", capacity=16, room_type="Computer Lab", equipment="PCs"))
            db.query(TimeSlot).filter(TimeSlot.id != 1).update({TimeSlot.is_active:False})
            # All other days blocked: two subgroups must use the same Monday slot.
            from services.scheduling_data import DAYS
            import json
            matrix = {d:{DEFAULT_SLOTS[0]: "neutral" if d == "Mon" else "blocked"} for d in DAYS}
            other_user = User(email="other@test.edu", full_name="Other", password_hash=self.password_hash)
            db.add(other_user); db.flush()
            for uid in [self.teacher_user_id, other_user.id]:
                db.add(TeacherAvailability(user_id=uid, matrix_json=json.dumps(matrix)))
            db.commit()
        response = self.generate()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["placed_count"], 2)

    def test_failed_generation_preserves_existing_entries(self):
        original = self.add_saved_entry()
        with patch("routes.generator_routes.generate", side_effect=HTTPException(400, "Test failure")):
            self.assertEqual(self.generate().status_code, 400)
        with self.sessions() as db:
            self.assertIsNotNone(db.get(ScheduleEntry, original))

    def test_write_failure_rolls_back_previous_schedule(self):
        original = self.add_saved_entry()
        with patch("routes.generator_routes.log_event", side_effect=RuntimeError("Simulated write failure")):
            self.assertEqual(self.generate().status_code, 500)
        with self.sessions() as db:
            self.assertEqual(db.query(ScheduleEntry).count(), 1)
            self.assertIsNotNone(db.get(ScheduleEntry, original))

    def test_missing_slots_preserves_previous_schedule(self):
        original = self.add_saved_entry()
        with self.sessions() as db:
            db.query(TimeSlot).update({TimeSlot.is_active:False}); db.commit()
        self.assertEqual(self.generate().status_code, 400)
        with self.sessions() as db:
            self.assertIsNotNone(db.get(ScheduleEntry, original))

    def test_overlapping_slots_rejected(self):
        self.request("PUT", "/time-slots/2", json={"slot_label":"09:00-09:50", "sort_order":2, "is_active":False})
        response = self.request("PUT", "/time-slots/2", json={"slot_label":"09:00-09:50", "sort_order":2, "is_active":True})
        self.assertEqual(response.status_code, 400)

    def test_malformed_availability_is_rejected(self):
        teacher_headers = {"Authorization":"Bearer " + create_access_token(self.teacher_user_id, ["teacher"])}
        response = self.client.post("/availability/me", headers=teacher_headers, json={"matrix":{"Mon":[]}})
        self.assertEqual(response.status_code, 422)
        with self.sessions() as db:
            db.add(TeacherAvailability(user_id=self.teacher_user_id, matrix_json='{"Mon": []}')); db.commit()
        self.assertFalse(self.request("GET", "/validation/report").json()["ok"])
        self.assertEqual(self.generate().status_code, 400)
        self.assertEqual(self.client.get("/availability/me", headers=teacher_headers).status_code, 409)

    def test_invalid_lunch_configuration_rejected(self):
        for config in [{"start":123}, {"start":"14:00", "end":"12:00"}, {"days":["Sunday"]}]:
            response = self.request("PUT", "/constraints/lunch_break", json={"is_active":True, "config":config})
            self.assertEqual(response.status_code, 400, response.text)

    def test_mandatory_overlap_rules_cannot_be_disabled(self):
        for key in ["no_overlap_rooms", "no_overlap_teachers"]:
            self.assertEqual(self.request("PUT", f"/constraints/{key}", json={"is_active":False}).status_code, 400)

    def test_schedule_references_and_semester_are_validated(self):
        payload = dict(day="Mon", time_slot=DEFAULT_SLOTS[0], course_id=self.course_id, room_id=self.room_id,
                       teacher_id=self.teacher_id, group_id=self.group_id, session_type="lecture")
        response = self.request("POST", "/conflicts/entries", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        with self.sessions() as db:
            self.assertEqual(db.get(ScheduleEntry, response.json()["entry_id"]).semester_id, self.semester_id)
        self.assertEqual(self.request("POST", "/conflicts/entries", json={**payload, "room_id":999}).status_code, 400)
        self.assertEqual(self.request("POST", "/conflicts/entries", json={**payload, "day":"Sunday"}).status_code, 422)

    def test_foreign_keys_prevent_dangling_schedule_resources(self):
        self.add_saved_entry()
        self.assertEqual(self.request("DELETE", f"/rooms/{self.room_id}").status_code, 409)
        self.assertEqual(self.request("GET", "/rooms").status_code, 200)

    def test_duplicate_student_identifier_is_controlled_error(self):
        payload = dict(email="first@test.edu", full_name="First", password="Student123!", role="teacher", student_id="S001")
        self.assertEqual(self.request("POST", "/auth/admin/users", json=payload).status_code, 200)
        self.assertEqual(self.request("POST", "/auth/admin/users", json={**payload, "email":"second@test.edu"}).status_code, 409)

    def test_daily_load_and_lunch_are_scanned(self):
        self.add_saved_entry()
        self.add_saved_entry(time_slot_id=2)
        with self.sessions() as db:
            db.get(Teacher, self.teacher_id).max_daily_hours = 1
            db.add(Constraint(constraint_type="lunch_break", is_active=True, config_json='{"start":"08:00","end":"09:00","days":["Mon"]}'))
            db.commit()
        types = {c["type"] for c in self.request("GET", "/conflicts/scan").json()["conflicts"]}
        self.assertTrue({"teacher_daily_overload", "lunch_break"} <= types)

    def test_database_failure_has_actionable_response(self):
        with patch("routes.validation_routes.build_report", side_effect=OperationalError("query", {}, Exception("old schema"))):
            response = self.request("GET", "/validation/report")
        self.assertEqual(response.status_code, 503)
        self.assertIn("run_demo.py", response.json()["detail"])

    def test_zero_placement_preserves_previous_timetable(self):
        original = self.add_saved_entry()
        with self.sessions() as db:
            db.get(Room, self.room_id).capacity = 1
            db.get(Room, self.lab_id).capacity = 1
            db.commit()
        self.assertEqual(self.generate().status_code, 409)
        with self.sessions() as db:
            self.assertIsNotNone(db.get(ScheduleEntry, original))

    def test_no_matching_courses_preserves_previous_timetable(self):
        original = self.add_saved_entry()
        with self.sessions() as db:
            db.get(Course, self.course_id).semester_level = "Year 1 Spring"; db.commit()
        self.assertEqual(self.generate().status_code, 400)
        with self.sessions() as db:
            self.assertIsNotNone(db.get(ScheduleEntry, original))

    def test_overlapping_distinct_slot_ids_are_scanned(self):
        self.add_saved_entry()
        self.add_saved_entry(time_slot_id=2)
        with self.sessions() as db:
            db.get(TimeSlot, 2).slot_label = "09:00-09:50"; db.commit()
        types = {c["type"] for c in self.request("GET", "/conflicts/scan").json()["conflicts"]}
        self.assertTrue({"room_double_booking", "teacher_double_booking", "group_double_booking"} <= types)

    def test_negative_group_size_and_invalid_semester_rejected(self):
        self.assertEqual(self.request("POST", "/student-groups", json={"group_code":"BAD", "student_count":-1}).status_code, 422)
        response = self.request("POST", "/semesters", json={"name":"Bad", "academic_year":2027, "term":"Winter", "start_date":"2027-01-01", "end_date":"2027-03-01"})
        self.assertEqual(response.status_code, 422)

    def test_room_fitting_matches_generator_equipment_and_rounded_capacity(self):
        response = self.request("POST", "/room-fitting/check", json={"session_type":"lab", "target_groups":["IS-26-A"], "room_id":self.lab_id})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["required_seats"], 16)
        self.assertEqual(data["issues"], [])
        self.assertEqual(self.request("POST", "/room-fitting/check", json={"session_type":"lab", "target_groups":["missing"], "room_id":self.lab_id}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
