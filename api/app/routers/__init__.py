from fastapi import APIRouter
from app.routers import examples, servers, jobs, sys

all_routers = APIRouter()

all_routers.include_router(examples.router)
all_routers.include_router(servers.router)
all_routers.include_router(jobs.router)
all_routers.include_router(sys.router)
