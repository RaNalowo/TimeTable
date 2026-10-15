"""Helpers to compute a student group's current academic year."""
import re

from db.models import Semester


def get_active_semester(db):
    return db.query(Semester).filter_by(is_active=True).first()


def parse_semester_level(level: str):
    """'Year 3 Fall' -> (3, 'Fall'). Returns (None, None) if unparseable."""
    if not level:
        return None, None
    m = re.match(r"Year\s*(\d)\s*(Fall|Spring)", level)
    if not m:
        return None, None
    return int(m.group(1)), m.group(2)


def current_year_for_group(group, semester):
    """
    Given a group's enrollment_year and a semester's academic_year/term,
    compute the student's current year of study.

    Fall:   year = academic_year - enrollment_year + 1
    Spring: year = academic_year - enrollment_year
    """
    # If manually overridden (e.g., repeated a year), use that
    if group.year_override:
        return group.year_override

    if not group.enrollment_year or not semester:
        return None

    offset = semester.academic_year - group.enrollment_year
    if semester.term == "Fall":
        return offset + 1
    else:
        return offset


def group_matches_course(group, course, semester):
    """
    Return True if this group should attend this course
    in the given active semester.
    """
    course_year, course_term = parse_semester_level(course.semester_level)
    if course_year is None:
        return False

    if semester.term != course_term:
        return False

    return current_year_for_group(group, semester) == course_year