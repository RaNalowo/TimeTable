"""Sprint 5 regression tests: access control, whole-class moves, rollback, change-request rules.
They reuse the fixture of test_scheduling.py (1 group with 2 sub-groups, 1 teacher, 10 time slots)."""
import unittest

import test_scheduling as _base
from db.models import ScheduleEntry, Semester, Teacher
from services.security import create_access_token
from services.time_slots import DEFAULT_SLOTS


class Sprint5Tests(_base.SchedulingTests):
    def teacher_headers(self):
        return {"Authorization": "Bearer " + create_access_token(self.teacher_user_id, ["teacher"])}

    def publish(self):
        with self.sessions() as db:
            db.get(Semester, self.semester_id).is_published = True
            db.commit()

    def add_block(self, sub_group, first_slot_id, hours=2):
        return [self.add_saved_entry(day="Mon", time_slot_id=first_slot_id + k, session_type="practice",
                                     sub_group=sub_group) for k in range(hours)]

    def slots_of(self, ids):
        with self.sessions() as db:
            return [(db.get(ScheduleEntry, i).day, db.get(ScheduleEntry, i).time_slot_id) for i in ids]

    def test_draft_and_conflict_list_are_admin_only(self):
        for path in ("/generator/entries", "/conflicts/scan"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path, headers=self.teacher_headers()).status_code, 403)
                self.assertEqual(self.client.get(path).status_code, 401)
                self.assertEqual(self.request("GET", path).status_code, 200)

    def test_moving_a_class_moves_all_its_hours_but_not_a_neighbouring_subgroup(self):
        first = self.add_block("1", 1)    # sub-group 1 on slots 1-2
        second = self.add_block("2", 3)   # sub-group 2 directly after it (same teacher, same course)
        response = self.request("PUT", f"/conflicts/entries/{first[1]}",
                                json={"day": "Tue", "time_slot": DEFAULT_SLOTS[5]})   # 2nd hour dropped on slot 6
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.slots_of(first), [("Tue", 5), ("Tue", 6)])
        self.assertEqual(self.slots_of(second), [("Mon", 3), ("Mon", 4)])

    def test_move_that_does_not_fit_the_grid_changes_nothing(self):
        ids = self.add_block("1", 9)      # slots 9-10, the last two of the day
        response = self.request("PUT", f"/conflicts/entries/{ids[0]}",
                                json={"day": "Mon", "time_slot": DEFAULT_SLOTS[9]})   # would need slot 11
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(self.slots_of(ids), [("Mon", 9), ("Mon", 10)])

    def test_change_requests_follow_publication_and_ownership_rules(self):
        mine = self.add_saved_entry(day="Mon", time_slot_id=1, session_type="lecture")
        with self.sessions() as db:
            other = Teacher(full_name="Other", email="other@test.edu", max_weekly_hours=20,
                            max_daily_hours=4, qualified_subjects="IS101")
            db.add(other)
            db.commit()
            other_id = other.id
        theirs = self.add_saved_entry(day="Wed", time_slot_id=1, teacher_id=other_id, session_type="lecture")
        teacher = self.teacher_headers()

        def ask(entry_id, headers):
            return self.client.post("/conflicts/requests", headers=headers,
                                    json={"entry_id": entry_id, "reason": "Clash with another course"})

        self.assertEqual(ask(mine, teacher).status_code, 400)      # timetable not published yet
        self.publish()
        self.assertEqual(ask(theirs, teacher).status_code, 403)    # somebody else's class
        self.assertEqual(ask(mine, teacher).status_code, 200)
        second_hour = self.add_saved_entry(day="Mon", time_slot_id=2, session_type="lecture")
        self.assertEqual(ask(second_hour, teacher).status_code, 400)   # one pending request per class
        self.assertEqual(ask(mine, self.headers).status_code, 403)     # admins do not file requests

    def test_a_decided_request_cannot_be_decided_again(self):
        mine = self.add_saved_entry(day="Mon", time_slot_id=1, session_type="lecture")
        self.publish()
        teacher = self.teacher_headers()
        created = self.client.post("/conflicts/requests", headers=teacher,
                                   json={"entry_id": mine, "reason": "Need another time"})
        self.assertEqual(created.status_code, 200, created.text)
        request_id = created.json()["request_id"]
        first = self.request("PUT", f"/conflicts/requests/{request_id}",
                             json={"status": "rejected", "admin_note": "Room is needed"})
        self.assertEqual(first.status_code, 200, first.text)
        again = self.request("PUT", f"/conflicts/requests/{request_id}", json={"status": "approved"})
        self.assertEqual(again.status_code, 400)
        notes = self.client.get("/conflicts/requests/notifications", headers=teacher).json()
        self.assertEqual([n["status"] for n in notes], ["rejected"])
        self.assertEqual(notes[0]["admin_note"], "Room is needed")


# run only the Sprint 5 tests here, not the inherited ones again
for _name in dir(_base.SchedulingTests):
    if _name.startswith("test_") and _name not in Sprint5Tests.__dict__:
        setattr(Sprint5Tests, _name, None)

if __name__ == "__main__":
    unittest.main()
