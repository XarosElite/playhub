"""
Fixtures for the worker (tasks/dockerjobs.py) tests.

The worker talks to Postgres with raw SQL against tables the API creates. The
tests use the API's own models when the api/ folder is next to this one (the
repo checkout) and an identical copy otherwise (e.g. inside the worker image),
on SQLite by default or TEST_DATABASE_URL when set.
"""
import os
import sys
from pathlib import Path

import docker
import pytest
from sqlalchemy import (
    JSON, Column, DateTime, ForeignKey, Integer, MetaData, String, Table, Text, create_engine, event, text,
)
from sqlalchemy.pool import StaticPool

WORKER_DIR = Path(__file__).resolve().parent.parent
API_DIR = WORKER_DIR.parent / "api"
sys.path.insert(0, str(WORKER_DIR))

# tasks.dockerjobs connects to Docker at import time; the tests swap the client per test.
_real_docker_client = docker.DockerClient
docker.DockerClient = lambda *args, **kwargs: None
from tasks import dockerjobs  # noqa: E402
docker.DockerClient = _real_docker_client

from tests.fakes import FakeDocker  # noqa: E402

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")


def worker_schema() -> MetaData:
    """The columns the worker reads and writes, as the API defines them."""
    metadata = MetaData()
    Table(
        "servers", metadata,
        Column("id", Integer, primary_key=True),
        Column("created", DateTime(timezone=True)),
        Column("game_type", String),
        Column("container_id", String),
        Column("name", String, unique=True),
        Column("state", String),
        Column("port", Integer, unique=True),
        Column("owner_id", String),
        Column("config", JSON),
        Column("status_message", Text),
    )
    Table(
        "server_events", metadata,
        Column("id", Integer, primary_key=True),
        Column("server_id", Integer, ForeignKey("servers.id", ondelete="CASCADE"), nullable=False),
        Column("actor_uid", String),
        Column("action", String, nullable=False),
        Column("detail", Text),
        Column("created", DateTime(timezone=True)),
    )
    return metadata


def api_schema():
    """The API's real metadata, if the API source is available."""
    if not (API_DIR / "app" / "models" / "servers.py").exists():
        return None
    sys.path.insert(0, str(API_DIR))
    try:
        from app.database import Base
        import app.models.servers  # noqa: F401
        import app.models.users  # noqa: F401
        return Base.metadata
    except ImportError:
        return None
    finally:
        sys.path.remove(str(API_DIR))


@pytest.fixture(scope="session")
def schema():
    return api_schema() or worker_schema()


@pytest.fixture
def engine(schema, monkeypatch):
    if TEST_DATABASE_URL:
        engine = create_engine(TEST_DATABASE_URL)
        schema.drop_all(engine)
    else:
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        event.listen(engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"))
    schema.create_all(engine)
    monkeypatch.setattr(dockerjobs, "db_engine", engine)
    yield engine
    schema.drop_all(engine)
    engine.dispose()


@pytest.fixture
def add_server(engine):
    def add(name="mc1", state="starting", port=10000, container_id="", status_message=None):
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO servers (name, state, port, container_id, game_type, owner_id, status_message) "
                "VALUES (:name, :state, :port, :cid, 'minecraft', 'uid-alice', :msg)"
            ), {"name": name, "state": state, "port": port, "cid": container_id, "msg": status_message})
    return add


@pytest.fixture
def server_row(engine):
    def get(name="mc1"):
        with engine.connect() as conn:
            row = conn.execute(text(
                "SELECT name, state, container_id, status_message, created FROM servers WHERE name = :name"
            ), {"name": name}).mappings().first()
            return dict(row) if row else None
    return get


@pytest.fixture
def server_events(engine):
    def get(name="mc1"):
        with engine.connect() as conn:
            return [tuple(r) for r in conn.execute(text(
                "SELECT e.action, e.actor_uid, e.detail FROM server_events e "
                "JOIN servers s ON s.id = e.server_id WHERE s.name = :name ORDER BY e.id"
            ), {"name": name})]
    return get


@pytest.fixture
def docker_fake(monkeypatch):
    fake = FakeDocker()
    monkeypatch.setattr(dockerjobs, "client", fake)
    return fake
