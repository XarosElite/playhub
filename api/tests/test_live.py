"""The background server monitor (app/internal/live.py): crash detection, stats and player counts."""
import threading

import docker
import pytest

import app.internal.live as live
from app.models.servers import Server, ServerEvent
from tests.fakes import stats_sample


@pytest.fixture
def add_server(db):
    def add(name="mc1", state="running", container_id="cid-mc1", game_type="minecraft", port=10000, **columns):
        server = Server(name=name, state=state, container_id=container_id, game_type=game_type,
                        port=port, owner_id="uid-alice", **columns)
        db.add(server)
        db.commit()
        return server.id
    return add


@pytest.fixture
def row(SessionLocal):
    def get(name="mc1"):
        with SessionLocal() as session:
            server = session.query(Server).filter_by(name=name).one()
            session.expunge(server)
            return server
    return get


@pytest.fixture
def system_events(SessionLocal):
    def get():
        with SessionLocal() as session:
            return [(e.action, e.actor_uid, e.detail) for e in session.query(ServerEvent).order_by(ServerEvent.id)]
    return get


@pytest.fixture(autouse=True)
def _fakes(SessionLocal, docker_fake, pings):
    pass


class TestReconcile:
    def test_crashed_container_is_marked_stopped_with_the_exit_code(self, add_server, docker_fake, row, system_events):
        add_server()
        docker_fake.add_container("mc1", id="cid-mc1", status="exited", exit_code=137)
        live.poll_once()
        server = row()
        assert (server.state, server.status_message) == ("exited", "Stopped unexpectedly (exit code 137)")
        assert system_events() == [("crashed", None, "Stopped unexpectedly (exit code 137)")]

    def test_crash_is_only_recorded_once(self, add_server, docker_fake, system_events):
        add_server()
        docker_fake.add_container("mc1", id="cid-mc1", status="exited", exit_code=1)
        live.poll_once()
        live.poll_once()
        assert len(system_events()) == 1

    @pytest.mark.parametrize("status", ["exited", "dead", "paused", "restarting", "created"])
    def test_any_non_running_status_counts(self, add_server, docker_fake, row, status):
        add_server()
        docker_fake.add_container("mc1", id="cid-mc1", status=status)
        live.poll_once()
        assert row().state == "exited"

    def test_missing_container_fails_the_server(self, add_server, row, system_events):
        add_server()
        live.poll_once()
        server = row()
        assert (server.state, server.status_message) == ("failed", "The server's container no longer exists")
        assert system_events() == [("missing", None, "The server's container no longer exists")]

    def test_missing_is_only_recorded_once(self, add_server, system_events):
        add_server()
        live.poll_once()
        live.poll_once()
        assert len(system_events()) == 1

    def test_server_without_a_container_yet_is_left_alone(self, add_server, row, system_events):
        add_server(state="exited", container_id="")
        live.poll_once()
        assert row().state == "exited"
        assert system_events() == []

    def test_container_started_outside_playhub(self, add_server, docker_fake, row):
        add_server(state="exited", status_message="Stopped unexpectedly (exit code 1)")
        docker_fake.add_container("mc1", id="cid-mc1", status="running")
        live.poll_once()
        assert (row().state, row().status_message) == ("running", None)

    def test_failed_server_whose_container_came_back(self, add_server, docker_fake, row):
        add_server(state="failed", status_message="Failed to start: boom")
        docker_fake.add_container("mc1", id="cid-mc1", status="running")
        live.poll_once()
        assert row().state == "running"

    @pytest.mark.parametrize("busy", ["starting", "stopping", "restarting", "updating"])
    def test_servers_with_a_job_in_flight_are_left_to_the_worker(self, add_server, docker_fake, row, system_events, busy):
        add_server(state=busy)
        docker_fake.add_container("mc1", id="cid-mc1", status="exited")
        live.poll_once()
        assert row().state == busy
        assert system_events() == []

    def test_deleted_servers_are_ignored(self, add_server, docker_fake, row):
        add_server(state="deleted")
        live.poll_once()
        assert row().state == "deleted"
        assert docker_fake.containers.get_calls == []

    def test_looks_containers_up_by_id_then_name(self, add_server, docker_fake):
        add_server(name="by-id", container_id="cid-1", port=10000)
        add_server(name="by-name", container_id=None, state="exited", port=10001)
        live.poll_once()
        assert docker_fake.containers.get_calls == ["cid-1", "by-name"]

    def test_docker_errors_abort_the_poll(self, add_server, docker_fake, row):
        add_server()
        docker_fake.containers.error = docker.errors.APIError("proxy down")
        with pytest.raises(docker.errors.APIError):
            live.poll_once()
        assert row().state == "running"  # nothing changed on a failed poll


