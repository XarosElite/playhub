"""Shared Docker client for the API (the worker has its own)."""
import os
import threading

import docker

_client = None
_lock = threading.Lock()


def get_docker() -> docker.DockerClient:
    """Lazily created so the API can start even if the Docker proxy is down."""
    global _client
    with _lock:
        if _client is None:
            _client = docker.DockerClient(base_url=os.environ.get("DOCKER_HOST", "tcp://docker-proxy:2375"))
        return _client
