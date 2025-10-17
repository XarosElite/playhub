from fastapi import Depends, Request
from typing import Annotated
import logging
from redis import Redis
from rq import Queue

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
