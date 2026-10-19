from db.models import AuditLog


def log_event(db, user_id, event, success, detail=None, *, commit=True):
    db.add(AuditLog(user_id=user_id, event=event, success=success, detail=detail))
    if commit:
        db.commit()
