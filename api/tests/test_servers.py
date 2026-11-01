"""The /servers REST API: listing, creating, actions, deleting, settings and activity."""
import datetime

import pytest

import app.depenencies as deps
import app.internal.live as live
from app.models.servers import Server, ServerEvent


def events(db, name=None):
    query = db.query(ServerEvent).order_by(ServerEvent.id)
    if name:
        query = query.join(Server, Server.id == ServerEvent.server_id).filter(Server.name == name)
    return [(e.action, e.actor_uid, e.detail) for e in query]


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------
class TestList:
    def test_empty(self, client, alice):
        assert client.get("/servers/", headers=alice.headers).json() == {"msg": []}

    def test_serialisation(self, client, alice, create_server):
        client.get("/auth/me", headers=alice.headers)
        create_server(alice, "mc1")
        [server] = client.get("/servers/", headers=alice.headers).json()["msg"]
        created = server.pop("Created")
        assert datetime.datetime.fromisoformat(created)
        assert server == {
            "GameType": "minecraft",
            "ID": "mc1",  # no container yet: the name stands in
            "Image": "itzg/minecraft-server",
            "Name": "mc1",
            "State": "starting",
            "StatusMessage": None,
            "Ports": {"primary_port": 10000},
            "Protocol": "tcp",
            "SupportsPlayers": True,
            "Live": None,
            "IsOwner": True,
            "Owner": {"uid": alice.uid, "name": "Alice", "email": "alice@example.com", "picture": None},
            "SharedWith": [],
        }

    def test_id_becomes_the_container_id_once_it_exists(self, client, alice, running_server):
        [server] = client.get("/servers/", headers=alice.headers).json()["msg"]
        assert server["ID"] == "cid-mc1"

    def test_palworld_reports_udp_and_no_player_counts(self, client, alice, create_server):
        create_server(alice, "pal1", game_type="palworld")
        [server] = client.get("/servers/", headers=alice.headers).json()["msg"]
        assert (server["Protocol"], server["SupportsPlayers"]) == ("udp", False)

    def test_only_your_own_servers(self, client, alice, bob, create_server):
        create_server(alice, "alices")
        create_server(bob, "bobs")
        assert [s["Name"] for s in client.get("/servers/", headers=alice.headers).json()["msg"]] == ["alices"]
        assert [s["Name"] for s in client.get("/servers/", headers=bob.headers).json()["msg"]] == ["bobs"]

    def test_ordered_by_creation(self, client, alice, create_server):
        for name in ("zeta", "alpha", "mid"):
            create_server(alice, name)
        assert [s["Name"] for s in client.get("/servers/", headers=alice.headers).json()["msg"]] == ["zeta", "alpha", "mid"]

    def test_deleted_servers_are_hidden(self, client, alice, create_server):
        create_server(alice, "keep")
        create_server(alice, "gone")
        client.delete("/servers/gone", headers=alice.headers)
        assert [s["Name"] for s in client.get("/servers/", headers=alice.headers).json()["msg"]] == ["keep"]

    def test_owner_profile_unknown_until_they_sign_in(self, client, alice, bob, db, create_server):
        # A server whose owner isn't in the user directory (e.g. created before it existed).
        db.add(Server(name="legacy", game_type="minecraft", state="exited", port=10050, owner_id="uid-ghost"))
        db.commit()
        client.get("/auth/me", headers=bob.headers)
        from app.models.servers import ServerShare
        db.add(ServerShare(server_id=db.query(Server).filter_by(name="legacy").one().id, user_uid=bob.uid, granted_by="uid-ghost"))
        db.commit()
        [server] = client.get("/servers/", headers=bob.headers).json()["msg"]
        assert server["Owner"] == {"uid": "uid-ghost", "name": None, "email": None, "picture": None}
        assert server["IsOwner"] is False
        assert server["SharedWith"] is None

    def test_game_removed_from_catalog(self, client, alice, db):
        db.add(Server(name="old", game_type="terraria", state="exited", port=10070, owner_id=alice.uid))
        db.commit()
        [server] = client.get("/servers/", headers=alice.headers).json()["msg"]
        assert (server["Image"], server["Protocol"], server["SupportsPlayers"]) == ("unknown", "tcp", False)


    def test_live_stats_are_attached(self, client, alice, running_server, get_server_row):
        server_id = get_server_row("mc1").id
        with live._lock:
            live._live[server_id] = {"cpu_pct": 12.5, "players": {"online": 2, "max": 20, "version": "1.21"}}
            live._history[server_id] = [{"time": "t", "cpu_pct": 12.5, "mem_used_mb": 500}]
        [server] = client.get("/servers/", headers=alice.headers).json()["msg"]
        assert server["Live"] == {
            "cpu_pct": 12.5, "players": {"online": 2, "max": 20, "version": "1.21"},
            "history": [{"time": "t", "cpu_pct": 12.5, "mem_used_mb": 500}],
        }


