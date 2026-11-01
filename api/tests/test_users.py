"""record_user keeps the Postgres user directory in sync with Firebase sign-ins."""
import threading

import pytest
from sqlalchemy.exc import IntegrityError, OperationalError

import app.internal.users as users
from app.internal.auth import AuthUser
from app.models.users import User, user_to_dict


def person(uid="uid-1", email="one@example.com", name="One", picture=None):
    return AuthUser(uid=uid, email=email, name=name, picture=picture)


def test_creates_a_profile(SessionLocal, db):
    users.record_user(person(picture="https://example.com/p.png"))
    row = db.get(User, "uid-1")
    assert (row.email, row.name, row.picture) == ("one@example.com", "One", "https://example.com/p.png")
    assert row.created is not None and row.last_seen is not None


def test_updates_an_existing_profile(SessionLocal, db, monkeypatch):
    users.record_user(person())
    users._last_recorded.clear()  # past the throttle window
    users.record_user(person(name="One Renamed", email="new@example.com"))
    db.expire_all()
    row = db.get(User, "uid-1")
    assert (row.name, row.email) == ("One Renamed", "new@example.com")
    assert db.query(User).count() == 1


def test_is_throttled_per_user(SessionLocal, db, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(users.time, "time", lambda: clock[0])
    users.record_user(person())
    users.record_user(person(name="Changed"))
    db.expire_all()
    assert db.get(User, "uid-1").name == "One"  # second call skipped

    users.record_user(person(uid="uid-2", email="two@example.com"))
    assert db.get(User, "uid-2") is not None  # other users aren't throttled

    clock[0] += users._REFRESH_SECONDS
    users.record_user(person(name="Changed"))
    db.expire_all()
    assert db.get(User, "uid-1").name == "Changed"


def test_never_raises_and_retries_after_a_failure(SessionLocal, monkeypatch, caplog):
    class Broken:
        def __enter__(self):
            raise OperationalError("SELECT", {}, Exception("database is down"))

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(users, "SessionLocal", lambda: Broken())
    users.record_user(person())  # does not raise
    assert "Failed to record user uid-1" in caplog.text
    # The throttle is cleared so the next request tries again.
    assert "uid-1" not in users._last_recorded

    monkeypatch.setattr(users, "SessionLocal", SessionLocal)
    users.record_user(person())
    with SessionLocal() as db:
        assert db.get(User, "uid-1") is not None


def test_retries_when_a_concurrent_request_inserted_first(SessionLocal, db, monkeypatch):
    """Two first requests from the same user race to insert the row."""
    real_commit = None
    attempts = []

    original_factory = users.SessionLocal

    def factory():
        session = original_factory()
        nonlocal real_commit
        real_commit = session.commit

        def commit():
            attempts.append(1)
            if len(attempts) == 1:
                # Another request wins the race.
                with original_factory() as other:
                    other.add(User(uid="uid-1", email="other@example.com", name="Other"))
                    other.commit()
                raise IntegrityError("INSERT", {}, Exception("duplicate key"))
            return real_commit()

        session.commit = commit
        return session

    monkeypatch.setattr(users, "SessionLocal", factory)
    users.record_user(person())
    assert len(attempts) == 2
    db.expire_all()
    assert db.get(User, "uid-1").name == "One"  # our values were written on the retry


def test_concurrent_calls_record_once(SessionLocal, db, monkeypatch):
    calls = []
    original = users.SessionLocal

    def counting():
        calls.append(1)
        return original()

    monkeypatch.setattr(users, "SessionLocal", counting)
    threads = [threading.Thread(target=users.record_user, args=(person(),)) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(calls) == 1


@pytest.mark.parametrize("row, expected", [
    (User(uid="u", name="N", email="e@x", picture="p"), {"uid": "u", "name": "N", "email": "e@x", "picture": "p"}),
    (User(uid="u"), {"uid": "u", "name": None, "email": None, "picture": None}),
])
def test_user_to_dict(row, expected):
    assert user_to_dict(row) == expected
