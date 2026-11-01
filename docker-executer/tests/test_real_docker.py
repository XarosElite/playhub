"""
The worker against a real Docker daemon. Opt-in, because it creates and
deletes containers and volumes:

    RUN_DOCKER_TESTS=1 pytest tests/test_real_docker.py

Uses the small redis:7 image as a stand-in game server (it runs until stopped
and keeps its data in /data, like the real games). Only touches containers and
volumes named playhub-itest-*, and removes them afterwards.
"""
import os
import uuid

import docker
import pytest

from tasks import dockerjobs as jobs

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DOCKER_TESTS") != "1", reason="set RUN_DOCKER_TESTS=1 to run")

IMAGE = os.environ.get("DOCKER_TEST_IMAGE", "redis:7")
PORT_KEY = "6379/tcp"


@pytest.fixture(scope="module")
def real_docker():
    client = docker.from_env()
    try:
        client.ping()
    except Exception as e:
        pytest.skip(f"Docker is not reachable: {e}")
    try:
        client.images.get(IMAGE)
    except docker.errors.ImageNotFound:
        client.images.pull(IMAGE)
    yield client
    client.close()


@pytest.fixture
def name(real_docker, monkeypatch, add_server):
    server = f"playhub-itest-{uuid.uuid4().hex[:8]}"
    monkeypatch.setattr(jobs, "client", real_docker)
    add_server(server, state="starting")
    yield server
    for container in real_docker.containers.list(all=True, filters={"name": server}):
        container.remove(force=True, v=True)
    try:
        real_docker.volumes.get(jobs.volume_name(server)).remove(force=True)
    except docker.errors.NotFound:
        pass


def write_marker(container, content="world-save-1"):
    exit_code, _ = container.exec_run(["sh", "-c", f"echo {content} > /data/marker"])
    assert exit_code == 0


def read_marker(container):
    exit_code, output = container.exec_run(["cat", "/data/marker"])
    return output.decode().strip() if exit_code == 0 else None


@pytest.fixture
def busy_port(real_docker):
    """A host port that is in use. Held by a container (not a local socket) so
    it is busy from the Docker daemon's point of view even when these tests run
    inside a container themselves."""
    holder = real_docker.containers.run(IMAGE, name=f"playhub-itest-holder-{uuid.uuid4().hex[:8]}",
                                        ports={PORT_KEY: None}, detach=True)
    holder.reload()
    yield holder.attrs["NetworkSettings"]["Ports"][PORT_KEY][0]["HostPort"]
    holder.remove(force=True, v=True)


@pytest.fixture
def free_port(real_docker):
    """A host port Docker just handed out and released."""
    probe = real_docker.containers.run(IMAGE, name=f"playhub-itest-probe-{uuid.uuid4().hex[:8]}",
                                       ports={PORT_KEY: None}, detach=True)
    probe.reload()
    port = probe.attrs["NetworkSettings"]["Ports"][PORT_KEY][0]["HostPort"]
    probe.remove(force=True, v=True)
    return port


def test_full_lifecycle_keeps_the_world(real_docker, name, server_row):
    data_path = "/data"
    jobs.create_server(name, {"PLAYHUB": "1"}, {PORT_KEY: None}, IMAGE, data_path)
    container = real_docker.containers.get(name)
    assert container.status in ("running", "created")
    container.reload()
    assert container.status == "running"
    assert server_row(name)["state"] == "running"
    assert server_row(name)["container_id"] == container.id
    assert any(m.get("Name") == jobs.volume_name(name) and m["Destination"] == data_path
               for m in container.attrs["Mounts"])
    assert "PLAYHUB=1" in container.attrs["Config"]["Env"]
    write_marker(container)

    jobs.stop_server(name)
    container.reload()
    assert container.status == "exited"
    assert server_row(name)["state"] == "exited"

    jobs.start_server(name)
    container.reload()
    assert container.status == "running"
    assert read_marker(container) == "world-save-1"

    jobs.restart_server(name)
    container.reload()
    assert container.status == "running"

    jobs.recreate_server(name, {"PLAYHUB": "2"}, {PORT_KEY: None}, IMAGE, data_path)
    new = real_docker.containers.get(name)
    assert new.id != container.id
    assert "PLAYHUB=2" in new.attrs["Config"]["Env"]
    assert read_marker(new) == "world-save-1"  # the world survived new settings
    assert server_row(name)["container_id"] == new.id
    assert real_docker.containers.list(all=True, filters={"name": f"{name}-replaced"}) == []

    jobs.delete_server(name)
    with pytest.raises(docker.errors.NotFound):
        real_docker.containers.get(name)
    with pytest.raises(docker.errors.NotFound):
        real_docker.volumes.get(jobs.volume_name(name))


