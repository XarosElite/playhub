from fastapi import APIRouter
from app.routers import examples, servers

all_routers = APIRouter()

all_routers.include_router(examples.router)
all_routers.include_router(servers.router)
