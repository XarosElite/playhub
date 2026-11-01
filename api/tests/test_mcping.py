"""Minecraft Server List Ping against a fake Minecraft server speaking the real protocol."""
import json
import socket
import struct
import threading

import pytest

from app.internal import mcping
from app.internal.mcping import _varint, ping


def read_varint(conn):
    result = 0
    for i in range(5):
        b = conn.recv(1)[0]
        result |= (b & 0x7F) << (7 * i)
        if not b & 0x80:
            return result
    raise ValueError("VarInt too long")


class FakeMinecraftServer:
    """Answers one status request per connection, like a vanilla server."""

    def __init__(self, status=None, respond=None):
        self.status = status or {
            "version": {"name": "1.21.4", "protocol": 769},
            "players": {"max": 20, "online": 5, "sample": []},
            "description": {"text": "A Minecraft Server"},
        }
        self.respond = respond  # optional custom responder(conn)
        self.handshakes = []
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen()
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            with conn:
                try:
                    self._handle(conn)
                except Exception:
                    pass

    def _handle(self, conn):
        length = read_varint(conn)
        packet = b""
        while len(packet) < length:
            packet += conn.recv(length - len(packet))
        self.handshakes.append(packet)
        # status request: length 1, id 0
        assert read_varint(conn) == 1 and read_varint(conn) == 0
        if self.respond:
            self.respond(conn)
            return
        payload = json.dumps(self.status).encode()
        body = _varint(0x00) + _varint(len(payload)) + payload
        conn.sendall(_varint(len(body)) + body)

    def close(self):
        self.sock.close()


@pytest.fixture
def server():
    servers = []

    def make(**kwargs):
        s = FakeMinecraftServer(**kwargs)
        servers.append(s)
        return s

    yield make
    for s in servers:
        s.close()


class TestVarint:
    @pytest.mark.parametrize("value, encoded", [
        (0, b"\x00"), (1, b"\x01"), (127, b"\x7f"), (128, b"\x80\x01"),
        (255, b"\xff\x01"), (25565, b"\xdd\xc7\x01"), (2097151, b"\xff\xff\x7f"),
        (2147483647, b"\xff\xff\xff\xff\x07"),
    ])
    def test_encoding_matches_the_spec(self, value, encoded):
        assert _varint(value) == encoded

    @pytest.mark.parametrize("value", [0, 1, 300, 25565, 2**31 - 1])
    def test_round_trip(self, value):
        a, b = socket.socketpair()
        with a, b:
            a.sendall(_varint(value))
            assert mcping._read_varint(b) == value

    def test_too_long(self):
        a, b = socket.socketpair()
        with a, b:
            a.sendall(b"\xff" * 6)
            with pytest.raises(ValueError, match="VarInt too long"):
                mcping._read_varint(b)

    def test_connection_closed(self):
        a, b = socket.socketpair()
        with b:
            a.close()
            with pytest.raises(ConnectionError):
                mcping._read_varint(b)


class TestPing:
    def test_reads_player_counts_and_version(self, server):
        s = server()
        assert ping("127.0.0.1", s.port) == {"online": 5, "max": 20, "version": "1.21.4"}

    def test_handshake_names_the_address_and_asks_for_status(self, server):
        s = server()
        ping("127.0.0.1", s.port)
        packet = s.handshakes[0]
        host = b"127.0.0.1"
        assert packet.startswith(_varint(0) + _varint(767) + _varint(len(host)) + host)
        assert packet[-3:-1] == struct.pack(">H", s.port)
        assert packet[-1:] == _varint(1)  # next state: status

    def test_missing_fields_default(self, server):
        s = server(status={"description": "old server"})
        assert ping("127.0.0.1", s.port) == {"online": 0, "max": 0, "version": None}

    def test_large_payload(self, server):
        # Servers with mods or long MOTDs send big status payloads in several TCP chunks.
        s = server(status={
            "version": {"name": "1.21"}, "players": {"online": 1, "max": 2},
            "description": "x" * 200_000,
        })
        assert ping("127.0.0.1", s.port)["online"] == 1

    def test_unexpected_packet(self, server):
        def respond(conn):
            body = _varint(0x05) + b"junk"
            conn.sendall(_varint(len(body)) + body)
        s = server(respond=respond)
        with pytest.raises(ValueError, match="Unexpected packet"):
            ping("127.0.0.1", s.port)

    def test_connection_closed_mid_payload(self, server):
        def respond(conn):
            conn.sendall(_varint(100) + _varint(0) + _varint(90) + b"{\"players\"")
        s = server(respond=respond)
        with pytest.raises(ConnectionError):
            ping("127.0.0.1", s.port)

    def test_invalid_json(self, server):
        def respond(conn):
            payload = b"not json"
            body = _varint(0) + _varint(len(payload)) + payload
            conn.sendall(_varint(len(body)) + body)
        s = server(respond=respond)
        with pytest.raises(ValueError):
            ping("127.0.0.1", s.port)

    def test_nothing_listening(self):
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        with pytest.raises(OSError):
            ping("127.0.0.1", port)

    def test_silent_server_times_out(self):
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        sock.listen()
        try:
            with pytest.raises(socket.timeout):
                ping("127.0.0.1", sock.getsockname()[1], timeout=0.2)
        finally:
            sock.close()
