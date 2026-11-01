from fastapi import APIRouter,HTTPException
from app.depenencies import r_queue
from app.internal.auth import CurrentUser
from enum import IntEnum, auto

router = APIRouter(
    prefix="/job",
    tags=["job"],
    dependencies=[],
    responses={404: {"description": "Not found"}},
)

class JobStatus(IntEnum):
    """
        Enum for representing the Job status
    """
    Queued = auto()
    Started = auto()
    Finished = auto()
    Failed = auto()


job_states = {
    "queued": JobStatus.Queued,
    "started": JobStatus.Started,
    "finished": JobStatus.Finished,
    "failed": JobStatus.Failed
}


@router.get('/{job_id}', status_code=200)
async def check_job(job_id: str, user: CurrentUser, redis_queue: r_queue):
    '''
        Route for checking the status of one of the signed-in user's jobs.

        Returns 200, result
    '''
    job = redis_queue.fetch_job(job_id)
    if not job or job.meta.get("owner_id") != user.uid:
        raise HTTPException(status_code=404, detail=f"No job with id {job_id} on host")

    return {"msg": {"status": job_states[job.get_status()]}}