def test_publishes_the_requested_host_port(real_docker, name, free_port):
    jobs.create_server(name, {}, {PORT_KEY: free_port}, IMAGE, "/data")
    container = real_docker.containers.get(name)
    assert container.attrs["HostConfig"]["PortBindings"][PORT_KEY][0]["HostPort"] == free_port


def test_legacy_container_keeps_its_anonymous_volume(real_docker, name, server_row):
    """A server created before named volumes (the image's anonymous /data volume)."""
    legacy = real_docker.containers.run(IMAGE, name=name, detach=True)
    jobs.update_server_db(name, container_id=legacy.id, state="updating")
    write_marker(legacy, "legacy-world")
    anonymous = [m["Name"] for m in legacy.attrs["Mounts"]]
    assert anonymous and jobs.volume_name(name) not in anonymous

    jobs.recreate_server(name, {"PLAYHUB": "2"}, {PORT_KEY: None}, IMAGE, "/data")
    new = real_docker.containers.get(name)
    assert read_marker(new) == "legacy-world"
    try:
        for volume in anonymous:
            real_docker.volumes.get(volume).remove(force=True)
    except docker.errors.APIError:
        pass


def test_failed_recreate_puts_the_old_server_back(real_docker, name, server_row, busy_port):
    jobs.create_server(name, {"PLAYHUB": "1"}, {PORT_KEY: None}, IMAGE, "/data")
    old = real_docker.containers.get(name)
    write_marker(old)

    with pytest.raises(docker.errors.APIError):
        jobs.recreate_server(name, {"PLAYHUB": "2"}, {PORT_KEY: busy_port}, IMAGE, "/data")

    restored = real_docker.containers.get(name)
    assert restored.id == old.id
    assert restored.status == "running"
    assert "PLAYHUB=1" in restored.attrs["Config"]["Env"]
    assert read_marker(restored) == "world-save-1"
    assert [c.name for c in real_docker.containers.list(all=True, filters={"name": name})] == [name]
    row = server_row(name)
    assert row["state"] == "running"
    assert row["status_message"].startswith("Failed to apply settings:")


def test_failed_create_marks_the_server_failed(real_docker, name, server_row, busy_port):
    with pytest.raises(docker.errors.APIError):
        jobs.create_server(name, {}, {PORT_KEY: busy_port}, IMAGE, "/data")
    row = server_row(name)
    assert row["state"] == "failed"
    assert row["status_message"].startswith("Failed to create:")


def test_create_after_a_failed_create(real_docker, name, server_row, busy_port):
    with pytest.raises(docker.errors.APIError):
        jobs.create_server(name, {}, {PORT_KEY: busy_port}, IMAGE, "/data")
    jobs.create_server(name, {}, {PORT_KEY: None}, IMAGE, "/data")
    assert real_docker.containers.get(name).status in ("running", "created")
    assert server_row(name)["state"] == "running"


def test_missing_image(real_docker, name, server_row):
    with pytest.raises(docker.errors.APIError):
        jobs.create_server(name, {}, {PORT_KEY: None}, "playhub-itest/does-not-exist:never", "/data")
    assert server_row(name)["state"] == "failed"
