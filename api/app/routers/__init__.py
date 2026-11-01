from fastapi import APIRouter
from app.routers import auth, servers, server_streams, jobs, sys, users

all_routers = APIRouter()

all_routers.include_router(auth.router)
all_routers.include_router(servers.router)
all_routers.include_router(server_streams.router)
all_routers.include_router(users.router)
all_routers.include_router(jobs.router)
all_routers.include_router(sys.router)