class TestStats:
    def test_cpu_memory_and_uptime(self, add_server, docker_fake):
        server_id = add_server()
        docker_fake.add_container("mc1", id="cid-mc1", status="running", stats=[
            stats_sample(1_000, 100_000, mem_usage_mb=600, inactive_file_mb=100),
            stats_sample(3_000, 110_000, mem_usage_mb=700, inactive_file_mb=100),
        ])
        live.poll_once()
        first = live.get_live(server_id)
        assert first["cpu_pct"] is None  # needs two samples
        assert (first["mem_used_mb"], first["mem_limit_mb"]) == (500.0, 4096.0)
        assert first["started_at"] == "2026-11-01T10:00:00Z"

        live.poll_once()
        second = live.get_live(server_id)
        assert second["cpu_pct"] == 20.0  # 2000 / 10000 of the host
        assert second["mem_used_mb"] == 600.0
        assert [p["cpu_pct"] for p in second["history"]] == [None, 20.0]
        assert second["updated"] >= first["updated"]

    def test_history_is_capped(self, add_server, docker_fake, monkeypatch):
        monkeypatch.setattr(live, "HISTORY_LENGTH", 3)
        server_id = add_server()
        docker_fake.add_container("mc1", id="cid-mc1",
                                  stats=[stats_sample(i * 100, i * 1000) for i in range(1, 10)])
        for _ in range(6):
            live.poll_once()
        history = live.get_live(server_id)["history"]
        assert len(history) == 3
        assert all(p["cpu_pct"] == 10.0 for p in history)

    def test_without_history(self, add_server, docker_fake):
        server_id = add_server()
        docker_fake.add_container("mc1", id="cid-mc1")
        live.poll_once()
        assert "history" not in live.get_live(server_id, with_history=False)

    def test_returned_snapshots_are_copies(self, add_server, docker_fake):
        server_id = add_server()
        docker_fake.add_container("mc1", id="cid-mc1")
        live.poll_once()
        live.get_live(server_id)["cpu_pct"] = 99
        assert live.get_live(server_id)["cpu_pct"] != 99

    def test_stats_failure_still_reports_the_server(self, add_server, docker_fake):
        server_id = add_server()
        docker_fake.add_container("mc1", id="cid-mc1", stats=RuntimeError("stats timeout"))
        live.poll_once()
        snapshot = live.get_live(server_id)
        assert snapshot["cpu_pct"] is None and snapshot["mem_used_mb"] is None
        assert snapshot["players"] == {"online": 3, "max": 20, "version": "1.21.4"}

    def test_stopped_servers_drop_their_stats(self, add_server, docker_fake, SessionLocal):
        server_id = add_server()
        container = docker_fake.add_container("mc1", id="cid-mc1")
        live.poll_once()
        assert live.get_live(server_id) is not None
        container.status = "exited"
        live.poll_once()
        assert live.get_live(server_id) is None
        assert server_id not in live._history

    def test_only_running_servers_are_sampled(self, add_server, docker_fake):
        add_server(name="stopped", state="exited", container_id="cid-s", port=10001)
        stopped = docker_fake.add_container("stopped", id="cid-s", status="exited")
        live.poll_once()
        assert stopped.stats_calls == 0

    def test_unknown_server(self):
        assert live.get_live(12345) is None