class TestGet:
    def test_by_name_container_id_or_database_id(self, client, alice, running_server, get_server_row):
        db_id = get_server_row("mc1").id
        for key in ("mc1", "cid-mc1", str(db_id)):
            response = client.get(f"/servers/{key}", headers=alice.headers)
            assert response.status_code == 200, key
            assert response.json()["msg"]["Name"] == "mc1"

    def test_someone_elses_server_is_not_found(self, client, alice, bob, running_server):
        response = client.get("/servers/mc1", headers=bob.headers)
        assert response.status_code == 404
        assert response.json()["detail"] == "Server mc1 not found"

    def test_deleted_server_is_not_found(self, client, alice, create_server):
        create_server(alice, "mc1")
        client.delete("/servers/mc1", headers=alice.headers)
        assert client.get("/servers/mc1", headers=alice.headers).status_code == 404

    def test_unknown(self, client, alice):
        assert client.get("/servers/nope", headers=alice.headers).status_code == 404


class TestGames:
    def test_lists_the_public_catalog(self, client, alice):
        games = client.get("/servers/games", headers=alice.headers).json()["msg"]
        assert [g["game_type"] for g in games] == ["minecraft", "palworld"]
        pal = games[1]
        assert pal["protocol"] == "udp"
        assert pal["common_fields"]["MAX_PLAYERS"]["default"] == 32
        assert "env" not in pal["common_fields"]["MAX_PLAYERS"]


