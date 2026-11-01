"""
WebSockets: /servers/live, /servers/{id}/logs and /servers/{id}/terminal.

Each expects the Firebase ID token as its first message.
"""
import json
import time

import pytest
from starlette.websockets import WebSocketDisconnect

import app.internal.auth as auth
import app.routers.server_streams as streams
from tests.fakes import FakeLogStream


def receive_close(ws):
    """Reads until the server closes the socket; returns the close code."""
    with pytest.raises(WebSocketDisconnect) as closed:
        while True:
            ws.receive_text()
    return closed.value.code


@pytest.fixture(params=["/servers/live", "/servers/mc1/logs", "/servers/mc1/terminal"])
def socket_path(request):
    return request.param


class TestWebSocketAuth:
    def test_invalid_token(self, client, running_server, socket_path):
        with client.websocket_connect(socket_path) as ws:
            ws.send_text("forged")
            assert "Invalid or expired session" in ws.receive_text()
            assert receive_close(ws) == auth.WEBSOCKET_UNAUTHORIZED

    def test_not_configured(self, client, alice, running_server, socket_path, monkeypatch):
        monkeypatch.setattr(auth, "FIREBASE_PROJECT_ID", "")
        with client.websocket_connect(socket_path) as ws:
            ws.send_text(alice.token)
            assert "Authentication is not configured" in ws.receive_text()
            assert receive_close(ws) == auth.WEBSOCKET_UNAUTHORIZED

    def test_no_token_within_the_timeout(self, client, running_server, socket_path, monkeypatch):
        monkeypatch.setattr(auth, "WEBSOCKET_AUTH_TIMEOUT_SECONDS", 0.05)
        with client.websocket_connect(socket_path) as ws:
            assert "Authentication required" in ws.receive_text()
            assert receive_close(ws) == auth.WEBSOCKET_UNAUTHORIZED

    def test_token_whitespace_is_ignored(self, client, alice, running_server):
        with client.websocket_connect("/servers/live") as ws:
            ws.send_text(f"  {alice.token}\n")
            assert json.loads(ws.receive_text())["type"] == "servers"

    def test_allowlist_applies(self, client, alice, running_server, monkeypatch):
        monkeypatch.setattr(auth, "ALLOWED_EMAILS", {"someone@example.com"})
        auth._token_cache.clear()  # changing the allowlist means restarting the API
        with client.websocket_connect("/servers/live") as ws:
            ws.send_text(alice.token)
            assert "not allowed" in ws.receive_text()
            assert receive_close(ws) == auth.WEBSOCKET_UNAUTHORIZED


class TestLive:
    def test_pushes_the_users_servers(self, client, alice, running_server):
        with client.websocket_connect("/servers/live") as ws:
            ws.send_text(alice.token)
            message = json.loads(ws.receive_text())
        assert message["type"] == "servers"
        assert [s["Name"] for s in message["servers"]] == ["mc1"]
        assert message["servers"][0]["State"] == "running"
        assert message["servers"][0]["IsOwner"] is True

    def test_only_accessible_servers(self, client, alice, bob, running_server):
        with client.websocket_connect("/servers/live") as ws:
            ws.send_text(bob.token)
            assert json.loads(ws.receive_text())["servers"] == []

    def test_refresh_pushes_changes_immediately(self, client, alice, running_server, set_state):
        with client.websocket_connect("/servers/live") as ws:
            ws.send_text(alice.token)
            json.loads(ws.receive_text())
            set_state("mc1", "stopping")
            ws.send_text("refresh")
            assert json.loads(ws.receive_text())["servers"][0]["State"] == "stopping"

    def test_pushes_changes_on_its_own(self, client, alice, running_server, set_state, monkeypatch):
        monkeypatch.setattr(streams, "LIVE_PUSH_SECONDS", 0.05)
        with client.websocket_connect("/servers/live") as ws:
            ws.send_text(alice.token)
            json.loads(ws.receive_text())
            set_state("mc1", "exited")
            assert json.loads(ws.receive_text())["servers"][0]["State"] == "exited"

    def test_unchanged_lists_are_not_resent(self, client, alice, running_server, set_state, monkeypatch):
        monkeypatch.setattr(streams, "LIVE_PUSH_SECONDS", 0.02)
        with client.websocket_connect("/servers/live") as ws:
            ws.send_text(alice.token)
            first = json.loads(ws.receive_text())
            for _ in range(3):
                ws.send_text("refresh")  # nothing changed: no message
            time.sleep(0.1)
            set_state("mc1", "exited")
            second = json.loads(ws.receive_text())
        assert first["servers"][0]["State"] == "running"
        assert second["servers"][0]["State"] == "exited"  # the very next message is the change

    def test_closes_when_the_session_expires(self, client, make_user, running_server, monkeypatch):
        monkeypatch.setattr(streams, "LIVE_PUSH_SECONDS", 0.05)
        person = make_user("uid-short", expires_in=0.3)
        with client.websocket_connect("/servers/live") as ws:
            ws.send_text(person.token)
            json.loads(ws.receive_text())
            assert receive_close(ws) == auth.WEBSOCKET_UNAUTHORIZED

    def test_no_live_stats_until_the_monitor_samples(self, client, alice, running_server):
        with client.websocket_connect("/servers/live") as ws:
            ws.send_text(alice.token)
            server = json.loads(ws.receive_text())["servers"][0]
        assert server["Live"] is None


