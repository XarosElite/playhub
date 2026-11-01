"""Sharing a server with other users (/servers/{id}/shares) and what shared users can do."""
import pytest

from app.models.servers import Server, ServerEvent, ServerShare


@pytest.fixture
def signed_in(client, alice, bob, carol):
    """Everyone has signed in once, so they're in the user directory."""
    for person in (alice, bob, carol):
        client.get("/auth/me", headers=person.headers)


def share(client, owner, *people, server="mc1"):
    return client.put(f"/servers/{server}/shares", headers=owner.headers,
                      json={"user_ids": [p.uid if hasattr(p, "uid") else p for p in people]})


def names(response):
    return [u["name"] for u in response.json()["msg"]]


class TestSetShares:
    def test_share_with_someone(self, client, alice, bob, running_server, signed_in, db):
        response = share(client, alice, bob)
        assert response.status_code == 200
        assert response.json() == {"msg": [{"uid": bob.uid, "name": "Bob", "email": "bob@example.com", "picture": None}]}
        row = db.query(ServerShare).one()
        assert (row.user_uid, row.granted_by) == (bob.uid, alice.uid)
        assert row.created is not None

    def test_replaces_the_whole_set(self, client, alice, bob, carol, running_server, signed_in):
        share(client, alice, bob)
        response = share(client, alice, carol)
        assert names(response) == ["Carol"]
        assert names(client.get("/servers/mc1/shares", headers=alice.headers)) == ["Carol"]

    def test_unshare_everyone(self, client, alice, bob, running_server, signed_in, db):
        share(client, alice, bob)
        response = share(client, alice)
        assert response.json() == {"msg": []}
        assert db.query(ServerShare).count() == 0

    def test_duplicates_are_ignored(self, client, alice, bob, running_server, signed_in, db):
        assert names(share(client, alice, bob, bob)) == ["Bob"]
        assert db.query(ServerShare).count() == 1

    def test_sorted_by_name(self, client, alice, bob, carol, running_server, signed_in):
        assert names(share(client, alice, carol, bob)) == ["Bob", "Carol"]

    def test_records_who_was_added_and_removed(self, client, alice, bob, carol, running_server, signed_in, db):
        share(client, alice, bob, carol)
        share(client, alice, carol)
        actions = [(e.action, e.actor_uid, e.detail) for e in db.query(ServerEvent).order_by(ServerEvent.id)][1:]
        assert actions == [
            ("shared", alice.uid, "Bob, Carol"),
            ("unshared", alice.uid, "Bob"),
        ]

    def test_adding_and_removing_at_once(self, client, alice, bob, carol, running_server, signed_in, db):
        share(client, alice, bob)
        share(client, alice, carol)
        actions = [(e.action, e.detail) for e in db.query(ServerEvent).order_by(ServerEvent.id)][-2:]
        assert actions == [("shared", "Carol"), ("unshared", "Bob")]

    def test_no_change_records_nothing(self, client, alice, bob, running_server, signed_in, db):
        share(client, alice, bob)
        count = db.query(ServerEvent).count()
        share(client, alice, bob)
        assert db.query(ServerEvent).count() == count

    def test_event_falls_back_to_email_then_uid(self, client, alice, make_user, running_server, db):
        client.get("/auth/me", headers=alice.headers)
        nameless = make_user("uid-nameless", name=None, email="nameless@example.com")
        client.get("/auth/me", headers=nameless.headers)
        share(client, alice, nameless)
        assert db.query(ServerEvent).order_by(ServerEvent.id.desc()).first().detail == "nameless@example.com"

    def test_cannot_share_with_yourself(self, client, alice, bob, running_server, signed_in, db):
        response = share(client, alice, alice, bob)
        assert response.status_code == 400
        assert response.json()["detail"] == "You can't share a server with yourself"
        assert db.query(ServerShare).count() == 0

    def test_unknown_users(self, client, alice, bob, running_server, signed_in, db):
        response = share(client, alice, bob, "uid-nobody", "uid-ghost")
        assert response.status_code == 400
        assert response.json()["detail"] == "Unknown user(s): uid-ghost, uid-nobody"
        assert db.query(ServerShare).count() == 0  # nothing partially applied

    def test_users_must_have_signed_in(self, client, alice, bob, running_server):
        client.get("/auth/me", headers=alice.headers)
        assert share(client, alice, bob).status_code == 400

    @pytest.mark.parametrize("body", [{}, {"user_ids": "uid-bob"}, {"user_ids": [1, 2]}, {"users": []}])
    def test_malformed_body(self, client, alice, running_server, signed_in, body):
        assert client.put("/servers/mc1/shares", headers=alice.headers, json=body).status_code == 422

    def test_only_the_owner(self, client, alice, bob, carol, running_server, signed_in):
        share(client, alice, bob)
        response = share(client, bob, bob, carol)
        assert response.status_code == 403
        assert response.json()["detail"] == "Only the server's owner can manage sharing"
        assert client.get("/servers/mc1/shares", headers=bob.headers).status_code == 403
        assert share(client, carol, carol).status_code == 404
        assert client.get("/servers/mc1/shares", headers=carol.headers).status_code == 404


