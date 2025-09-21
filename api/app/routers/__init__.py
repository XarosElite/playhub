from fastapi import APIRouter
from app.routers import examples

all_routers = APIRouter()

all_routers.include_router(examples.router)
