"""
Shared fixtures for the API tests.

The tests run against SQLite by default. Set TEST_DATABASE_URL to run them
against a real database instead, e.g.

    TEST_DATABASE_URL=postgresql+psycopg2://playhuber:Blayhub@localhost:5433/playhub_test pytest

(docker-compose.test.yml at the repo root does this with a throwaway Postgres).

External services are replaced by in-memory fakes:
* Firebase: ID tokens are verified by the real google-auth code where it
  matters (see test_firebase_auth.py); elsewhere tokens are "token-<name>"
  strings issued by the `users` fixture.
* Redis/RQ: FakeQueue records enqueued jobs (test_rq_integration.py uses a
  real RQ queue on fakeredis).
* Docker: FakeDocker (tests/fakes.py).
"""
import os
import time

# Must be set before the app is imported: auth reads it at import time.
os.environ["FIREBASE_PROJECT_ID"] = "playhub-test"
os.environ.pop("VITE_FIREBASE_PROJECT_ID", None)
os.environ["AUTH_ALLOWED_EMAILS"] = ""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app as app_package
import app.database as database
import app.depenencies as deps
import app.internal.auth as auth
import app.internal.live as live
import app.internal.users as users_module
import app.routers.server_streams as server_streams
from app.database import Base
from app.models.servers import Server, ServerEvent, ServerShare  # noqa: F401 – registers tables
from app.models.users import User  # noqa: F401 – registers tables

