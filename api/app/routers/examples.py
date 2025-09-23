from fastapi import APIRouter
from rq import Queue
from redis import Redis

redis_conn = Redis(host='redis', port=6379, db=0)
redis_queue = Queue("default", connection=redis_conn)


router = APIRouter(
    prefix="/examples",
    tags=["examples"],
    dependencies=[],
    responses={404: {"description": "Not found"}},
)

# @router.get("/examples/{username}", tags=["examples"])
# async def read_user(username: str):
#     return {"username": username}

@router.get("/examples/rq", tags=["examples"])
async def readq():
    redis_queue.enqueue("tasks.jobs.goob")
    return {"RQ": "enqueued"}
