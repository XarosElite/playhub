import logging
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.routers import all_routers
from app.internal import setup_logger
from app.models.servers import Server
from app.database import Base, engine
from sqlalchemy.exc import OperationalError

DB_INIT_ATTEMPTS = 15
DB_INIT_RETRY_SECONDS = 2


def init_database():
    """
    Create tables, retrying while Postgres starts up. If the database is still
    unreachable after all attempts, raise so the API fails to start instead of
    running without its tables.
    """
    for attempt in range(1, DB_INIT_ATTEMPTS + 1):
        try:
            Base.metadata.create_all(bind=engine)
            logging.info("Database tables initialized successfully.")
            return
        except OperationalError as e:
            if attempt == DB_INIT_ATTEMPTS:
                raise
            logging.warning(
                f"Database not ready (attempt {attempt}/{DB_INIT_ATTEMPTS}), "
                f"retrying in {DB_INIT_RETRY_SECONDS}s: {e.orig}"
            )
            time.sleep(DB_INIT_RETRY_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logger()
    init_database()
    yield

def create_app() -> FastAPI:
    app = FastAPI(title="Playhub Api", root_path="/api", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(all_routers)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        logging.warning(f"Validation error for request to {request.url}: {exc.errors()}")
        return JSONResponse(
            status_code=422,
            content={"msg": "Validation error", "details": exc.errors()}
        )

    return app
