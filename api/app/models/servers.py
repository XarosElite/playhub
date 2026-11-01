from datetime import datetime, timezone
from sqlalchemy import Column, ForeignKey, Integer, String, DateTime, JSON
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
    owner_id = Column(String, nullable=True, index=True)  # Firebase user ID of the creator
    config = Column(JSON, nullable=True)  # Stores server parameters/environment settings


class ServerShare(Base):
    """A user (other than the owner) who may view and control a server."""
    __tablename__ = "server_shares"

    server_id = Column(Integer, ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True)
    user_uid = Column(String, ForeignKey("users.uid", ondelete="CASCADE"), primary_key=True, index=True)
    granted_by = Column(String, nullable=False)
    created = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
