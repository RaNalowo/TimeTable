"""Import missing CSV demo records using the current seed script.

Existing business data is preserved; records with existing identifiers are skipped.
Uses courses_is.csv and courses_cs.csv, with direct program references.
"""
from pathlib import Path
import subprocess
import sys


if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    subprocess.run([sys.executable, str(root / "init_db.py")], cwd=root, check=True)
