"""In-memory stand-ins for RQ and the Docker SDK."""
import itertools
import socket
import threading

import docker


# ---------------------------------------------------------------------------
# RQ
# ---------------------------------------------------------------------------
class FakeJob:
    def __init__(self, job_id, func, args, meta):
        self.id = job_id
        self.func = func
        self.args = args
        self.meta = meta
        self.status = "queued"

    def get_status(self):
        return self.status


class FakeQueue:
    """Records enqueued jobs instead of sending them to Redis."""

    def __init__(self):
        self.jobs: dict[str, FakeJob] = {}
        self._ids = itertools.count(1)

    def enqueue(self, func, *args, meta=None):
        job = FakeJob(f"job-{next(self._ids)}", func, args, meta or {})
        self.jobs[job.id] = job
        return job

    def fetch_job(self, job_id):
        return self.jobs.get(job_id)

    @property
    def last(self) -> FakeJob:
        return list(self.jobs.values())[-1]

    def funcs(self):
        return [job.func for job in self.jobs.values()]


# ---------------------------------------------------------------------------
# Docker
# ---------------------------------------------------------------------------
def stats_sample(total_usage, system_usage, mem_usage_mb=600, mem_limit_mb=4096, inactive_file_mb=100):
    """A `container.stats(stream=False)` payload."""
    return {
        "cpu_stats": {"cpu_usage": {"total_usage": total_usage}, "system_cpu_usage": system_usage},
        "memory_stats": {
            "usage": mem_usage_mb * 2**20,
            "limit": mem_limit_mb * 2**20,
            "stats": {"inactive_file": inactive_file_mb * 2**20},
        },
    }


class FakeContainer:
    def __init__(self, name, id=None, status="running", exit_code=0, started_at="2026-11-01T10:00:00Z",
                 stats=None, mounts=None):
        self.name = name
        self.id = id or f"id-{name}"
        self.status = status
        self.attrs = {
            "State": {"ExitCode": exit_code, "StartedAt": started_at},
            "Mounts": mounts or [],
        }
        # A list of stats payloads returned in turn (the last one repeats), or an Exception.
        self.stats_samples = stats if stats is not None else [stats_sample(1000, 10_000), stats_sample(2000, 20_000)]
        self.stats_calls = 0

    def stats(self, stream=False, one_shot=True):
        if isinstance(self.stats_samples, Exception):
            raise self.stats_samples
        sample = self.stats_samples[min(self.stats_calls, len(self.stats_samples) - 1)]
        self.stats_calls += 1
        return sample


class FakeContainers:
    def __init__(self):
        self.by_key: dict[str, FakeContainer] = {}
        self.get_calls: list[str] = []
        self.error: Exception | None = None  # raised by get() when set

    def add(self, container: FakeContainer):
        self.by_key[container.name] = container
        self.by_key[container.id] = container

    def remove(self, key):
        container = self.by_key.get(key)
        if container:
            self.by_key.pop(container.name, None)
            self.by_key.pop(container.id, None)

    def get(self, key):
        self.get_calls.append(key)
        if self.error:
            raise self.error
        if key in self.by_key:
            return self.by_key[key]
        raise docker.errors.NotFound(f"No such container: {key}")


class FakeLogStream:
    def __init__(self, chunks, block=False):
        self.chunks = list(chunks)
        self.closed = threading.Event()
        self.block = block  # keep following (like a running container) until closed

    def __iter__(self):
        for chunk in self.chunks:
            yield chunk
        if self.block:
            self.closed.wait(5)

    def close(self):
        self.closed.set()


class FakeExecSocket:
    """
    One end of a socketpair; the other end plays the container's shell, which
    echoes back whatever it receives prefixed with "echo:".
    """

    def __init__(self, banner=b"/ # "):
        self._sock, self.shell = socket.socketpair()
        self.received = []
        self.shell.sendall(banner)
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        try:
            while True:
                data = self.shell.recv(4096)
                if not data:
                    return
                self.received.append(data)
                self.shell.sendall(b"echo:" + data)
        except OSError:
            pass

    def exit_shell(self):
        """The shell exits (e.g. the user typed `exit`)."""
        try:
            self.shell.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.shell.close()


class FakeDockerAPI:
    def __init__(self):
        self.log_streams: dict[str, FakeLogStream] = {}
        self.logs_error: Exception | None = None
        self.logs_calls: list[tuple] = []
        self.exec_commands: list[tuple] = []
        self.exec_fail_commands: set[str] = set()
        self.exec_sockets: list[FakeExecSocket] = []

    def logs(self, container, **kwargs):
        self.logs_calls.append((container, kwargs))
        if self.logs_error:
            raise self.logs_error
        return self.log_streams.get(container) or FakeLogStream([])

    def exec_create(self, container, cmd, **kwargs):
        self.exec_commands.append((container, tuple(cmd)))
        if cmd[0] in self.exec_fail_commands:
            raise docker.errors.APIError(f"{cmd[0]}: not found")
        return {"Id": f"exec-{len(self.exec_commands)}"}

    def exec_start(self, exec_id, **kwargs):
        sock = FakeExecSocket()
        self.exec_sockets.append(sock)
        return sock


class FakeDocker:
    def __init__(self):
        self.containers = FakeContainers()
        self.api = FakeDockerAPI()
        self.closed = False

    def add_container(self, name, **kwargs) -> FakeContainer:
        container = FakeContainer(name, **kwargs)
        self.containers.add(container)
        return container

    def close(self):
        self.closed = True