class TestPlayers:
    def test_minecraft_servers_are_pinged_on_their_host_port(self, add_server, docker_fake, pings):
        server_id = add_server(port=10007)
        docker_fake.add_container("mc1", id="cid-mc1")
        live.poll_once()
        assert pings == [(live.GAME_HOST, 10007)]
        assert live.get_live(server_id)["players"] == {"online": 3, "max": 20, "version": "1.21.4"}

    def test_server_still_booting(self, add_server, docker_fake, pings):
        pings.result = ConnectionRefusedError()
        server_id = add_server()
        docker_fake.add_container("mc1", id="cid-mc1")
        live.poll_once()
        assert live.get_live(server_id)["players"] is None

    def test_games_without_a_status_query_are_not_pinged(self, add_server, docker_fake, pings):
        server_id = add_server(name="pal1", game_type="palworld", container_id="cid-pal")
        docker_fake.add_container("pal1", id="cid-pal")
        live.poll_once()
        assert pings == []
        assert live.get_live(server_id)["players"] is None

    def test_games_removed_from_the_catalog(self, add_server, docker_fake, pings):
        server_id = add_server(game_type="terraria")
        docker_fake.add_container("mc1", id="cid-mc1")
        live.poll_once()
        assert pings == []
        assert live.get_live(server_id) is not None


class TestCalculations:
    def test_cpu_percent_from_deltas(self):
        assert live._cpu_percent("c", stats_sample(100, 1000)) is None
        assert live._cpu_percent("c", stats_sample(350, 2000)) == 25.0

    def test_cpu_counter_reset_or_idle_host(self):
        live._cpu_percent("c", stats_sample(500, 1000))
        assert live._cpu_percent("c", stats_sample(100, 2000)) == 0.0  # container restarted
        assert live._cpu_percent("c", stats_sample(200, 2000)) == 0.0  # no system time passed

    def test_cpu_missing_fields(self):
        assert live._cpu_percent("c", {}) is None
        assert live._cpu_percent("c", {"cpu_stats": {"cpu_usage": {}}}) is None

    def test_cpu_is_tracked_per_container(self):
        live._cpu_percent("a", stats_sample(100, 1000))
        assert live._cpu_percent("b", stats_sample(500, 5000)) is None

    def test_memory_excludes_page_cache(self):
        assert live._memory_mb(stats_sample(0, 0, mem_usage_mb=1024, mem_limit_mb=2048, inactive_file_mb=24)) == (1000.0, 2048.0)

    def test_memory_cgroup_v1_cache_key(self):
        stats = {"memory_stats": {"usage": 300 * 2**20, "limit": 0, "stats": {"total_inactive_file": 100 * 2**20}}}
        assert live._memory_mb(stats) == (200.0, None)

    def test_memory_missing(self):
        assert live._memory_mb({}) == (None, None)
        assert live._memory_mb({"memory_stats": {}}) == (None, None)


class TestMonitorThread:
    def test_start_polls_until_stopped(self, monkeypatch):
        polled = threading.Event()
        monkeypatch.setattr(live, "poll_once", polled.set)
        monkeypatch.setattr(live, "_thread", None)
        live.start_monitor()
        try:
            assert polled.wait(2)
            assert live._thread.name == "server-monitor" and live._thread.daemon
        finally:
            live.stop_monitor()
            live._thread.join(2)
        assert not live._thread.is_alive()

    def test_starting_twice_runs_one_thread(self, monkeypatch):
        monkeypatch.setattr(live, "poll_once", lambda: None)
        monkeypatch.setattr(live, "_thread", None)
        live.start_monitor()
        first = live._thread
        live.start_monitor()
        try:
            assert live._thread is first
        finally:
            live.stop_monitor()
            first.join(2)

    def test_poll_errors_are_logged_and_polling_continues(self, monkeypatch, caplog):
        calls = []
        done = threading.Event()

        def flaky():
            calls.append(1)
            if len(calls) >= 3:
                done.set()
            raise RuntimeError("docker proxy unreachable")

        monkeypatch.setattr(live, "poll_once", flaky)
        monkeypatch.setattr(live, "POLL_SECONDS", 0.01)
        monkeypatch.setattr(live, "_thread", None)
        live.start_monitor()
        try:
            assert done.wait(2)
        finally:
            live.stop_monitor()
            live._thread.join(2)
        # Logged once, not on every failed poll.
        assert caplog.text.count("Server monitor poll failed: docker proxy unreachable") == 1
