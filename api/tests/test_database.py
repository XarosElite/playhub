"""
Database schema, constraints and startup (app/__init__.py, app/models).

Run against Postgres by setting TEST_DATABASE_URL (see conftest.py); the
constraint tests matter most there.
"""
import datetime

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError, OperationalError

import app as app_package
from app.database import Base
from app.models.servers import Server, ServerEvent, ServerShare, release_name_and_port
from app.models.users import User


@pytest.fixture
def owner(db):
    user = User(uid="uid-owner", email="owner@example.com", name="Owner")
    db.add(user)
    db.commit()
    return user


def make_server(db, name="mc1", port=10000, **columns):
    columns.setdefault("state", "running")
    server = Server(name=name, game_type="minecraft", port=port, owner_id="uid-owner", **columns)
    db.add(server)
    db.commit()
    return server


class TestSchema:
    def test_tables(self, engine, SessionLocal):
        assert {"servers", "server_shares", "server_events", "users"} <= set(inspect(engine).get_table_names())

    def test_server_columns(self, engine, SessionLocal):
        columns = {c["name"] for c in inspect(engine).get_columns("servers")}
        assert columns == {"id", "created", "game_type", "container_id", "name", "state", "port",
                           "owner_id", "config", "status_message"}

    def test_defaults(self, db):
        server = make_server(db)
        assert isinstance(server.created, datetime.datetime)
        assert server.config is None and server.status_message is None
        user = User(uid="u")
        db.add(user)
        db.commit()
        assert user.created is not None and user.last_seen is not None

    def test_config_round_trips_as_json(self, db):
        config = {"MAX_PLAYERS": 20, "PVP": True, "EXP_RATE": 1.5, "SEED": "abc", "nested": {"a": [1, 2]}}
        server = make_server(db, config=config)
        db.expire_all()
        assert db.get(Server, server.id).config == config

    def test_timestamps_are_timezone_aware_in_postgres(self, db, is_postgres):
        if not is_postgres:
            pytest.skip("SQLite does not store time zones")
        server = make_server(db)
        db.expire_all()
        created = db.get(Server, server.id).created
        assert created.tzinfo is not None
        assert abs(created - datetime.datetime.now(datetime.timezone.utc)) < datetime.timedelta(minutes=1)


class TestConstraints:
    def test_names_are_unique(self, db):
        make_server(db, "mc1", 10000)
        with pytest.raises(IntegrityError):
            make_server(db, "mc1", 10001)

    def test_ports_are_unique(self, db):
        make_server(db, "a-server", 10000)
        with pytest.raises(IntegrityError):
            make_server(db, "b-server", 10000)

    def test_many_released_ports(self, db):
        make_server(db, "a (deleted #1)", None, state="deleted")
        make_server(db, "b (deleted #2)", None, state="deleted")
        assert db.query(Server).filter(Server.port.is_(None)).count() == 2

    def test_a_user_is_shared_a_server_once(self, db, owner):
        server = make_server(db)
        db.add(User(uid="uid-friend"))
        db.commit()
        db.add(ServerShare(server_id=server.id, user_uid="uid-friend", granted_by=owner.uid))
        db.commit()
        db.add(ServerShare(server_id=server.id, user_uid="uid-friend", granted_by=owner.uid))
        with pytest.raises(IntegrityError):
            db.commit()

    def test_shares_need_a_real_user(self, db, owner):
        server = make_server(db)
        db.add(ServerShare(server_id=server.id, user_uid="uid-nobody", granted_by=owner.uid))
        with pytest.raises(IntegrityError):
            db.commit()

    def test_shares_need_a_real_server(self, db, owner):
        db.add(ServerShare(server_id=999, user_uid=owner.uid, granted_by=owner.uid))
        with pytest.raises(IntegrityError):
            db.commit()

    def test_events_need_a_real_server(self, db):
        db.add(ServerEvent(server_id=999, action="started"))
        with pytest.raises(IntegrityError):
            db.commit()

    def test_events_need_an_action(self, db):
        server = make_server(db)
        db.add(ServerEvent(server_id=server.id, action=None))
        with pytest.raises(IntegrityError):
            db.commit()

    def test_deleting_a_server_removes_its_shares_and_events(self, db, owner):
        server = make_server(db)
        db.add(User(uid="uid-friend"))
        db.commit()
        db.add(ServerShare(server_id=server.id, user_uid="uid-friend", granted_by=owner.uid))
        db.add(ServerEvent(server_id=server.id, action="created"))
        db.commit()
        db.execute(text("DELETE FROM servers WHERE id = :id"), {"id": server.id})
        db.commit()
        assert db.query(ServerShare).count() == 0
        assert db.query(ServerEvent).count() == 0

    def test_deleting_a_user_removes_their_shares(self, db, owner):
        server = make_server(db)
        db.add(User(uid="uid-friend"))
        db.commit()
        db.add(ServerShare(server_id=server.id, user_uid="uid-friend", granted_by=owner.uid))
        db.commit()
        db.execute(text("DELETE FROM users WHERE uid = 'uid-friend'"))
        db.commit()
        assert db.query(ServerShare).count() == 0
        assert db.query(Server).count() == 1


