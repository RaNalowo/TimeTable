"""Validate persisted scheduling configuration before using it."""
import json
from datetime import datetime
from fastapi import HTTPException

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]


def read_availability(raw):
    try:
        matrix = json.loads(raw)
        if not isinstance(matrix, dict) or set(matrix) - set(DAYS):
            raise ValueError()
        for values in matrix.values():
            if not isinstance(values, dict) or any(
                not isinstance(v, str) or v not in {"preferred", "neutral", "blocked"}
                for v in values.values()
            ):
                raise ValueError()
        return matrix
    except (ValueError, TypeError):
        raise HTTPException(status_code=409, detail="Stored teacher availability is invalid. Re-save the teacher's availability.")


def validate_lunch(config):
    try:
        if not isinstance(config, dict):
            raise ValueError()
        start = datetime.strptime(config["start"], "%H:%M")
        end = datetime.strptime(config["end"], "%H:%M")
        days = config["days"]
        if start >= end or not isinstance(days, list) or not days or any(d not in DAYS for d in days):
            raise ValueError()
        return config
    except (ValueError, TypeError, KeyError):
        raise HTTPException(status_code=400, detail="Lunch break needs valid start/end times (HH:MM), start before end, and working days Mon–Fri.")


def read_lunch(raw):
    try:
        return validate_lunch(json.loads(raw or "{}"))
    except (ValueError, TypeError):
        raise HTTPException(status_code=409, detail="Stored lunch-break configuration is invalid. Re-save Hard Constraints.")
