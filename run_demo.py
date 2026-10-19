"""Start a seeded Sprint 3 demo without modifying the original database.db."""
import argparse
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    path = ROOT / "database.sprint3.db"
    if not path.exists():
        fd, staging = tempfile.mkstemp(prefix=".demo-setup-", suffix=".db", dir=ROOT)
        os.close(fd)
        try:
            env = dict(os.environ, DATABASE_URL=f"sqlite:///{staging}")
            subprocess.run([sys.executable, str(ROOT / "init_db.py")], cwd=ROOT, env=env, check=True)
            os.replace(staging, path)
        finally:
            Path(staging).unlink(missing_ok=True)
    with sqlite3.connect(path) as db:
        columns = {row[1] for row in db.execute("PRAGMA table_info(schedule_entries)")}
        if not {"semester_id", "time_slot_id", "sub_group"} <= columns:
            raise SystemExit("The demo database has an outdated schema. Preserve it and choose a fresh demo database before starting.")
    os.environ["DATABASE_URL"] = f"sqlite:///{path}"
    print(f"Demo database: {path}\nOriginal database.db is unchanged.", flush=True)
    if args.prepare_only:
        return
    print(f"Open http://127.0.0.1:{args.port} — admin@sdu.edu.kz / Admin123!", flush=True)
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