class TestReleaseNameAndPort:
    def test_renames_and_frees_the_port(self, db):
        server = make_server(db)
        release_name_and_port(server)
        db.commit()
        assert (server.name, server.port) == (f"mc1 (deleted #{server.id})", None)

    def test_frees_the_name_for_a_new_server(self, db):
        old = make_server(db)
        old.state = "deleted"
        release_name_and_port(old)
        db.commit()
        make_server(db, "mc1", 10000)
        assert db.query(Server).count() == 2


class TestStartup:
    @pytest.fixture(autouse=True)
    def _restore_schema(self, engine):
        yield
        # Some tests replace tables with hand-made legacy versions.
        with engine.begin() as conn:
            for table in ("server_events", "server_shares", "servers"):
                conn.execute(text(f"DROP TABLE IF EXISTS {table}"))
        type(Base.metadata).create_all(Base.metadata, engine)  # unpatched

    def test_creates_missing_tables(self, engine, SessionLocal):
        Base.metadata.drop_all(engine)
        app_package.init_database()
        assert {"servers", "users", "server_shares", "server_events"} <= set(inspect(engine).get_table_names())

    def test_is_idempotent(self, engine, SessionLocal, db):
        make_server(db)
        app_package.init_database()
        app_package.init_database()
        assert db.query(Server).count() == 1

    def test_adds_columns_missing_from_older_databases(self, engine, SessionLocal):
        with engine.begin() as conn:
            conn.execute(text("DROP TABLE server_events"))
            conn.execute(text("DROP TABLE server_shares"))
            conn.execute(text("DROP TABLE servers"))
            conn.execute(text(
                "CREATE TABLE servers (id INTEGER PRIMARY KEY, created TIMESTAMP, game_type VARCHAR, "
                "container_id VARCHAR, name VARCHAR UNIQUE, state VARCHAR, port INTEGER UNIQUE, "
                "owner_id VARCHAR, config JSON)"
            ))
            conn.execute(text("INSERT INTO servers (id, name, state, port, game_type) VALUES (1, 'old', 'running', 10000, 'minecraft')"))
        app_package.init_database()
        assert "status_message" in {c["name"] for c in inspect(engine).get_columns("servers")}
        with engine.connect() as conn:
            assert conn.execute(text("SELECT name, status_message FROM servers")).all() == [("old", None)]

    def test_releases_servers_deleted_before_names_were_released(self, engine, SessionLocal, db):
        make_server(db, "legacy", 10000, state="deleted")
        make_server(db, "alive", 10001)
        app_package.init_database()
        db.expire_all()
        rows = {s.state: (s.name, s.port) for s in db.query(Server)}
        assert rows["deleted"][0].startswith("legacy (deleted #") and rows["deleted"][1] is None
        assert rows["running"] == ("alive", 10001)

    def test_retries_while_the_database_starts(self, SessionLocal, monkeypatch):
        attempts = []
        real_create_all = Base.metadata.create_all

        def flaky_create_all(bind):
            attempts.append(1)
            if len(attempts) < 3:
                raise OperationalError("CONNECT", {}, Exception("the database system is starting up"))
            return real_create_all(bind=bind)

        sleeps = []
        monkeypatch.setattr(Base.metadata, "create_all", flaky_create_all)
        monkeypatch.setattr(app_package.time, "sleep", sleeps.append)
        app_package.init_database()
        assert len(attempts) == 3
        assert sleeps == [app_package.DB_INIT_RETRY_SECONDS] * 2

    def test_gives_up_after_all_attempts(self, SessionLocal, monkeypatch):
        attempts = []

        def down(bind):
            attempts.append(1)
            raise OperationalError("CONNECT", {}, Exception("connection refused"))

        monkeypatch.setattr(Base.metadata, "create_all", down)
        monkeypatch.setattr(app_package.time, "sleep", lambda s: None)
        with pytest.raises(OperationalError):
            app_package.init_database()
        assert len(attempts) == app_package.DB_INIT_ATTEMPTS

    def test_other_errors_are_not_retried(self, SessionLocal, monkeypatch):
        attempts = []

        def broken(bind):
            attempts.append(1)
            raise IntegrityError("x", {}, Exception("x"))

        monkeypatch.setattr(Base.metadata, "create_all", broken)
        with pytest.raises(IntegrityError):
            app_package.init_database()
        assert len(attempts) == 1
