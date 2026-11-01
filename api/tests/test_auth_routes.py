"""The auth dependency, /auth/me and /users/ (who can sign in and how they're recorded)."""
import pytest

import app.internal.auth as auth
from app.models.users import User


PROTECTED_ROUTES = [
    ("GET", "/auth/me"),
    ("GET", "/users/"),
    ("GET", "/servers/"),
    ("GET", "/servers/games"),
    ("GET", "/servers/mc1"),
    ("DELETE", "/servers/mc1"),
    ("POST", "/servers/create"),
    ("POST", "/servers/mc1"),
    ("GET", "/servers/mc1/settings"),
    ("PUT", "/servers/mc1/settings"),
    ("GET", "/servers/mc1/activity"),
    ("GET", "/servers/mc1/shares"),
    ("PUT", "/servers/mc1/shares"),
    ("GET", "/job/job-1"),
    ("GET", "/sys/info"),
    ("GET", "/sys/ip"),
    ("GET", "/sys/"),
]


class TestEveryRouteNeedsASession:
    @pytest.mark.parametrize("method, path", PROTECTED_ROUTES)
    def test_without_a_token(self, client, method, path):
        response = client.request(method, path, json={})
        assert response.status_code == 401
        assert response.json()["detail"] == "Not signed in"
        assert response.headers["www-authenticate"] == "Bearer"

    @pytest.mark.parametrize("method, path", PROTECTED_ROUTES)
    def test_with_an_invalid_token(self, client, method, path):
        response = client.request(method, path, json={}, headers={"Authorization": "Bearer forged"})
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid or expired session"

    def test_every_http_route_is_covered(self, app):
        """Fails when a route is added without being listed above (so its auth gets tested)."""
        routes = {
            (method.upper(), path)
            for path, operations in app.openapi()["paths"].items()
            for method in operations
        }
        listed = {(m, p.replace("mc1", "{server_id}").replace("job-1", "{job_id}")) for m, p in PROTECTED_ROUTES}
        assert routes == listed


class TestAuthDependency:
    def test_non_bearer_scheme(self, client, alice):
        response = client.get("/auth/me", headers={"Authorization": f"Basic {alice.token}"})
        assert response.status_code == 401

    def test_token_in_query_string_is_ignored(self, client, alice):
        assert client.get(f"/auth/me?token={alice.token}").status_code == 401

    def test_not_configured(self, client, alice, monkeypatch):
        monkeypatch.setattr(auth, "FIREBASE_PROJECT_ID", "")
        response = client.get("/auth/me", headers=alice.headers)
        assert response.status_code == 503
        assert "www-authenticate" not in response.headers

    def test_allowlist(self, client, alice, bob, monkeypatch):
        monkeypatch.setattr(auth, "ALLOWED_EMAILS", {"alice@example.com"})
        assert client.get("/auth/me", headers=alice.headers).status_code == 200
        response = client.get("/auth/me", headers=bob.headers)
        assert response.status_code == 403
        assert response.json()["detail"] == "This account is not allowed to access PlayHub"
        assert "www-authenticate" not in response.headers

    def test_rejected_users_are_not_recorded(self, client, bob, db, monkeypatch):
        monkeypatch.setattr(auth, "ALLOWED_EMAILS", {"alice@example.com"})
        client.get("/auth/me", headers=bob.headers)
        assert db.get(User, bob.uid) is None

    def test_tokens_are_verified_once_then_cached(self, client, alice, tokens):
        for _ in range(3):
            assert client.get("/auth/me", headers=alice.headers).status_code == 200
        assert tokens.calls == 1


class TestMe:
    def test_returns_the_signed_in_user(self, client, make_user):
        person = make_user("uid-x", name="Xavier", email="x@example.com", picture="https://example.com/x.png")
        response = client.get("/auth/me", headers=person.headers)
        assert response.status_code == 200
        assert response.json() == {"msg": {
            "uid": "uid-x", "email": "x@example.com", "name": "Xavier", "picture": "https://example.com/x.png",
        }}

    def test_signing_in_adds_the_user_to_the_directory(self, client, alice, db):
        client.get("/auth/me", headers=alice.headers)
        row = db.get(User, alice.uid)
        assert (row.email, row.name) == ("alice@example.com", "Alice")
        assert row.created is not None and row.last_seen is not None


class TestUserDirectory:
    def test_lists_everyone_else_who_has_signed_in(self, client, alice, bob, carol):
        for person in (bob, carol, alice):
            client.get("/auth/me", headers=person.headers)
        response = client.get("/users/", headers=alice.headers)
        assert response.status_code == 200
        assert [u["uid"] for u in response.json()["msg"]] == [bob.uid, carol.uid]
        assert response.json()["msg"][0] == {
            "uid": bob.uid, "name": "Bob", "email": "bob@example.com", "picture": None,
        }

    def test_people_who_never_signed_in_are_not_listed(self, client, alice, bob):
        client.get("/auth/me", headers=alice.headers)
        assert client.get("/users/", headers=alice.headers).json()["msg"] == []

    def test_sorted_by_name_then_email(self, client, alice, make_user):
        people = [
            make_user("u1", name="Zed", email="z@example.com"),
            make_user("u2", name="Amy", email="b@example.com"),
            make_user("u3", name="Amy", email="a@example.com"),
        ]
        for person in people:
            client.get("/auth/me", headers=person.headers)
        listed = client.get("/users/", headers=alice.headers).json()["msg"]
        assert [u["uid"] for u in listed] == ["u3", "u2", "u1"]

    def test_any_request_records_the_user_not_just_me(self, client, alice, bob):
        client.get("/servers/", headers=bob.headers)
        assert [u["uid"] for u in client.get("/users/", headers=alice.headers).json()["msg"]] == [bob.uid]