class TestLogs:
    def test_streams_container_logs(self, client, alice, running_server, docker_fake):
        docker_fake.api.log_streams["cid-mc1"] = FakeLogStream([b"[Server] Starting\n", b"[Server] Done!\n"])
        with client.websocket_connect("/servers/mc1/logs") as ws:
            ws.send_text(alice.token)
            assert ws.receive_text() == "[Server] Starting\n"
            assert ws.receive_text() == "[Server] Done!\n"
            assert "Log stream ended" in ws.receive_text()
        container, options = docker_fake.api.logs_calls[0]
        assert container == "cid-mc1"
        assert options == {"stream": True, "follow": True, "tail": streams.LOG_TAIL_LINES, "timestamps": False}

    def test_falls_back_to_the_name_before_the_container_exists(self, client, alice, create_server, docker_fake):
        create_server(alice, "mc1")
        with client.websocket_connect("/servers/mc1/logs") as ws:
            ws.send_text(alice.token)
            ws.receive_text()
        assert docker_fake.api.logs_calls[0][0] == "mc1"

    def test_invalid_utf8_is_replaced(self, client, alice, running_server, docker_fake):
        docker_fake.api.log_streams["cid-mc1"] = FakeLogStream([b"caf\xe9\n"])
        with client.websocket_connect("/servers/mc1/logs") as ws:
            ws.send_text(alice.token)
            assert ws.receive_text() == "caf�\n"

    def test_disconnecting_closes_the_docker_stream(self, client, alice, running_server, docker_fake):
        stream = FakeLogStream([b"line\n"], block=True)
        docker_fake.api.log_streams["cid-mc1"] = stream
        with client.websocket_connect("/servers/mc1/logs") as ws:
            ws.send_text(alice.token)
            assert ws.receive_text() == "line\n"
        assert stream.closed.wait(2)
        assert docker_fake.closed

    def test_server_not_found(self, client, bob, running_server, docker_fake):
        with client.websocket_connect("/servers/mc1/logs") as ws:
            ws.send_text(bob.token)
            assert "Server mc1 not found" in ws.receive_text()
            receive_close(ws)
        assert docker_fake.api.logs_calls == []

    def test_docker_unavailable(self, client, alice, running_server, docker_fake):
        docker_fake.api.logs_error = ConnectionError("proxy down")
        with client.websocket_connect("/servers/mc1/logs") as ws:
            ws.send_text(alice.token)
            assert "Unable to read logs: proxy down" in ws.receive_text()
            receive_close(ws)

    def test_shared_users_can_read_logs(self, client, alice, bob, running_server, docker_fake):
        client.get("/auth/me", headers=bob.headers)
        client.put("/servers/mc1/shares", headers=alice.headers, json={"user_ids": [bob.uid]})
        docker_fake.api.log_streams["cid-mc1"] = FakeLogStream([b"hi\n"])
        with client.websocket_connect("/servers/mc1/logs") as ws:
            ws.send_text(bob.token)
            assert ws.receive_text() == "hi\n"


