import os
import secrets
from pathlib import Path
from dotenv import load_dotenv

PROJECT_DIR = Path(__file__).resolve().parent
load_dotenv(PROJECT_DIR / ".env", override=False)
# Set SECRET_KEY in the environment for persistent sessions across restarts.
SECRET_KEY = os.environ.get("SECRET_KEY") or secrets.token_urlsafe(48)
ALGORITHM = "HS256"

ACCESS_TOKEN_EXPIRE_MINUTES = 1440

DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{PROJECT_DIR / 'database.db'}")

MAX_FAILED = 5
LOCK_MINUTES = 15

OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-6-luna")
