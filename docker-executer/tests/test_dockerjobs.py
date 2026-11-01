"""The worker's jobs (tasks/dockerjobs.py) against a fake Docker and a real database."""
import datetime

import docker
import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from tasks import dockerjobs as jobs

ENV = {"EULA": "true", "MAX_PLAYERS": "20"}
PORTS = {"25565/tcp": "10000"}
IMAGE = "itzg/minecraft-server"


def api_error(explanation):
    return docker.errors.APIError("500 Server Error", explanation=explanation)


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
class TestUpdateServerDb:
    def test_updates_only_the_given_columns(self, add_server, server_row):
        add_server(status_message="old message")
        jobs.update_server_db("mc1", state="running")
        row = server_row()
        assert (row["state"], row["container_id"], row["status_message"]) == ("running", "", "old message")

    def test_all_columns(self, add_server, server_row):
        add_server()
        created = datetime.datetime(2026, 11, 1, 12, 0, tzinfo=datetime.timezone.utc)
        jobs.update_server_db("mc1", container_id="abc", state="running", created=created, status_message="hi")
        row = server_row()
        assert (row["state"], row["container_id"], row["status_message"]) == ("running", "abc", "hi")
        assert row["created"] is not None

    def test_status_message_none_clears_it(self, add_server, server_row):
        add_server(status_message="Failed to start: boom")
        jobs.update_server_db("mc1", status_message=None)
        assert server_row()["status_message"] is None

    def test_nothing_to_update(self, add_server, server_row):
        add_server()
        jobs.update_server_db("mc1")
        assert server_row()["state"] == "starting"

    def test_deleted_servers_are_never_resurrected(self, add_server, server_row):
        add_server(state="deleted")
        jobs.update_server_db("mc1", state="running")
        assert server_row()["state"] == "deleted"

    def test_only_the_named_server(self, add_server, server_row):
        add_server("mc1", port=10000)
        add_server("mc2", port=10001)
        jobs.update_server_db("mc1", state="running")
        assert server_row("mc2")["state"] == "starting"

    def test_database_errors_are_logged_not_raised(self, monkeypatch, caplog):
        class Down:
            def connect(self):
                raise OperationalError("CONNECT", {}, Exception("connection refused"))
        monkeypatch.setattr(jobs, "db_engine", Down())
        jobs.update_server_db("mc1", state="running")
        assert "Error updating DB for server mc1" in caplog.text


class TestRecordEvent:
    def test_adds_a_system_event(self, add_server, server_events):
        add_server()
        jobs.record_event("mc1", "failed", "Couldn't start: boom")
        assert server_events() == [("failed", None, "Couldn't start: boom")]

    def test_unknown_server_records_nothing(self, engine, server_events):
        jobs.record_event("ghost", "failed")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT COUNT(*) FROM server_events")).scalar() == 0

    def test_database_errors_are_logged_not_raised(self, monkeypatch, caplog):
        class Down:
            def connect(self):
                raise OperationalError("CONNECT", {}, Exception("connection refused"))
        monkeypatch.setattr(jobs, "db_engine", Down())
        jobs.record_event("mc1", "failed")
        assert "Error recording event for server mc1" in caplog.text


class TestErrorMessage:
    def test_docker_explanation(self):
        assert jobs._error_message(api_error("port is already allocated")) == "port is already allocated"

    def test_docker_error_without_explanation(self):
        assert "Not Found" in jobs._error_message(docker.errors.NotFound("Not Found"))

    def test_plain_exception(self):
        assert jobs._error_message(RuntimeError("boom")) == "boom"

    def test_exception_without_a_message(self):
        assert jobs._error_message(TimeoutError()) == "TimeoutError"


def test_volume_names():
    assert jobs.volume_name("mc1") == "playhub-mc1-data"
    assert jobs._volumes("mc1", "/data") == {"playhub-mc1-data": {"bind": "/data", "mode": "rw"}}
    assert jobs._volumes("mc1", None) is None