class TestTerminal:
    def test_relays_keystrokes_and_output(self, client, alice, running_server, docker_fake):
        with client.websocket_connect("/servers/mc1/terminal") as ws:
            ws.send_text(alice.token)
            assert ws.receive_text() == "/ # "
            ws.send_text("ls\n")
            assert ws.receive_text() == "echo:ls\n"
        shell = docker_fake.api.exec_sockets[0]
        assert shell.received == [b"ls\n"]
        assert docker_fake.api.exec_commands == [("cid-mc1", ("/bin/sh",))]

    def test_falls_back_to_bash(self, client, alice, running_server, docker_fake):
        docker_fake.api.exec_fail_commands = {"/bin/sh"}
        with client.websocket_connect("/servers/mc1/terminal") as ws:
            ws.send_text(alice.token)
            assert ws.receive_text() == "/ # "
        assert [cmd for _, cmd in docker_fake.api.exec_commands] == [("/bin/sh",), ("/bin/bash",)]

    def test_no_shell_available(self, client, alice, running_server, docker_fake):
        docker_fake.api.exec_fail_commands = {"/bin/sh", "/bin/bash"}
        with client.websocket_connect("/servers/mc1/terminal") as ws:
            ws.send_text(alice.token)
            assert "Error starting container terminal exec session" in ws.receive_text()
            receive_close(ws)

    def test_docker_unavailable(self, client, alice, running_server, monkeypatch):
        def broken():
            raise ConnectionError("proxy down")
        monkeypatch.setattr(streams, "_docker_client", broken)
        with client.websocket_connect("/servers/mc1/terminal") as ws:
            ws.send_text(alice.token)
            assert "Error connecting to Docker API: proxy down" in ws.receive_text()
            receive_close(ws)

    def test_server_not_found(self, client, bob, running_server, docker_fake):
        with client.websocket_connect("/servers/mc1/terminal") as ws:
            ws.send_text(bob.token)
            assert "Server mc1 not found" in ws.receive_text()
            receive_close(ws)
        assert docker_fake.api.exec_commands == []

    def test_shared_users_get_a_terminal(self, client, alice, bob, running_server, docker_fake):
        client.get("/auth/me", headers=bob.headers)
        client.put("/servers/mc1/shares", headers=alice.headers, json={"user_ids": [bob.uid]})
        with client.websocket_connect("/servers/mc1/terminal") as ws:
            ws.send_text(bob.token)
            assert ws.receive_text() == "/ # "

    def test_disconnect_closes_the_exec_socket(self, client, alice, running_server, docker_fake):
        with client.websocket_connect("/servers/mc1/terminal") as ws:
            ws.send_text(alice.token)
            ws.receive_text()
        shell = docker_fake.api.exec_sockets[0]
        deadline = time.time() + 2
        while time.time() < deadline and shell._sock.fileno() != -1:
            time.sleep(0.01)
        assert shell._sock.fileno() == -1

    def test_disconnect_ends_the_shell(self, client, alice, running_server, docker_fake):
        """Closing the browser tab must not leave a shell (and a blocked thread) behind."""
        with client.websocket_connect("/servers/mc1/terminal") as ws:
            ws.send_text(alice.token)
            ws.receive_text()
        shell = docker_fake.api.exec_sockets[0]
        shell.shell.settimeout(2)
        assert shell.shell.recv(10) == b""  # the container side sees EOF

    def test_shell_exiting_ends_the_session(self, client, alice, running_server, docker_fake):
        with client.websocket_connect("/servers/mc1/terminal") as ws:
            ws.send_text(alice.token)
            assert ws.receive_text() == "/ # "
            docker_fake.api.exec_sockets[0].exit_shell()
            assert "Session ended" in ws.receive_text()
            receive_close(ws)
