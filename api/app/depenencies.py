from fastapi import Depends, Request, HTTPException
from typing import Annotated
import logging
from redis import Redis
from rq import Queue
from queue import Queue as q
from app.validators.gamevalidators import *

async def common_parameters(q: str | None = None, skip: int = 0, limit: int = 100):
    return {"q": q, "skip": skip, "limit": limit}

def log_request(request: Request):
    logging.info(f"Custom Log Dep ---> Request to {request.url} from {request.client.host}")

CommonDeps = Annotated[dict, Depends(common_parameters)]

redis_conn = Redis(host='redis', port=6379, db=0)
redis_queue = Queue("default", connection=redis_conn)

async def get_redis() -> Redis:
    return redis_conn

async def get_redis_queue() -> Queue:
    return redis_queue

r_queue = Annotated[Queue, Depends(get_redis_queue)]

async def load_game_validator(request:Request):
    body = await request.json()
    game_type = BaseGameValidator.model_validate(body).game_type

    match game_type:
        case "minecraft":
            return MinecraftGameValidator.model_validate(body)
        case "palworld":
            return PalworldGameValidator.model_validate(body)
        case _:
            raise HTTPException(400, f"Unknown type '{game_type}'")


port_lower = 10000
port_uppper = 10250

free_ports = q(maxsize=port_uppper-port_lower)
used_ports = []

for i in range(port_uppper-port_lower):
    free_ports.put(i)

def get_free_port():
    port = free_ports.get()
    used_ports.append(port)
    return port_lower + port

def free_port(port):
    used_ports.remove(port)
    free_ports.put(port)

    


