"""Port allocation and server-name rules (app/depenencies.py)."""
import socket

import pytest
from fastapi import HTTPException

import app.depenencies as deps
from app.models.servers import Server


class TestPortAvailableOnHost:
    def test_free_port(self):
        probe = socket.socket()
        probe.bind(("0.0.0.0", 0))
        port = probe.getsockname()[1]
        probe.close()
        assert deps.is_port_available_on_host(port) is True

    def test_port_in_use(self):
        holder = socket.socket()
        holder.bind(("0.0.0.0", 0))
        holder.listen()
        try:
            assert deps.is_port_available_on_host(holder.getsockname()[1]) is False
        finally:
            holder.close()


class TestNextAvailablePort:
    @pytest.fixture(autouse=True)
    def _host_ports_free(self, monkeypatch):
        self.busy_on_host = set()
        monkeypatch.setattr(deps, "is_port_available_on_host", lambda port: port not in self.busy_on_host)

    def add(self, db, port, state="running", name=None):
        db.add(Server(name=name or f"s{port}", game_type="minecraft", state=state, port=port, owner_id="u"))
        db.commit()

    def test_starts_at_the_bottom_of_the_range(self, db):
        assert deps.get_next_available_port(db=db) == deps.PORT_LOWER == 10000

    def test_skips_ports_used_by_servers(self, db):
        self.add(db, 10000)
        self.add(db, 10001)
        self.add(db, 10003)
        assert deps.get_next_available_port(db=db) == 10002

    def test_skips_ports_used_by_other_programs(self, db):
        self.busy_on_host = {10000, 10001}
        assert deps.get_next_available_port(db=db) == 10002

    def test_ports_released_by_deleted_servers_are_reused(self, db):
        db.add(Server(name="old (deleted #1)", game_type="minecraft", state="deleted", port=None, owner_id="u"))
        db.commit()
        assert deps.get_next_available_port(db=db) == 10000

    def test_ports_still_held_by_any_row_are_skipped(self, db):
        # A row keeps its port (unique in the DB) until it is released.
        self.add(db, 10000, state="deleted")
        assert deps.get_next_available_port(db=db) == 10001

    def test_requested_port(self, db):
        assert deps.get_next_available_port(requested_port=10100, db=db) == 10100

    def test_requested_port_taken_falls_back_to_the_range(self, db):
        self.add(db, 10100)
        assert deps.get_next_available_port(requested_port=10100, db=db) == 10000
        self.busy_on_host = {10200}
        assert deps.get_next_available_port(requested_port=10200, db=db) == 10000

    @pytest.mark.parametrize("requested", [0, -5, None])
    def test_invalid_requested_port_is_ignored(self, db, requested):
        assert deps.get_next_available_port(requested_port=requested, db=db) == 10000

    def test_last_port_in_the_range(self, db):
        self.busy_on_host = set(range(deps.PORT_LOWER, deps.PORT_UPPER))
        assert deps.get_next_available_port(db=db) == deps.PORT_UPPER == 10250

    def test_range_exhausted(self, db):
        self.busy_on_host = set(range(deps.PORT_LOWER, deps.PORT_UPPER + 1))
        with pytest.raises(HTTPException) as error:
            deps.get_next_available_port(db=db)
        assert error.value.status_code == 507


class TestServerName:
    @pytest.mark.parametrize("name", ["abc", "mc1", "My-Server_2.0", "a.b.c", "A1b", "x" * 36, "123"])
    def test_valid(self, name):
        assert deps.validate_server_name(name) is None

    @pytest.mark.parametrize("name, error", [
        ("ab", "Must be between 3 and 36 characters"),
        ("x" * 37, "Must be between 3 and 36 characters"),
        (".mc", 'Cannot start or end with ".", "_", or "-"'),
        ("mc_", 'Cannot start or end with ".", "_", or "-"'),
        ("a--b", 'Cannot contain sequential symbols like "..", "__", or "--"'),
        ("a._b", 'Cannot contain sequential symbols like "..", "__", or "--"'),
        ("a b", 'Can only contain letters, numbers, ".", "_", or "-"'),
        ("a/b", 'Can only contain letters, numbers, ".", "_", or "-"'),
        ("a\nb", 'Can only contain letters, numbers, ".", "_", or "-"'),
        ("ünï", 'Can only contain letters, numbers, ".", "_", or "-"'),
        ("mc1 (deleted #4)", 'Can only contain letters, numbers, ".", "_", or "-"'),
    ])
    def test_invalid(self, name, error):
        assert deps.validate_server_name(name) == error