# ---------------------------------------------------------------------------
# Creating
# ---------------------------------------------------------------------------
class TestCreate:
    def test_saves_the_server_then_queues_the_container(self, client, alice, queue, db, create_server):
        response = create_server(alice, "mc1", environment={"MAX_PLAYERS": 10, "MODE": "creative", "SEED": "42"})
        assert response.status_code == 201
        job = queue.last
        assert response.json() == {"msg": {"job_id": job.id}}
        assert job.func == "tasks.dockerjobs.create_server"
        name, env, ports, image, data_path = job.args
        assert name == "mc1"
        assert env == {
            "MAX_PLAYERS": "10", "EULA": "true", "MODE": "creative", "PVP": "true", "HARDCORE": "false",
            "ENABLE_COMMAND_BLOCK": "false", "SEED": "42", "WORLD_TYPE": "normal",
        }
        assert ports == {"25565/tcp": "10000"}
        assert (image, data_path) == ("itzg/minecraft-server", "/data")
        assert job.meta == {"owner_id": alice.uid}

        server = db.query(Server).filter_by(name="mc1").one()
        assert (server.state, server.owner_id, server.port, server.container_id) == ("starting", alice.uid, 10000, "")
        assert server.config["MAX_PLAYERS"] == 10 and server.config["MODE"] == "creative"
        assert events(db) == [("created", alice.uid, None)]

    def test_palworld_maps_its_udp_port_and_env_names(self, client, alice, queue, create_server):
        create_server(alice, "pal1", game_type="palworld", environment={"MAX_PLAYERS": 16, "SERVER_NAME": "Pals"})
        name, env, ports, image, data_path = queue.last.args
        assert ports == {"8211/udp": "10000"}
        assert env["PLAYERS"] == "16" and "MAX_PLAYERS" not in env
        assert env["SERVER_NAME"] == "Pals"
        assert (image, data_path) == ("thijsvanloef/palworld-server-docker:latest", "/palworld")

    def test_ports_are_allocated_in_order(self, client, alice, bob, queue, create_server):
        create_server(alice, "aaa")
        create_server(bob, "bbb")
        create_server(alice, "ccc")
        assert [job.args[2] for job in queue.jobs.values()] == [
            {"25565/tcp": "10000"}, {"25565/tcp": "10001"}, {"25565/tcp": "10002"},
        ]

    def test_ports_in_use_on_the_host_are_skipped(self, client, alice, queue, create_server, monkeypatch):
        monkeypatch.setattr(deps, "is_port_available_on_host", lambda port: port not in (10000, 10001))
        create_server(alice, "aaa")
        assert queue.last.args[2] == {"25565/tcp": "10002"}

    def test_no_ports_left(self, client, alice, queue, create_server, monkeypatch, db):
        monkeypatch.setattr(deps, "is_port_available_on_host", lambda port: False)
        response = create_server(alice, "aaa", expect=507)
        assert response.json()["detail"] == "No available server ports in the range 10000-10250"
        assert queue.jobs == {}
        assert db.query(Server).count() == 0

    def test_name_is_trimmed(self, client, alice, queue, create_server):
        create_server(alice, "  spaced  ")
        assert queue.last.args[0] == "spaced"

    def test_duplicate_name(self, client, alice, bob, queue, create_server):
        create_server(alice, "mc1")
        response = create_server(bob, "mc1", expect=409)
        assert response.json()["detail"] == "The name 'mc1' is already taken"
        assert len(queue.jobs) == 1

    def test_name_of_a_deleted_server_can_be_reused(self, client, alice, queue, create_server, db):
        create_server(alice, "mc1")
        client.delete("/servers/mc1", headers=alice.headers)
        create_server(alice, "mc1")
        assert [s["Name"] for s in client.get("/servers/", headers=alice.headers).json()["msg"]] == ["mc1"]

    def test_port_of_a_deleted_server_can_be_reused(self, client, alice, queue, create_server):
        create_server(alice, "first")
        client.delete("/servers/first", headers=alice.headers)
        create_server(alice, "second")
        [server] = client.get("/servers/", headers=alice.headers).json()["msg"]
        assert server["Name"] == "second"
        assert server["Ports"]["primary_port"] == 10000

    def test_deleted_server_keeps_its_history(self, client, alice, create_server, db):
        create_server(alice, "mc1")
        client.delete("/servers/mc1", headers=alice.headers)
        create_server(alice, "mc1")
        deleted = db.query(Server).filter(Server.state == "deleted").one()
        assert [e.action for e in db.query(ServerEvent).filter_by(server_id=deleted.id)] == ["created", "deleted"]

    @pytest.mark.parametrize("name, message", [
        ("", "Server 'name' is required"),
        ("   ", "Server 'name' is required"),
        ("ab", "Must be between 3 and 36 characters"),
        ("a" * 37, "Must be between 3 and 36 characters"),
        ("-mc", "Cannot start or end with"),
        ("mc.", "Cannot start or end with"),
        ("my..server", "Cannot contain sequential symbols"),
        ("my server", "Can only contain letters, numbers"),
        ("../../etc", "Cannot start or end with"),
        ("mc/1", "Can only contain letters, numbers"),
        ("mc1;rm", "Can only contain letters, numbers"),
        ("sérver", "Can only contain letters, numbers"),
    ])
    def test_invalid_names(self, client, alice, queue, name, message):
        response = client.post("/servers/create", headers=alice.headers,
                               json={"name": name, "game_type": "minecraft", "environment": {}})
        assert response.status_code == 422
        assert message in response.json()["detail"]
        assert queue.jobs == {}

    @pytest.mark.parametrize("name", ["mc1", "My-Server_2.0", "a" * 36, "abc"])
    def test_valid_names(self, client, alice, create_server, name):
        create_server(alice, name)

    def test_name_must_be_a_string(self, client, alice):
        response = client.post("/servers/create", headers=alice.headers,
                               json={"name": 123, "game_type": "minecraft", "environment": {}})
        assert response.status_code == 422

    @pytest.mark.parametrize("game_type", [None, "terraria", 5, ""])
    def test_unsupported_game(self, client, alice, queue, game_type):
        response = client.post("/servers/create", headers=alice.headers,
                               json={"name": "mc1", "game_type": game_type, "environment": {}})
        assert response.status_code == 400
        assert "Unsupported or missing game_type" in response.json()["detail"]
        assert queue.jobs == {}

    def test_body_must_be_json(self, client, alice):
        response = client.post("/servers/create", headers={**alice.headers, "Content-Type": "application/json"},
                               content=b"not json")
        assert response.status_code == 400
        assert response.json()["detail"] == "Request body must be JSON"

    def test_body_must_be_an_object(self, client, alice):
        response = client.post("/servers/create", headers=alice.headers, json=["minecraft"])
        assert response.status_code == 400
        assert response.json()["detail"] == "Request body must be an object"

    def test_invalid_settings_are_reported_per_field(self, client, alice, queue, db):
        response = client.post("/servers/create", headers=alice.headers, json={
            "name": "mc1", "game_type": "minecraft",
            "environment": {"MAX_PLAYERS": 500, "MODE": "god", "NOT_A_FIELD": 1},
        })
        assert response.status_code == 422
        assert response.json()["detail"] == {"msg": "Invalid server settings", "fields": {
            "MAX_PLAYERS": "Must be at most 100",
            "MODE": "Must be one of: survival, creative, adventure, spectator",
            "NOT_A_FIELD": "Unknown setting",
        }}
        assert queue.jobs == {}
        assert db.query(Server).count() == 0

    def test_environment_may_be_omitted(self, client, alice, queue):
        response = client.post("/servers/create", headers=alice.headers, json={"name": "mc1", "game_type": "minecraft"})
        assert response.status_code == 201
        assert queue.last.args[1]["EULA"] == "true"


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------
class TestActions:
    @pytest.mark.parametrize("action, job, state, event", [
        (1, "tasks.dockerjobs.start_server", "starting", "started"),
        (2, "tasks.dockerjobs.stop_server", "stopping", "stopped"),
        (3, "tasks.dockerjobs.restart_server", "restarting", "restarted"),
    ])
    def test_action_queues_a_job_and_shows_progress(self, client, alice, running_server, queue, db,
                                                     get_server_row, set_state, action, job, state, event):
        set_state("mc1", "running", status_message="Stopped unexpectedly (exit code 1)")
        response = client.post(f"/servers/{running_server}", headers=alice.headers, json={"Action": action})
        assert response.status_code == 200
        assert response.json() == {"msg": {"job_id": queue.last.id}}
        assert queue.last.func == job
        assert queue.last.args == ("mc1",)
        assert queue.last.meta == {"owner_id": alice.uid}
        row = get_server_row("mc1")
        assert (row.state, row.status_message) == (state, None)
        assert events(db)[-1] == (event, alice.uid, None)

    @pytest.mark.parametrize("busy", ["starting", "stopping", "restarting", "updating"])
    def test_busy_servers_reject_actions(self, client, alice, running_server, queue, set_state, busy):
        set_state("mc1", busy)
        jobs_before = len(queue.jobs)
        response = client.post("/servers/mc1", headers=alice.headers, json={"Action": 1})
        assert response.status_code == 409
        assert response.json()["detail"] == f"mc1 is busy ({busy}). Try again in a moment."
        assert len(queue.jobs) == jobs_before

    @pytest.mark.parametrize("settled", ["running", "exited", "failed"])
    def test_settled_servers_accept_actions(self, client, alice, running_server, set_state, settled):
        set_state("mc1", settled)
        assert client.post("/servers/mc1", headers=alice.headers, json={"Action": 1}).status_code == 200

    @pytest.mark.parametrize("body", [{"Action": 7}, {"Action": "start"}, {}, {"action": 1}])
    def test_invalid_action(self, client, alice, running_server, body):
        response = client.post("/servers/mc1", headers=alice.headers, json=body)
        assert response.status_code == 400
        assert response.json()["detail"].startswith("Invalid Action")

    def test_body_is_required(self, client, alice, running_server):
        assert client.post("/servers/mc1", headers=alice.headers).status_code == 422

    def test_stranger_cannot_act(self, client, bob, running_server, queue):
        jobs_before = len(queue.jobs)
        assert client.post("/servers/mc1", headers=bob.headers, json={"Action": 2}).status_code == 404
        assert len(queue.jobs) == jobs_before

    def test_shared_user_can_start_stop_and_restart(self, client, alice, bob, running_server, queue, set_state, db):
        client.get("/auth/me", headers=bob.headers)
        client.put("/servers/mc1/shares", headers=alice.headers, json={"user_ids": [bob.uid]})
        response = client.post("/servers/mc1", headers=bob.headers, json={"Action": 2})
        assert response.status_code == 200
        assert queue.last.meta == {"owner_id": bob.uid}  # bob polls his own job
        assert events(db)[-1] == ("stopped", bob.uid, None)

    def test_delete_action_is_owner_only(self, client, alice, bob, running_server, queue, get_server_row):
        client.get("/auth/me", headers=bob.headers)
        client.put("/servers/mc1/shares", headers=alice.headers, json={"user_ids": [bob.uid]})
        response = client.post("/servers/mc1", headers=bob.headers, json={"Action": 100})
        assert response.status_code == 403
        assert response.json()["detail"] == "Only the server's owner can delete it"
        assert get_server_row("mc1").state == "running"

        response = client.post("/servers/mc1", headers=alice.headers, json={"Action": 100})
        assert response.status_code == 200
        assert queue.last.func == "tasks.dockerjobs.delete_server"