# ---------------------------------------------------------------------------
# create_server
# ---------------------------------------------------------------------------
class TestCreate:
    def test_runs_the_container_and_marks_it_running(self, add_server, server_row, docker_fake):
        add_server(status_message="stale")
        assert jobs.create_server("mc1", ENV, PORTS, IMAGE, "/data") == "Finished"
        [run] = docker_fake.containers.runs
        assert run == {
            "image": IMAGE, "name": "mc1", "ports": PORTS, "environment": ENV,
            "volumes": {"playhub-mc1-data": {"bind": "/data", "mode": "rw"}}, "detach": True,
        }
        row = server_row()
        assert row["state"] == "running"
        assert row["container_id"] == docker_fake.containers.by_name["mc1"].id
        assert row["status_message"] is None
        assert row["created"] is not None

    def test_without_a_data_path(self, add_server, docker_fake):
        add_server()
        jobs.create_server("mc1", ENV, PORTS, IMAGE)
        assert docker_fake.containers.runs[0]["volumes"] is None

    def test_replaces_a_leftover_container_with_the_same_name(self, add_server, docker_fake):
        add_server()
        docker_fake.containers.add("mc1", status="exited")
        jobs.create_server("mc1", ENV, PORTS, IMAGE, "/data")
        assert docker_fake.log[:2] == [("remove", "mc1", {"force": True, "v": False}), ("run", "mc1")]

    def test_failure_marks_the_server_failed_and_reraises(self, add_server, server_row, server_events, docker_fake):
        add_server()
        docker_fake.containers.run_error = api_error("port is already allocated")
        with pytest.raises(docker.errors.APIError):
            jobs.create_server("mc1", ENV, PORTS, IMAGE, "/data")
        row = server_row()
        assert (row["state"], row["status_message"]) == ("failed", "Failed to create: port is already allocated")
        assert server_events() == [("failed", None, "Couldn't create: port is already allocated")]

    def test_image_pull_failure(self, add_server, server_row, docker_fake):
        add_server()
        docker_fake.containers.run_error = docker.errors.ImageNotFound("pull access denied for nope")
        with pytest.raises(docker.errors.ImageNotFound):
            jobs.create_server("mc1", ENV, PORTS, "nope", "/data")
        assert server_row()["state"] == "failed"

    def test_server_deleted_while_creating_stays_deleted(self, add_server, server_row, docker_fake):
        add_server(state="deleted")
        jobs.create_server("mc1", ENV, PORTS, IMAGE, "/data")
        assert server_row()["state"] == "deleted"


