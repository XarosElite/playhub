from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from app.routers import all_routers
from app.internal import setup_logger
import logging

def create_app() -> FastAPI:
    setup_logger()

    app = FastAPI(title="Playhub Api", root_path="/api")


    # Register routers
    app.include_router(all_routers)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        logging.info("Minecraft Schema invalid")
        return {"msg", "Error"}
    return app
