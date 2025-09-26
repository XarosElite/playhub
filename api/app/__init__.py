from fastapi import FastAPI
from app.routers import all_routers
from app.internal import setup_logger

def create_app() -> FastAPI:
    setup_logger()

    app = FastAPI(title="Playhub Api", root_path="/api")


    # Register routers
    app.include_router(all_routers)

    return app