# ---------------------------------------------------------------------------
# Deleting
# ---------------------------------------------------------------------------
class TestDelete:
    def test_marks_deleted_and_queues_removal(self, client, alice, running_server, queue, db):
        response = client.delete(f"/servers/{running_server}", headers=alice.headers)
        assert response.status_code == 200
        assert response.json() == {"msg": {"job_id": queue.last.id}}
        assert queue.last.func == "tasks.dockerjobs.delete_server"
        assert queue.last.args == ("mc1",)  # the worker finds the container by its original name
        server = db.query(Server).filter(Server.state == "deleted").one()
        assert server.status_message is None
        assert events(db)[-1][:2] == ("deleted", alice.uid)

    def test_releases_the_name_and_port(self, client, alice, running_server, db):
        client.delete("/servers/mc1", headers=alice.headers)
        server = db.query(Server).filter(Server.state == "deleted").one()
        assert server.name != "mc1"
        assert server.port is None

    def test_can_delete_a_busy_server(self, client, alice, create_server, queue):
        # e.g. one stuck starting
        create_server(alice, "mc1")
        assert client.delete("/servers/mc1", headers=alice.headers).status_code == 200

    def test_shared_user_cannot_delete(self, client, alice, bob, running_server, get_server_row):
        client.get("/auth/me", headers=bob.headers)
        client.put("/servers/mc1/shares", headers=alice.headers, json={"user_ids": [bob.uid]})
        response = client.delete("/servers/mc1", headers=bob.headers)
        assert response.status_code == 403
        assert response.json()["detail"] == "Only the server's owner can delete it"
        assert get_server_row("mc1").state == "running"

    def test_stranger_cannot_delete(self, client, bob, running_server):
        assert client.delete("/servers/mc1", headers=bob.headers).status_code == 404

    def test_twice(self, client, alice, running_server):
        assert client.delete("/servers/mc1", headers=alice.headers).status_code == 200
        assert client.delete("/servers/mc1", headers=alice.headers).status_code == 404
        assert client.delete("/servers/cid-mc1", headers=alice.headers).status_code == 404

    def test_deleted_server_disappears_for_shared_users(self, client, alice, bob, running_server):
        client.get("/auth/me", headers=bob.headers)
        client.put("/servers/mc1/shares", headers=alice.headers, json={"user_ids": [bob.uid]})
        client.delete("/servers/mc1", headers=alice.headers)
        assert client.get("/servers/", headers=bob.headers).json()["msg"] == []


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
class TestSettings:
    def current(self, client, person, server="mc1"):
        return client.get(f"/servers/{server}/settings", headers=person.headers).json()["msg"]["environment"]

    def test_get(self, client, alice, running_server):
        response = client.get("/servers/mc1/settings", headers=alice.headers)
        assert response.status_code == 200
        body = response.json()["msg"]
        assert body["game_type"] == "minecraft"
        assert body["environment"]["MAX_PLAYERS"] == 20
        assert body["environment"]["EULA"] is True

    def test_get_for_a_server_without_saved_settings(self, client, alice, db):
        db.add(Server(name="legacy", game_type="minecraft", state="running", port=10010, owner_id=alice.uid, config=None))
        db.commit()
        assert self.current(client, alice, "legacy") == {}

    def test_change_recreates_the_container(self, client, alice, running_server, queue, db, get_server_row):
        env = {**self.current(client, alice), "MAX_PLAYERS": 40, "MODE": "creative"}
        response = client.put("/servers/mc1/settings", headers=alice.headers, json={"environment": env})
        assert response.status_code == 200
        assert response.json() == {"msg": {"job_id": queue.last.id, "changed": ["Game Mode", "Max Players"]}}

        job = queue.last
        assert job.func == "tasks.dockerjobs.recreate_server"
        name, container_env, ports, image, data_path = job.args
        assert name == "mc1"
        assert container_env["MAX_PLAYERS"] == "40" and container_env["MODE"] == "creative"
        assert ports == {"25565/tcp": "10000"}  # keeps its port
        assert (image, data_path) == ("itzg/minecraft-server", "/data")

        row = get_server_row("mc1")
        assert row.state == "updating"
        assert row.config["MAX_PLAYERS"] == 40
        assert events(db)[-1] == ("settings_updated", alice.uid, "Game Mode, Max Players")

    def test_unchanged_settings_do_nothing(self, client, alice, running_server, queue, get_server_row):
        jobs_before = len(queue.jobs)
        response = client.put("/servers/mc1/settings", headers=alice.headers,
                              json={"environment": self.current(client, alice)})
        assert response.json() == {"msg": {"job_id": None, "changed": []}}
        assert len(queue.jobs) == jobs_before
        assert get_server_row("mc1").state == "running"

    def test_equivalent_values_are_not_changes(self, client, alice, running_server, queue):
        # "20" and 20, "true" and True normalise to the saved values.
        env = {**self.current(client, alice), "MAX_PLAYERS": "20", "PVP": "true"}
        response = client.put("/servers/mc1/settings", headers=alice.headers, json={"environment": env})
        assert response.json()["msg"]["changed"] == []

    def test_clearing_a_setting_is_a_change(self, client, alice, running_server, create_server, set_state, queue):
        create_server(alice, "seeded", environment={"SEED": "12345"})
        set_state("seeded", "running")
        env = {**self.current(client, alice, "seeded"), "SEED": ""}
        response = client.put("/servers/seeded/settings", headers=alice.headers, json={"environment": env})
        assert response.json()["msg"]["changed"] == ["World Seed"]
        assert "SEED" not in queue.last.args[1]

    def test_invalid_settings(self, client, alice, running_server, queue, get_server_row):
        jobs_before = len(queue.jobs)
        response = client.put("/servers/mc1/settings", headers=alice.headers,
                              json={"environment": {"MAX_PLAYERS": 0}})
        assert response.status_code == 422
        assert response.json()["detail"] == {"msg": "Invalid server settings", "fields": {"MAX_PLAYERS": "Must be at least 1"}}
        assert len(queue.jobs) == jobs_before
        assert get_server_row("mc1").config["MAX_PLAYERS"] == 20

    @pytest.mark.parametrize("body", [{}, {"environment": "x"}, {"environment": [1]}, {"env": {}}])
    def test_malformed_body(self, client, alice, running_server, body):
        assert client.put("/servers/mc1/settings", headers=alice.headers, json=body).status_code == 422

    def test_busy(self, client, alice, running_server, set_state):
        set_state("mc1", "updating")
        response = client.put("/servers/mc1/settings", headers=alice.headers, json={"environment": {"MAX_PLAYERS": 5}})
        assert response.status_code == 409

    def test_game_no_longer_in_catalog(self, client, alice, db):
        db.add(Server(name="old", game_type="terraria", state="running", port=10070, owner_id=alice.uid, config={}))
        db.commit()
        response = client.put("/servers/old/settings", headers=alice.headers, json={"environment": {}})
        assert response.status_code == 400
        assert response.json()["detail"] == "Unsupported game_type: terraria"

    def test_shared_user_can_view_and_change(self, client, alice, bob, running_server, queue, db):
        client.get("/auth/me", headers=bob.headers)
        client.put("/servers/mc1/shares", headers=alice.headers, json={"user_ids": [bob.uid]})
        env = {**self.current(client, bob), "PVP": False}
        response = client.put("/servers/mc1/settings", headers=bob.headers, json={"environment": env})
        assert response.status_code == 200
        assert response.json()["msg"]["changed"] == ["PvP"]
        assert events(db)[-1] == ("settings_updated", bob.uid, "PvP")

    def test_stranger(self, client, bob, running_server):
        assert client.get("/servers/mc1/settings", headers=bob.headers).status_code == 404
        assert client.put("/servers/mc1/settings", headers=bob.headers, json={"environment": {}}).status_code == 404

    def test_palworld_settings_keep_the_udp_port_and_env_mapping(self, client, alice, create_server, set_state, queue):
        create_server(alice, "pal1", game_type="palworld")
        set_state("pal1", "running")
        env = {**self.current(client, alice, "pal1"), "MAX_PLAYERS": 8}
        client.put("/servers/pal1/settings", headers=alice.headers, json={"environment": env})
        assert queue.last.args[2] == {"8211/udp": "10000"}
        assert queue.last.args[1]["PLAYERS"] == "8"


