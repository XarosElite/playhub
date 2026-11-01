"""
Background monitor for game servers. Every few seconds it:

* reconciles each server's DB state with its container (e.g. a server whose
  container crashed is marked exited, with the exit code, and an activity
  event is recorded),
* samples CPU and memory for running containers, keeping a short history for
  the dashboard sparklines,
* reads player counts for games that support a status query.

Results are kept in memory and attached to server payloads by the routers.
"""
import datetime
import logging
import os
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import docker
from sqlalchemy import select

from app.database import SessionLocal
from app.internal.config import GAMES
from app.internal.docker_client import get_docker
from app.internal.events import record_event
from app.internal.mcping import ping
from app.models.servers import SETTLED_STATES, Server

POLL_SECONDS = 3
HISTORY_LENGTH = 40  # ~2 minutes at POLL_SECONDS
# Address the API uses to reach game servers' published ports on the Docker host.
GAME_HOST = os.environ.get("GAME_HOST", "host.docker.internal")

_lock = threading.Lock()
_live: dict[int, dict] = {}
_history: dict[int, deque] = {}
_prev_cpu: dict[str, tuple[int, int]] = {}
_stop = threading.Event()
_thread: Optional[threading.Thread] = None
_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="live")


def get_live(server_id: int, with_history: bool = True) -> Optional[dict]:
    """Latest stats for a running server, or None."""
    with _lock:
        snapshot = _live.get(server_id)
        if snapshot is None:
            return None
        result = dict(snapshot)
        if with_history:
            result["history"] = list(_history.get(server_id, ()))
        return result


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _cpu_percent(container_id: str, stats: dict) -> Optional[float]:
    """CPU use as a percentage of the whole host, from the change since the last sample."""
    cpu = stats.get("cpu_stats") or {}
    total = (cpu.get("cpu_usage") or {}).get("total_usage")
    system = cpu.get("system_cpu_usage")
    if total is None or system is None:
        return None
    previous = _prev_cpu.get(container_id)
    _prev_cpu[container_id] = (total, system)
    if previous is None:
        return None
    d_total, d_system = total - previous[0], system - previous[1]
    if d_system <= 0 or d_total < 0:
        return 0.0
    return round(d_total / d_system * 100, 1)


def _memory_mb(stats: dict) -> tuple[Optional[float], Optional[float]]:
    mem = stats.get("memory_stats") or {}
    usage = mem.get("usage")
    if usage is None:
        return None, None
    detail = mem.get("stats") or {}
    # Exclude reclaimable page cache, like `docker stats` does.
    cache = detail.get("inactive_file") or detail.get("total_inactive_file") or 0
    limit = mem.get("limit")
    return round((usage - cache) / 2**20, 1), (round(limit / 2**20, 1) if limit else None)


def _inspect(client, server: Server):
    try:
        return client.containers.get(server.container_id or server.name)
    except docker.errors.NotFound:
        return None


def _reconcile(db, server: Server, container) -> None:
    """Fix up a settled server's state if its container disagrees."""
    if server.state not in SETTLED_STATES:
        return  # a job is in flight; the worker will settle it
    if container is None:
        if server.state != "failed" and server.container_id:
            server.state = "failed"
            server.status_message = "The server's container no longer exists"
            record_event(db, server, None, "missing", server.status_message)
        return

    status = container.status
    if server.state == "running" and status != "running":
        exit_code = (container.attrs.get("State") or {}).get("ExitCode")
        server.state = "exited"
        server.status_message = f"Stopped unexpectedly (exit code {exit_code})"
        record_event(db, server, None, "crashed", server.status_message)
    elif server.state in ("exited", "failed") and status == "running":
        server.state = "running"
        server.status_message = None


def _sample(server_id: int, game_type: str, port: int, container) -> dict:
    snapshot: dict = {"cpu_pct": None, "mem_used_mb": None, "mem_limit_mb": None, "players": None}
    started_at = (container.attrs.get("State") or {}).get("StartedAt")
    snapshot["started_at"] = started_at

    try:
        stats = container.stats(stream=False, one_shot=True)
        snapshot["cpu_pct"] = _cpu_percent(container.id, stats)
        snapshot["mem_used_mb"], snapshot["mem_limit_mb"] = _memory_mb(stats)
    except Exception as e:
        logging.debug(f"Stats failed for server {server_id}: {e}")

    if (GAMES.get(game_type) or {}).get("status_query") == "minecraft" and port:
        try:
            snapshot["players"] = ping(GAME_HOST, port)
        except Exception:
            pass  # not accepting connections yet (still booting) or unreachable
    return snapshot


def poll_once() -> None:
    client = get_docker()
    with SessionLocal() as db:
        servers = db.scalars(select(Server).where(Server.state != "deleted")).all()
        containers = {s.id: _inspect(client, s) for s in servers}
        for server in servers:
            _reconcile(db, server, containers[server.id])
        db.commit()
        running = [
            (s.id, s.game_type, s.port, containers[s.id])
            for s in servers
            if s.state == "running" and containers[s.id] is not None and containers[s.id].status == "running"
        ]

    samples = list(_executor.map(lambda args: (args[0], _sample(*args)), running))
    now = _now_iso()
    with _lock:
        running_ids = {server_id for server_id, _ in samples}
        for server_id in list(_live):
            if server_id not in running_ids:
                _live.pop(server_id, None)
                _history.pop(server_id, None)
        for server_id, snapshot in samples:
            snapshot["updated"] = now
            _live[server_id] = snapshot
            history = _history.setdefault(server_id, deque(maxlen=HISTORY_LENGTH))
            history.append({"time": now, "cpu_pct": snapshot["cpu_pct"], "mem_used_mb": snapshot["mem_used_mb"]})


def _run():
    last_error_log = 0.0
    while not _stop.is_set():
        started = time.monotonic()
        try:
            poll_once()
        except Exception as e:
            if time.monotonic() - last_error_log > 60:
                logging.warning(f"Server monitor poll failed: {e}")
                last_error_log = time.monotonic()
        _stop.wait(max(0.0, POLL_SECONDS - (time.monotonic() - started)))


def start_monitor():
    global _thread
    if _thread is None:
        _stop.clear()
        _thread = threading.Thread(target=_run, name="server-monitor", daemon=True)
        _thread.start()


def stop_monitor():
    _stop.set()
