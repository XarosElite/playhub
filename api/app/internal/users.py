"""Keeps the Postgres user directory in sync with Firebase sign-ins."""
import datetime
import logging
import threading
import time

from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.models.users import User

# Write the profile at most this often per user (it's refreshed on each sign-in anyway).
_REFRESH_SECONDS = 300
_last_recorded: dict[str, float] = {}
_lock = threading.Lock()


def record_user(user) -> None:
    """Upsert the signed-in user's profile. Blocking; never raises."""
    now = time.time()
    with _lock:
        if now - _last_recorded.get(user.uid, 0) < _REFRESH_SECONDS:
            return
        _last_recorded[user.uid] = now

    try:
        with SessionLocal() as db:
            for _ in range(2):  # retry once if a concurrent request inserted the row first
                row = db.get(User, user.uid)
                if row is None:
                    row = User(uid=user.uid)
                    db.add(row)
                row.email = user.email
                row.name = user.name
                row.picture = user.picture
                row.last_seen = datetime.datetime.now(datetime.timezone.utc)
                try:
                    db.commit()
                    return
                except IntegrityError:
                    db.rollback()
    except Exception as e:
        with _lock:
            _last_recorded.pop(user.uid, None)
        logging.error(f"Failed to record user {user.uid}: {e}")