class TestSharedAccess:
    def test_appears_on_the_shared_users_dashboard(self, client, alice, bob, carol, running_server, signed_in):
        share(client, alice, bob)
        [server] = client.get("/servers/", headers=bob.headers).json()["msg"]
        assert server["Name"] == "mc1"
        assert server["IsOwner"] is False
        assert server["Owner"] == {"uid": alice.uid, "name": "Alice", "email": "alice@example.com", "picture": None}
        assert server["SharedWith"] is None  # who else has access is the owner's business
        assert client.get("/servers/", headers=carol.headers).json()["msg"] == []

    def test_owner_sees_who_it_is_shared_with(self, client, alice, bob, carol, running_server, signed_in):
        share(client, alice, bob, carol)
        [server] = client.get("/servers/", headers=alice.headers).json()["msg"]
        assert [u["uid"] for u in server["SharedWith"]] == [bob.uid, carol.uid]

    def test_mixed_dashboard(self, client, alice, bob, signed_in, create_server, set_state):
        create_server(alice, "alices")
        create_server(bob, "bobs")
        share(client, alice, bob, server="alices")
        listed = client.get("/servers/", headers=bob.headers).json()["msg"]
        assert [(s["Name"], s["IsOwner"]) for s in listed] == [("alices", False), ("bobs", True)]

    def test_unsharing_removes_access(self, client, alice, bob, running_server, signed_in):
        share(client, alice, bob)
        share(client, alice)
        assert client.get("/servers/", headers=bob.headers).json()["msg"] == []
        assert client.get("/servers/mc1", headers=bob.headers).status_code == 404
        assert client.post("/servers/mc1", headers=bob.headers, json={"Action": 2}).status_code == 404

    def test_shared_user_sees_activity(self, client, alice, bob, running_server, signed_in):
        share(client, alice, bob)
        assert client.get("/servers/mc1/activity", headers=bob.headers).status_code == 200

    def test_sharing_one_server_does_not_share_others(self, client, alice, bob, signed_in, create_server):
        create_server(alice, "shared")
        create_server(alice, "private")
        share(client, alice, bob, server="shared")
        assert client.get("/servers/private", headers=bob.headers).status_code == 404

    def test_shares_go_with_the_server(self, client, alice, bob, running_server, signed_in, db):
        share(client, alice, bob)
        client.delete("/servers/mc1", headers=alice.headers)
        assert client.get("/servers/", headers=bob.headers).json()["msg"] == []

    def test_hard_deleting_a_server_cascades(self, client, alice, bob, running_server, signed_in, db):
        share(client, alice, bob)
        db.query(Server).filter_by(name="mc1").delete()
        db.commit()
        assert db.query(ServerShare).count() == 0
        assert db.query(ServerEvent).count() == 0
