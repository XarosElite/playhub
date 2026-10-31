from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from app.routers import all_routers
from app.internal import setup_logger
from app.models.servers import *
from app.database import Base, engine
import logging

def create_app() -> FastAPI:
    setup_logger()

    Base.metadata.create_all(bind=engine)

    app = FastAPI(title="Playhub Api", root_path="/api")


    # Register routers
    app.include_router(all_routers)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        logging.info("Minecraft Schema invalid")
        return {"msg", "Error"}


    return app
