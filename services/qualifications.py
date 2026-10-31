"""Share qualification checks across old course-name and new course-code data."""


def teacher_qualified(teacher, course_code, course_name=""):
    subjects = [s.strip().casefold() for s in (teacher.qualified_subjects or "").split(",") if s.strip()]
    code = (course_code or "").strip().casefold()
    name = (course_name or "").strip().casefold()
    return any((bool(code) and subject == code) or
               (bool(name) and (subject in name or name in subject))
               for subject in subjects)
