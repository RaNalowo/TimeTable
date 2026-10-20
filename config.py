import os
import secrets
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
SECRET_KEY = "this_is_a_very_secret_key_for_university_project_2026_do_not_change"
ALGORITHM = "HS256"

ACCESS_TOKEN_EXPIRE_MINUTES = 1440

DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{PROJECT_DIR / 'database.db'}")

MAX_FAILED = 5
LOCK_MINUTES = 15
