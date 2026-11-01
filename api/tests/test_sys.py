"""/sys routes: host stats, public IP and port checks."""
import datetime
import socket
from collections import namedtuple

import pytest

import app.routers.sys as sys_router


class TestInfo:
    def test_reports_cpu_and_memory(self, client, alice, monkeypatch):
        Memory = namedtuple("Memory", "total used percent")
        monkeypatch.setattr(sys_router.psutil, "cpu_percent", lambda interval: 37.5)
        monkeypatch.setattr(sys_router.psutil, "virtual_memory", lambda: Memory(16 * 1024**3, 4.5 * 1024**3, 28.123))
        info = client.get("/sys/info", headers=alice.headers).json()["msg"]["sys_info"]
        timestamp = info.pop("time")
        assert info == {"cpu_usage": 37.5, "total_ram_gb": 16.0, "used_ram_gb": 4.5, "used_ram_pct": 28.12}
        parsed = datetime.datetime.fromisoformat(timestamp)
        assert parsed.tzinfo is not None
        assert abs((datetime.datetime.now(datetime.timezone.utc) - parsed).total_seconds()) < 5

    def test_real_host_values_are_sane(self, client, alice):
        info = client.get("/sys/info", headers=alice.headers).json()["msg"]["sys_info"]
        assert 0 <= info["cpu_usage"] <= 100
        assert 0 < info["used_ram_gb"] <= info["total_ram_gb"]
        assert 0 <= info["used_ram_pct"] <= 100


class FakeResponse:
    def __init__(self, status_code, text):
        self.status_code = status_code
        self.text = text


class TestIp:
    def test_first_service_that_answers(self, client, alice, monkeypatch):
        asked = []

        def get(url, timeout):
            asked.append(url)
            if "ipify" in url:
                raise ConnectionError("down")
            if "ifconfig.me" in url:
                return FakeResponse(500, "error")
            return FakeResponse(200, "203.0.113.7\n")

        monkeypatch.setattr(sys_router.requests, "get", get)
        assert client.get("/sys/ip", headers=alice.headers).json() == {"msg": {"ip": "203.0.113.7"}}
        assert asked == ["https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"]

    def test_empty_answers_are_skipped(self, client, alice, monkeypatch):
        answers = iter([FakeResponse(200, "  "), FakeResponse(200, "198.51.100.2")])
        monkeypatch.setattr(sys_router.requests, "get", lambda url, timeout: next(answers))
        assert client.get("/sys/ip", headers=alice.headers).json()["msg"]["ip"] == "198.51.100.2"

    def test_falls_back_to_the_lan_address(self, client, alice, monkeypatch):
        def offline(url, timeout):
            raise ConnectionError("offline")

        class FakeUdp:
            def __init__(self, *args):
                pass

            def connect(self, address):
                assert address == ("8.8.8.8", 80)

            def getsockname(self):
                return ("192.168.4.25", 54321)

            def close(self):
                pass

        monkeypatch.setattr(sys_router.requests, "get", offline)
        monkeypatch.setattr(sys_router.socket, "socket", FakeUdp)
        assert client.get("/sys/ip", headers=alice.headers).json()["msg"]["ip"] == "192.168.4.25"

    def test_no_network_at_all(self, client, alice, monkeypatch):
        def offline(*args, **kwargs):
            raise OSError("network unreachable")

        class NoNetwork:
            def __init__(self, *args):
                pass

            def connect(self, address):
                raise OSError("network unreachable")

        monkeypatch.setattr(sys_router.requests, "get", offline)
        monkeypatch.setattr(sys_router.socket, "socket", NoNetwork)
        assert client.get("/sys/ip", headers=alice.headers).json()["msg"]["ip"] == "127.0.0.1"


class TestPortCheck:
    def test_listening_port_is_open(self, client, alice):
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        try:
            port = listener.getsockname()[1]
            assert client.get(f"/sys/?open_port={port}", headers=alice.headers).json() == {"msg": {"open_status": True}}
        finally:
            listener.close()

    def test_closed_port(self, client, alice):
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()
        assert client.get(f"/sys/?open_port={port}", headers=alice.headers).json() == {"msg": {"open_status": False}}

    def test_no_port_given(self, client, alice):
        assert client.get("/sys/", headers=alice.headers).json() == {"msg": {"open_status": False}}

    @pytest.mark.parametrize("value", ["abc", "1.5"])
    def test_port_must_be_an_integer(self, client, alice, value):
        response = client.get(f"/sys/?open_port={value}", headers=alice.headers)
        assert response.status_code == 422
        assert response.json()["msg"] == "Validation error"