# ---------------------------------------------------------------------------
# recreate_server (applying new settings)
# ---------------------------------------------------------------------------
class TestRecreate:
    NEW_ENV = {"EULA": "true", "MAX_PLAYERS": "40"}

    def test_new_style_server_reuses_its_named_volume(self, add_server, server_row, docker_fake):
        add_server(state="updating")
        old = docker_fake.containers.add("mc1", mounts=[{"Name": "playhub-mc1-data", "Destination": "/data"}])
        assert jobs.recreate_server("mc1", self.NEW_ENV, PORTS, IMAGE, "/data") == "Finished"

        run = docker_fake.containers.runs[0]
        assert run["environment"] == self.NEW_ENV
        assert run["volumes"] == {"playhub-mc1-data": {"bind": "/data", "mode": "rw"}}
        assert "volumes_from" not in run
        actions = [entry[0] for entry in docker_fake.log]
        assert actions == ["stop", "rename", "run", "remove"]
        assert docker_fake.log[0] == ("stop", "mc1", jobs.STOP_TIMEOUT_SECONDS)
        assert docker_fake.log[1][2].startswith("mc1-replaced-")
        assert docker_fake.log[3] == ("remove", docker_fake.log[1][2], {"force": False, "v": False})  # volumes kept

        row = server_row()
        new = docker_fake.containers.by_name["mc1"]
        assert new is not old
        assert (row["state"], row["container_id"], row["status_message"]) == ("running", new.id, None)

    def test_legacy_server_inherits_its_old_volumes(self, add_server, docker_fake):
        """Servers created before named volumes keep their world through volumes_from."""
        add_server(state="updating")
        old = docker_fake.containers.add("mc1", mounts=[{"Name": "3f2a9c0d", "Destination": "/data"}])
        jobs.recreate_server("mc1", self.NEW_ENV, PORTS, IMAGE, "/data")
        run = docker_fake.containers.runs[0]
        assert run["volumes_from"] == [old.id]
        assert "volumes" not in run

    def test_container_without_mounts_gets_a_named_volume(self, add_server, docker_fake):
        add_server(state="updating")
        docker_fake.containers.add("mc1", mounts=[])
        jobs.recreate_server("mc1", self.NEW_ENV, PORTS, IMAGE, "/data")
        assert docker_fake.containers.runs[0]["volumes"] == {"playhub-mc1-data": {"bind": "/data", "mode": "rw"}}

    def test_game_without_a_data_path(self, add_server, docker_fake):
        add_server(state="updating")
        old = docker_fake.containers.add("mc1", mounts=[{"Name": "anon", "Destination": "/x"}])
        jobs.recreate_server("mc1", self.NEW_ENV, PORTS, IMAGE, None)
        run = docker_fake.containers.runs[0]
        assert run.get("volumes_from") == [old.id] and "volumes" not in run

    def test_game_without_a_data_path_or_mounts(self, add_server, docker_fake):
        add_server(state="updating")
        docker_fake.containers.add("mc1", mounts=[])
        jobs.recreate_server("mc1", self.NEW_ENV, PORTS, IMAGE, None)
        run = docker_fake.containers.runs[0]
        assert "volumes" not in run and "volumes_from" not in run

    def test_stopped_server_also_ends_up_running(self, add_server, server_row, docker_fake):
        add_server(state="updating")
        docker_fake.containers.add("mc1", status="exited", mounts=[{"Name": "playhub-mc1-data"}])
        jobs.recreate_server("mc1", self.NEW_ENV, PORTS, IMAGE, "/data")
        assert server_row()["state"] == "running"

    def test_missing_container_is_created_from_scratch(self, add_server, server_row, docker_fake):
        add_server(state="updating")
        jobs.recreate_server("mc1", self.NEW_ENV, PORTS, IMAGE, "/data")
        assert [e[0] for e in docker_fake.log] == ["run"]
        assert server_row()["state"] == "running"

    def test_failure_restores_the_old_container(self, add_server, server_row, server_events, docker_fake):
        add_server(state="updating")
        old = docker_fake.containers.add("mc1", mounts=[{"Name": "playhub-mc1-data"}])
        docker_fake.containers.run_error = api_error("port is already allocated")
        with pytest.raises(docker.errors.APIError):
            jobs.recreate_server("mc1", self.NEW_ENV, PORTS, IMAGE, "/data")

        assert docker_fake.containers.by_name["mc1"] is old
        assert old.status == "running"
        assert [e[0] for e in docker_fake.log] == ["stop", "rename", "run", "reload", "rename", "start"]
        row = server_row()
        assert row["state"] == "running"  # it's back as it was
        assert row["status_message"] == "Failed to apply settings: port is already allocated"
        assert server_events() == [("failed", None, "Couldn't apply settings: port is already allocated")]

    def test_new_container_that_fails_to_start_is_cleaned_up(self, add_server, server_row, docker_fake):
        """Docker creates the container before starting it; a failed start leaves it holding the name."""
        add_server(state="updating")
        old = docker_fake.containers.add("mc1", mounts=[{"Name": "playhub-mc1-data"}])
        docker_fake.containers.start_error = api_error("failed to bind host port 0.0.0.0:10000/tcp: address already in use")
        with pytest.raises(docker.errors.APIError):
            jobs.recreate_server("mc1", self.NEW_ENV, PORTS, IMAGE, "/data")
        assert docker_fake.containers.by_name == {"mc1": old}
        assert old.status == "running"
        removed = [e for e in docker_fake.log if e[0] == "remove"]
        assert removed == [("remove", "mc1", {"force": True, "v": False})]  # the new one; volumes kept
        assert server_row()["state"] == "running"

    def test_failure_on_a_stopped_server_leaves_it_stopped(self, add_server, server_row, docker_fake):
        add_server(state="updating")
        old = docker_fake.containers.add("mc1", status="exited", mounts=[{"Name": "playhub-mc1-data"}])
        docker_fake.containers.run_error = api_error("no space left on device")
        with pytest.raises(docker.errors.APIError):
            jobs.recreate_server("mc1", self.NEW_ENV, PORTS, IMAGE, "/data")
        assert old.status == "exited"
        assert ("start", "mc1") not in docker_fake.log
        assert server_row()["state"] == "exited"

    def test_failure_to_stop(self, add_server, server_row, docker_fake):
        add_server(state="updating")
        old = docker_fake.containers.add("mc1", mounts=[{"Name": "playhub-mc1-data"}])
        old.fail["stop"] = api_error("container is restarting")
        with pytest.raises(docker.errors.APIError):
            jobs.recreate_server("mc1", self.NEW_ENV, PORTS, IMAGE, "/data")
        assert old.name == "mc1"  # never renamed
        assert docker_fake.containers.runs == []
        assert server_row()["state"] == "running"

    def test_failure_to_restore_is_logged(self, add_server, server_row, docker_fake, caplog):
        add_server(state="updating")
        old = docker_fake.containers.add("mc1", mounts=[{"Name": "playhub-mc1-data"}])
        docker_fake.containers.run_error = api_error("boom")
        old.fail["start"] = api_error("cannot start")
        with pytest.raises(docker.errors.APIError):
            jobs.recreate_server("mc1", self.NEW_ENV, PORTS, IMAGE, "/data")
        assert "Failed to restore old container for mc1" in caplog.text
        assert server_row()["status_message"] == "Failed to apply settings: boom"

    def test_old_container_that_cannot_be_removed_is_left_behind(self, add_server, server_row, docker_fake, caplog):
        add_server(state="updating")
        old = docker_fake.containers.add("mc1", mounts=[{"Name": "playhub-mc1-data"}])
        old.fail["remove"] = api_error("removal in progress")
        assert jobs.recreate_server("mc1", self.NEW_ENV, PORTS, IMAGE, "/data") == "Finished"
        assert "Could not remove replaced container" in caplog.text
        assert server_row()["state"] == "running"

    def test_docker_unreachable(self, add_server, server_row, server_events, docker_fake):
        add_server(state="updating")
        docker_fake.containers.get_error = api_error("proxy unreachable")
        with pytest.raises(docker.errors.APIError):
            jobs.recreate_server("mc1", self.NEW_ENV, PORTS, IMAGE, "/data")
        assert server_row()["state"] == "failed"
        assert server_events() == [("failed", None, "Couldn't apply settings: proxy unreachable")]


