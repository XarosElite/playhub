"""App wiring: startup/shutdown, CORS and error format (app/__init__.py)."""
import pytest
from fastapi.testclient import TestClient

import app as app_package
from app.internal import events
from app.models.servers import Server, ServerEvent


def test_startup_initialises_the_database_and_monitor(SessionLocal, queue, docker_fake, tokens, monkeypatch, engine):
    calls = []
    monkeypatch.setattr(app_package, "init_database", lambda: calls.append("db"))
    monkeypatch.setattr(app_package, "start_monitor", lambda: calls.append("monitor"))
    monkeypatch.setattr(app_package, "stop_monitor", lambda: calls.append("stop"))
    monkeypatch.setattr(app_package, "log_auth_config", lambda: calls.append("auth"))
    with TestClient(app_package.create_app()):
        assert calls == ["auth", "db", "monitor"]
    assert calls[-1] == "stop"


def test_startup_fails_if_the_database_never_comes_up(SessionLocal, monkeypatch):
    from sqlalchemy.exc import OperationalError

    def down():
        raise OperationalError("CONNECT", {}, Exception("connection refused"))

    monkeypatch.setattr(app_package, "init_database", down)
    monkeypatch.setattr(app_package, "start_monitor", lambda: pytest.fail("monitor started without a database"))
    with pytest.raises(OperationalError):
        with TestClient(app_package.create_app()):
            pass


def test_served_under_api(app):
    assert app.root_path == "/api"
    assert app.title == "Playhub Api"


def test_cors_allows_any_origin(client):
    response = client.options("/servers/", headers={
        "Origin": "http://192.168.4.25:4201",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
    })
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] in ("*", "http://192.168.4.25:4201")
    assert "authorization" in response.headers["access-control-allow-headers"].lower()


def test_validation_errors_have_a_consistent_shape(client, alice):
    response = client.get("/servers/mc1/activity?limit=lots", headers=alice.headers)
    assert response.status_code == 422
    body = response.json()
    assert body["msg"] == "Validation error"
    assert body["details"][0]["loc"] == ["query", "limit"]


def test_unknown_route(client, alice):
    assert client.get("/nope", headers=alice.headers).status_code == 404


def test_openapi_docs_are_public(client):
    assert client.get("/openapi.json").status_code == 200


def test_record_event_joins_the_callers_transaction(db):
    server = Server(name="mc1", game_type="minecraft", state="running", port=10000, owner_id="u")
    db.add(server)
    db.commit()
    events.record_event(db, server, "u", "started", "detail")
    db.rollback()
    assert db.query(ServerEvent).count() == 0  # not committed on its own
    events.record_event(db, server, None, "crashed")
    db.commit()
    assert [(e.action, e.actor_uid, e.detail) for e in db.query(ServerEvent)] == [("crashed", None, None)]


def test_docker_client_is_created_lazily_and_shared(monkeypatch):
    from app.internal import docker_client
    created = []

    class FakeClient:
        def __init__(self, base_url):
            created.append(base_url)

    monkeypatch.setattr(docker_client, "_client", None)
    monkeypatch.setattr(docker_client.docker, "DockerClient", FakeClient)
    monkeypatch.setenv("DOCKER_HOST", "tcp://proxy:2375")
    assert created == []
    first = docker_client.get_docker()
    assert docker_client.get_docker() is first
    assert created == ["tcp://proxy:2375"]
