import os
import secrets
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
# Set SECRET_KEY in the environment for persistent sessions across restarts.
SECRET_KEY = os.environ.get("SECRET_KEY") or secrets.token_urlsafe(48)
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{PROJECT_DIR / 'database.db'}")

MAX_FAILED = 5
LOCK_MINUTES = 15