from tests.fakes import FakeDocker, FakeQueue

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
PROJECT_ID = "playhub-test"


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
def _make_sqlite_engine():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    # SQLite only enforces foreign keys (and ON DELETE CASCADE) when asked.
    event.listen(engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"))
    return engine


@pytest.fixture(scope="session")
def _postgres_engine():
    if not TEST_DATABASE_URL:
        yield None
        return
    engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def engine(_postgres_engine):
    """A clean database for each test."""
    if _postgres_engine is None:
        engine = _make_sqlite_engine()
        Base.metadata.create_all(engine)
        yield engine
        engine.dispose()
        return
    yield _postgres_engine
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with _postgres_engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture
def is_postgres(engine):
    return engine.dialect.name == "postgresql"


@pytest.fixture
def SessionLocal(engine, monkeypatch):
    """Session factory bound to the test database, patched in everywhere the app opens sessions."""
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    monkeypatch.setattr(database, "SessionLocal", factory)
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(app_package, "engine", engine)
    monkeypatch.setattr(users_module, "SessionLocal", factory)
    monkeypatch.setattr(live, "SessionLocal", factory)
    monkeypatch.setattr(server_streams, "SessionLocal", factory)
    return factory


@pytest.fixture
def db(SessionLocal):
    with SessionLocal() as session:
        yield session


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
class TokenRegistry:
    """
    Stands in for Firebase: maps fake ID tokens to the claims
    google-auth would return after verifying a real one.
    """

    def __init__(self):
        self.claims: dict[str, dict] = {}
        self.calls = 0

    def issue(self, uid, email=None, name=None, picture=None, email_verified=True, expires_in=3600, **extra):
        token = f"token-{uid}"
        self.claims[token] = {
            "iss": f"https://securetoken.google.com/{PROJECT_ID}",
            "aud": PROJECT_ID,
            "sub": uid,
            "email": email,
            "email_verified": email_verified,
            "name": name,
            "picture": picture,
            "exp": time.time() + expires_in,
            **extra,
        }
        return token

    def verify(self, token, request, audience=None, clock_skew_in_seconds=0):
        self.calls += 1
        if token not in self.claims:
            raise ValueError("Could not verify token signature.")
        return dict(self.claims[token])


@pytest.fixture(autouse=True)
def _reset_module_state(monkeypatch):
    """Module-level caches would otherwise leak between tests."""
    auth._token_cache.clear()
    users_module._last_recorded.clear()
    with live._lock:
        live._live.clear()
        live._history.clear()
    live._prev_cpu.clear()
    monkeypatch.setattr(auth, "FIREBASE_PROJECT_ID", PROJECT_ID)
    monkeypatch.setattr(auth, "ALLOWED_EMAILS", set())
    yield
    auth._token_cache.clear()
    users_module._last_recorded.clear()


@pytest.fixture
def tokens(monkeypatch):
    registry = TokenRegistry()
    monkeypatch.setattr(auth.id_token, "verify_firebase_token", registry.verify)
    return registry


class Person:
    def __init__(self, uid, email, name, token):
        self.uid = uid
        self.email = email
        self.name = name
        self.token = token
        self.headers = {"Authorization": f"Bearer {token}"}


@pytest.fixture
def make_user(tokens):
    def make(uid, name=None, email=None, **claims):
        email = email if email is not None else f"{uid}@example.com"
        token = tokens.issue(uid, email=email, name=name, **claims)
        return Person(uid, email, name, token)
    return make


@pytest.fixture
def alice(make_user):
    return make_user("uid-alice", name="Alice", email="alice@example.com")


@pytest.fixture
def bob(make_user):
    return make_user("uid-bob", name="Bob", email="bob@example.com")


@pytest.fixture
def carol(make_user):
    return make_user("uid-carol", name="Carol", email="carol@example.com")


# ---------------------------------------------------------------------------
# Redis queue and Docker
# ---------------------------------------------------------------------------
@pytest.fixture
def queue():
    return FakeQueue()


@pytest.fixture
def docker_fake(monkeypatch):
    fake = FakeDocker()
    monkeypatch.setattr(live, "get_docker", lambda: fake)
    monkeypatch.setattr(server_streams, "_docker_client", lambda: fake)
    return fake


@pytest.fixture
def pings(monkeypatch):
    """Records Minecraft status pings; set `.result` (dict or Exception) to control the answer."""
    class Pings(list):
        result = {"online": 3, "max": 20, "version": "1.21.4"}

    recorded = Pings()

    def fake_ping(host, port):
        recorded.append((host, port))
        if isinstance(recorded.result, Exception):
            raise recorded.result
        return recorded.result

    monkeypatch.setattr(live, "ping", fake_ping)
    return recorded


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
@pytest.fixture
def app(SessionLocal, queue, docker_fake, tokens, monkeypatch):
    monkeypatch.setattr(deps, "is_port_available_on_host", lambda port: True)
    # The monitor thread is tested directly (test_live.py); don't run it in the background.
    monkeypatch.setattr(app_package, "start_monitor", lambda: None)
    monkeypatch.setattr(app_package, "stop_monitor", lambda: None)
    monkeypatch.setattr(app_package, "DB_INIT_RETRY_SECONDS", 0)

    application = app_package.create_app()

    def get_test_db():
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    application.dependency_overrides[database.get_db] = get_test_db
    application.dependency_overrides[deps.get_redis_queue] = lambda: queue
    return application


@pytest.fixture
def client(app):
    # Entering the context runs the app's lifespan (logging, auth config, DB init).
    with TestClient(app) as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
@pytest.fixture
def create_server(client, queue):
    """Creates a server through the API and returns its DB name."""
    def create(person, name="mc1", game_type="minecraft", environment=None, expect=201):
        response = client.post(
            "/servers/create", headers=person.headers,
            json={"name": name, "game_type": game_type, "environment": environment or {}},
        )
        assert response.status_code == expect, response.text
        return response
    return create


@pytest.fixture
def set_state(SessionLocal):
    """Simulates the worker settling a server, e.g. set_state('mc1', 'running', container_id='cid1')."""
    def set_state(name, state, **columns):
        with SessionLocal() as session:
            server = session.query(Server).filter_by(name=name).one()
            server.state = state
            for key, value in columns.items():
                setattr(server, key, value)
            session.commit()
    return set_state


@pytest.fixture
def get_server_row(SessionLocal):
    def get(name):
        with SessionLocal() as session:
            server = session.query(Server).filter_by(name=name).one()
            session.expunge(server)
            return server
    return get


@pytest.fixture
def running_server(client, alice, create_server, set_state, docker_fake):
    """A running Minecraft server 'mc1' owned by alice, with container 'cid-mc1'."""
    create_server(alice, "mc1")
    set_state("mc1", "running", container_id="cid-mc1")
    docker_fake.add_container("mc1", id="cid-mc1", status="running")
    return "cid-mc1"
