import socket
import logging
from typing import Annotated, Optional
from fastapi import Depends, Request, HTTPException
from redis import Redis
from rq import Queue
from sqlalchemy import select

from app.database import get_db
from app.models.servers import Server
from app.validators.gamevalidators import *

def log_request(request: Request):
    logging.info(f"Custom Log Dep ---> Request to {request.url} from {request.client.host}")

redis_conn = Redis(host='redis', port=6379, db=0)
redis_queue = Queue("default", connection=redis_conn)

async def get_redis() -> Redis:
    return redis_conn

async def get_redis_queue() -> Queue:
    return redis_queue

r_queue = Annotated[Queue, Depends(get_redis_queue)]

async def load_game_validator(request: Request):
    body = await request.json()
    game_type = BaseGameValidator.model_validate(body).game_type

    match game_type:
        case "minecraft":
            return MinecraftGameValidator.model_validate(body)
        case "palworld":
            return PalworldGameValidator.model_validate(body)
        case _:
            raise HTTPException(400, f"Unknown game type '{game_type}'")

PORT_LOWER = 10000
PORT_UPPER = 10250

def is_port_available_on_host(port: int) -> bool:
    """
    Checks if a port can be bound on the local interface.
    """
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
    """
    stmt = select(Server.port).where(Server.state != 'deleted')
    db_used_ports = set(db.scalars(stmt).all())

    if requested_port and requested_port not in db_used_ports:
        if is_port_available_on_host(requested_port):
            return requested_port

    for port in range(PORT_LOWER, PORT_UPPER + 1):
        if port not in db_used_ports and is_port_available_on_host(port):
            return port

    raise HTTPException(status_code=507, detail="No available server ports in the range 10000-10250")