# ---------------------------------------------------------------------------
# start / stop / restart
# ---------------------------------------------------------------------------
class TestLifecycle:
    @pytest.fixture
    def container(self, add_server, docker_fake):
        def make(state, status):
            add_server(state=state, status_message="Stopped unexpectedly (exit code 1)")
            return docker_fake.containers.add("mc1", status=status)
        return make

    def test_stop(self, container, server_row, docker_fake):
        c = container("stopping", "running")
        assert jobs.stop_server("mc1") == "Finished"
        assert docker_fake.log == [("stop", "mc1", jobs.STOP_TIMEOUT_SECONDS)]
        assert c.status == "exited"
        assert (server_row()["state"], server_row()["status_message"]) == ("exited", None)

    def test_start(self, container, server_row, docker_fake):
        container("starting", "exited")
        assert jobs.start_server("mc1") == "Finished"
        assert docker_fake.log == [("start", "mc1")]
        assert (server_row()["state"], server_row()["status_message"]) == ("running", None)

    def test_restart(self, container, server_row, docker_fake):
        container("restarting", "running")
        assert jobs.restart_server("mc1") == "Finished"
        assert docker_fake.log == [("restart", "mc1", jobs.STOP_TIMEOUT_SECONDS)]
        assert server_row()["state"] == "running"

    def test_failed_stop_leaves_it_running(self, container, server_row, server_events):
        c = container("stopping", "running")
        c.fail["stop"] = api_error("timeout")
        with pytest.raises(docker.errors.APIError):
            jobs.stop_server("mc1")
        assert (server_row()["state"], server_row()["status_message"]) == ("running", "Failed to stop: timeout")
        assert server_events() == [("failed", None, "Couldn't stop: timeout")]

    def test_failed_start(self, container, server_row, server_events):
        c = container("starting", "exited")
        c.fail["start"] = api_error("port is already allocated")
        with pytest.raises(docker.errors.APIError):
            jobs.start_server("mc1")
        assert (server_row()["state"], server_row()["status_message"]) == ("failed", "Failed to start: port is already allocated")
        assert server_events() == [("failed", None, "Couldn't start: port is already allocated")]

    def test_failed_restart(self, container, server_row):
        c = container("restarting", "running")
        c.fail["restart"] = api_error("boom")
        with pytest.raises(docker.errors.APIError):
            jobs.restart_server("mc1")
        assert server_row()["state"] == "failed"

    @pytest.mark.parametrize("job, settled", [
        (jobs.start_server, "failed"), (jobs.stop_server, "running"), (jobs.restart_server, "failed"),
    ])
    def test_container_gone(self, add_server, server_row, docker_fake, job, settled):
        add_server(state="starting")
        with pytest.raises(docker.errors.NotFound):
            job("mc1")
        assert server_row()["state"] == settled
        assert "No such container: mc1" in server_row()["status_message"]


