"""An in-memory Docker that records what the worker does to it."""
import itertools

import docker

_ids = itertools.count(1)


class FakeContainer:
    def __init__(self, docker_fake, name, status="running", mounts=None, **run_kwargs):
        self._docker = docker_fake
        self.name = name
        self.id = f"cid-{name}-{next(_ids)}"
        self.status = status
        self.attrs = {"Mounts": mounts if mounts is not None else []}
        self.run_kwargs = run_kwargs
        self.fail = {}  # operation -> exception

    def _maybe_fail(self, operation):
        if operation in self.fail:
            raise self.fail[operation]

    def _log(self, *entry):
        self._docker.log.append(entry)

    def stop(self, timeout=None):
        self._maybe_fail("stop")
        self._log("stop", self.name, timeout)
        self.status = "exited"

    def start(self):
        self._maybe_fail("start")
        self._log("start", self.name)
        self.status = "running"

    def restart(self, timeout=None):
        self._maybe_fail("restart")
        self._log("restart", self.name, timeout)
        self.status = "running"

    def rename(self, new_name):
        self._maybe_fail("rename")
        self._log("rename", self.name, new_name)
        self._docker.containers.by_name.pop(self.name, None)
        self.name = new_name
        self._docker.containers.by_name[new_name] = self

    def reload(self):
        self._log("reload", self.name)

    def remove(self, force=False, v=False):
        self._maybe_fail("remove")
        self._log("remove", self.name, {"force": force, "v": v})
        self._docker.containers.by_name.pop(self.name, None)


class FakeContainers:
    def __init__(self, docker_fake):
        self._docker = docker_fake
        self.by_name: dict[str, FakeContainer] = {}
        self.run_error: Exception | None = None  # run() fails before creating anything
        # run() creates the container, then fails to start it (as Docker does when the port is taken).
        self.start_error: Exception | None = None
        self.get_error: Exception | None = None
        self.runs: list[dict] = []

    def add(self, name, **kwargs) -> FakeContainer:
        container = FakeContainer(self._docker, name, **kwargs)
        self.by_name[name] = container
        return container

    def get(self, name):
        if self.get_error:
            raise self.get_error
        if name in self.by_name:
            return self.by_name[name]
        raise docker.errors.NotFound(f"No such container: {name}")

    def run(self, **kwargs):
        self.runs.append(kwargs)
        self._docker.log.append(("run", kwargs["name"]))
        if self.run_error:
            raise self.run_error
        name = kwargs["name"]
        if name in self.by_name:
            raise docker.errors.APIError(f'Conflict. The container name "/{name}" is already in use')
        mounts = [{"Name": vol, "Destination": spec["bind"]} for vol, spec in (kwargs.get("volumes") or {}).items()]
        container = FakeContainer(self._docker, name, mounts=mounts)
        container.run_kwargs = kwargs
        self.by_name[name] = container
        if self.start_error:
            container.status = "created"
            raise self.start_error
        return container


class FakeVolume:
    def __init__(self, docker_fake, name):
        self._docker = docker_fake
        self.name = name

    def remove(self, force=False):
        self._docker.log.append(("remove-volume", self.name, force))
        self._docker.volumes.names.discard(self.name)


class FakeVolumes:
    def __init__(self, docker_fake):
        self._docker = docker_fake
        self.names: set[str] = set()

    def get(self, name):
        if name not in self.names:
            raise docker.errors.NotFound(f"No such volume: {name}")
        return FakeVolume(self._docker, name)


class FakeDocker:
    def __init__(self):
        self.log: list[tuple] = []
        self.containers = FakeContainers(self)
        self.volumes = FakeVolumes(self)
