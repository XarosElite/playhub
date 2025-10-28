from fastapi import APIRouter, Depends, Request
from app.depenencies import CommonDeps, log_request, r_queue

router = APIRouter(
    prefix="/examples",
    tags=["examples"],
    dependencies=[Depends(log_request)],
    responses={404: {"description": "Not found"}},
)

# @router.get("/examples/{username}", tags=["examples"])
# async def read_user(username: str):
#     return {"username": username}

@router.get("/examples/rq", tags=["examples"])
async def readq(redis_queue: r_queue):
    redis_queue.enqueue("tasks.jobs.goob")

    return {"RQ": "enqueued"}

@router.get("/job/{job_id}", tags=["examples"])
async def job_stat(job_id, redis_queue: r_queue):
    job = redis_queue.fetch_job(job_id)

    return {"status": job.get_status()}


@router.get("/funcA", tags=["examples"])
async def FuncA(commons: CommonDeps):
    return {"resp": "Commons"}

@router.get("/funcB", tags=["examples"])
async def FuncB(commons: CommonDeps):
    return {"resp": "Commons"}

@router.get("/funcC", tags=["examples"])
async def FuncC(commons: CommonDeps):
    return {"resp": "Commons"}

@router.get("/funcD", tags=["examples"])
async def FuncD(commons: CommonDeps):
    return {"resp": "Commons"}

@router.get("/funcE", tags=["examples"])
async def FuncE(commons: CommonDeps):
    return {"resp": "Commons"}
