import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

postgres_user = os.environ.get("POSTGRES_USER", "playhuber")
postgres_password = os.environ.get("POSTGRES_PASSWORD", "Blayhub")
postgres_host = os.environ.get("POSTGRES_HOST", "db")
postgres_port = os.environ.get("POSTGRES_PORT", "5432")
postgres_db = os.environ.get("POSTGRES_DB", "playhub")

SQLALCHEMY_DATABASE_URL = (
    f"postgresql+psycopg2://{postgres_user}:{postgres_password}@"
    f"{postgres_host}:{postgres_port}/{postgres_db}"
)

engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
