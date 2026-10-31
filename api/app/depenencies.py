import logging
from typing import Annotated, Optional, Any
from fastapi import Depends, Request, HTTPException
from redis import Redis
from rq import Queue
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.models.servers import Server
from app.internal.config import GAMES, EnvironmentValidationError, validate_environment

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
# Server creation payload
# ---------------------------------------------------------------------------
class CreateServerPayload(BaseModel):
    name: str
    game_type: str
    # Typed settings keyed by field name (stored in the DB).
    settings: dict[str, Any]
    # String env vars keyed by container env var name (passed to Docker).
    container_env: dict[str, str]


async def load_game_validator(request: Request) -> CreateServerPayload:
    """Validate a server-creation payload against the game's schema in games.yaml."""
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="Request body must be JSON")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Request body must be an object")

    game_type = body.get("game_type")
    game = GAMES.get(game_type) if isinstance(game_type, str) else None
    if game is None:
        raise HTTPException(status_code=400, detail=f"Unsupported or missing game_type: '{game_type}'")

    server_name = body.get("name")
    if not isinstance(server_name, str) or not server_name.strip():
        raise HTTPException(status_code=422, detail="Server 'name' is required")

    try:
        settings, container_env = validate_environment(game, body.get("environment"))
    except EnvironmentValidationError as e:
        raise HTTPException(status_code=422, detail={"msg": str(e), "fields": e.errors})

    return CreateServerPayload(
        name=server_name.strip(),
        game_type=game_type,
        settings=settings,
        container_env=container_env,
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
