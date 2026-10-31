import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.routers import all_routers
from app.internal import setup_logger
from app.models.servers import Server
from app.database import Base, engine

@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logger()
    try:
        Base.metadata.create_all(bind=engine)
        logging.info("Database tables initialized successfully.")
    except Exception as e:
        logging.error(f"Error initializing database tables: {e}")
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
