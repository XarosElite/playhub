import yaml
import logging
from pathlib import Path
from typing import Annotated, Optional, Any
from fastapi import Depends, Request, HTTPException
from redis import Redis
from rq import Queue
from sqlalchemy import select
from pydantic import BaseModel, ConfigDict, Field

from app.database import get_db
from app.models.servers import Server

# ---------------------------------------------------------------------------
# Game definition registry – loaded once at module import time.
# ---------------------------------------------------------------------------
GAMES_YAML_PATH = Path(__file__).resolve().parent.parent / "games.yaml"

with open(GAMES_YAML_PATH) as f:
    _RAW_GAMES = yaml.safe_load(f)

GLOBAL_COMMON_FIELDS: dict[str, dict] = _RAW_GAMES.get("common_fields", {})
GAME_REGISTRY: dict[str, dict] = {
    _gt: _gd for _gt, _gd in _RAW_GAMES.items() if _gt != "common_fields"
}

# ---------------------------------------------------------------------------
# Port constants (Automatic host port allocation range)
# ---------------------------------------------------------------------------
PORT_LOWER = 10000
PORT_UPPER = 10250

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------
redis_conn = Redis(host='redis', port=6379, db=0)
redis_queue = Queue("default", connection=redis_conn)


async def get_redis() -> Redis:
    return redis_conn


async def get_redis_queue() -> Queue:
    return redis_queue


r_queue = Annotated[Queue, Depends(get_redis_queue)]

# ---------------------------------------------------------------------------
# Dynamic Game Creation Payload Model
# ---------------------------------------------------------------------------
class DynamicPortValidator(BaseModel):
    primary_port: int = Field(default=0)


class DynamicGamePayload(BaseModel):
    name: str
    game_type: str
    environment: dict[str, Any] = Field(default_factory=dict)
    ports: DynamicPortValidator = Field(default_factory=DynamicPortValidator)

    model_config = ConfigDict(extra='allow')


async def load_game_validator(request: Request) -> DynamicGamePayload:
    """Validate server-creation payload dynamically supporting any game in GAME_REGISTRY."""
    body = await request.json()

    game_type = body.get("game_type")
    if not game_type or game_type not in GAME_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Unsupported or missing game_type: '{game_type}'")

    server_name = body.get("name")
    if not server_name:
        raise HTTPException(status_code=422, detail="Server 'name' is required")

    ports_data = body.get("ports", {})
    if isinstance(ports_data, int):
        ports_data = {"primary_port": ports_data}
    elif not isinstance(ports_data, dict):
        ports_data = {}

    if "primary_port" not in ports_data and "primary_port" in body:
        ports_data["primary_port"] = body["primary_port"]

    env_data = body.get("environment", {})
    if not isinstance(env_data, dict):
        env_data = {}

    return DynamicGamePayload(
        name=server_name,
        game_type=game_type,
        environment=env_data,
        ports=DynamicPortValidator(primary_port=int(ports_data.get("primary_port", 0)))
    )


def is_port_available_on_host(port: int) -> bool:
    """Checks if a port can be bound on the local interface."""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(('0.0.0.0', port))
            return True
        except Exception:
            return False


def get_next_available_port(requested_port: Optional[int] = None, db = Depends(get_db)) -> int:
    """
    Dynamically finds the next available port using PostgreSQL database records and host socket checks.
    Defaults to automatically finding the next free port in the range 10000-10250.
    """
    stmt = select(Server.port).where(Server.state != 'deleted')
    db_used_ports = set(db.scalars(stmt).all())

    if requested_port and requested_port > 0 and requested_port not in db_used_ports:
        if is_port_available_on_host(requested_port):
            return requested_port

    for port in range(PORT_LOWER, PORT_UPPER + 1):
        if port not in db_used_ports and is_port_available_on_host(port):
            return port

    raise HTTPException(status_code=507, detail="No available server ports in the range 10000-10250")
