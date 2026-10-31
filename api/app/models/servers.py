from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, JSON
from app.database import Base

class Server(Base):
    __tablename__ = "servers"

    id = Column(Integer, primary_key=True, index=True)
    created = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    game_type = Column(String, index=True)
    container_id = Column(String, index=True, nullable=True)
    name = Column(String, unique=True, index=True)
    state = Column(String, index=True)
    port = Column(Integer, unique=True, index=True)
    owner_id = Column(String, nullable=True, index=True)  # Reserved for future Firebase Auth user IDs
    config = Column(JSON, nullable=True)  # Stores server parameters/environment settings