# ---------------------------------------------------------------------------
# Activity
# ---------------------------------------------------------------------------
class TestActivity:
    def test_newest_first_with_actors(self, client, alice, bob, running_server):
        client.get("/auth/me", headers=alice.headers)
        client.get("/auth/me", headers=bob.headers)
        client.put("/servers/mc1/shares", headers=alice.headers, json={"user_ids": [bob.uid]})
        client.post("/servers/mc1", headers=bob.headers, json={"Action": 2})
        response = client.get("/servers/mc1/activity", headers=bob.headers)
        assert response.status_code == 200
        entries = response.json()["msg"]
        assert [(e["action"], e["actor"]["uid"], e["detail"]) for e in entries] == [
            ("stopped", bob.uid, None),
            ("shared", alice.uid, "Bob"),
            ("created", alice.uid, None),
        ]
        assert entries[0]["actor"] == {"uid": bob.uid, "name": "Bob", "email": "bob@example.com", "picture": None}
        assert all(datetime.datetime.fromisoformat(e["created"]) for e in entries)
        assert entries[0]["id"] > entries[1]["id"]

    def test_system_events_have_no_actor(self, client, alice, running_server, db, get_server_row):
        db.add(ServerEvent(server_id=get_server_row("mc1").id, actor_uid=None, action="crashed",
                           detail="Stopped unexpectedly (exit code 137)"))
        db.commit()
        latest = client.get("/servers/mc1/activity", headers=alice.headers).json()["msg"][0]
        assert latest["actor"] is None
        assert latest["detail"] == "Stopped unexpectedly (exit code 137)"

    def test_actor_not_in_directory(self, client, alice, running_server, db, get_server_row):
        db.add(ServerEvent(server_id=get_server_row("mc1").id, actor_uid="uid-gone", action="started"))
        db.commit()
        latest = client.get("/servers/mc1/activity", headers=alice.headers).json()["msg"][0]
        assert latest["actor"] == {"uid": "uid-gone", "name": None, "email": None, "picture": None}

    def test_limit(self, client, alice, running_server, db, get_server_row):
        server_id = get_server_row("mc1").id
        db.add_all([ServerEvent(server_id=server_id, action="started") for _ in range(250)])
        db.commit()
        get = lambda q="": client.get(f"/servers/mc1/activity{q}", headers=alice.headers).json()["msg"]
        assert len(get()) == 50
        assert len(get("?limit=5")) == 5
        assert len(get("?limit=1000")) == 200
        assert len(get("?limit=0")) == 1
        assert len(get("?limit=-3")) == 1

    def test_only_this_servers_events(self, client, alice, running_server, create_server):
        create_server(alice, "other")
        client.post("/servers/mc1", headers=alice.headers, json={"Action": 2})
        assert [e["action"] for e in client.get("/servers/other/activity", headers=alice.headers).json()["msg"]] == ["created"]

    def test_stranger(self, client, bob, running_server):
        assert client.get("/servers/mc1/activity", headers=bob.headers).status_code == 404


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------
class TestJobs:
    @pytest.mark.parametrize("status, code", [("queued", 1), ("started", 2), ("finished", 3), ("failed", 4)])
    def test_owner_can_poll(self, client, alice, create_server, queue, status, code):
        job_id = create_server(alice, "mc1").json()["msg"]["job_id"]
        queue.jobs[job_id].status = status
        response = client.get(f"/job/{job_id}", headers=alice.headers)
        assert response.status_code == 200
        assert response.json() == {"msg": {"status": code}}

    def test_other_users_jobs_are_hidden(self, client, alice, bob, create_server):
        job_id = create_server(alice, "mc1").json()["msg"]["job_id"]
        response = client.get(f"/job/{job_id}", headers=bob.headers)
        assert response.status_code == 404
        assert response.json()["detail"] == f"No job with id {job_id} on host"

    def test_unknown_job(self, client, alice):
        assert client.get("/job/nope", headers=alice.headers).status_code == 404

    def test_job_without_owner(self, client, alice, queue):
        job = queue.enqueue("tasks.jobs.goob")
        assert client.get(f"/job/{job.id}", headers=alice.headers).status_code == 404