# ---------------------------------------------------------------------------
# delete_server
# ---------------------------------------------------------------------------
class TestDelete:
    def test_removes_the_container_and_its_volume(self, add_server, docker_fake):
        add_server("mc1 (deleted #1)", state="deleted")
        docker_fake.containers.add("mc1")
        docker_fake.volumes.names.add("playhub-mc1-data")
        assert jobs.delete_server("mc1") == "Finished"
        assert docker_fake.log == [
            ("remove", "mc1", {"force": True, "v": True}),
            ("remove-volume", "playhub-mc1-data", True),
        ]
        assert "mc1" not in docker_fake.containers.by_name
        assert docker_fake.volumes.names == set()

    def test_already_gone(self, docker_fake):
        assert jobs.delete_server("mc1") == "Finished"
        assert docker_fake.log == []

    def test_legacy_server_without_a_named_volume(self, docker_fake):
        docker_fake.containers.add("mc1")
        assert jobs.delete_server("mc1") == "Finished"
        assert [e[0] for e in docker_fake.log] == ["remove"]

    def test_does_not_touch_a_new_server_with_the_same_name(self, add_server, server_row, docker_fake):
        """Delete mc1, create a new mc1, then the delete job runs: the new row must survive."""
        add_server("mc1 (deleted #1)", state="deleted", port=None)
        add_server("mc1", state="starting", port=10000)
        jobs.delete_server("mc1")
        assert server_row("mc1")["state"] == "starting"

    def test_docker_failure_is_raised(self, docker_fake, caplog):
        c = docker_fake.containers.add("mc1")
        c.fail["remove"] = api_error("device busy")
        with pytest.raises(docker.errors.APIError):
            jobs.delete_server("mc1")
        assert "Failed to delete server mc1" in caplog.text


def test_jobs_are_importable_by_the_names_the_api_enqueues():
    """The API enqueues jobs by dotted path; a rename here would break it silently."""
    import importlib
    for name in ("create_server", "recreate_server", "start_server", "stop_server", "restart_server", "delete_server"):
        module, _, func = f"tasks.dockerjobs.{name}".rpartition(".")
        assert callable(getattr(importlib.import_module(module), func))
