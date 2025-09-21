from fastapi import FastAPI
from app.routers import all_routers

def create_app() -> FastAPI:
    app = FastAPI(title="Form Demo")

    # Register routers
    app.include_router(all_routers)

    return app
