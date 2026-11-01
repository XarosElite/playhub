from datetime import datetime, timezone
from sqlalchemy import Column, ForeignKey, Integer, String, DateTime, JSON, Text
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
    # Why the server is in its current state, e.g. the error when it failed.
    status_message = Column(Text, nullable=True)


def release_name_and_port(server: Server) -> None:
    """
    Frees a deleted server's name and port for new servers. The row is kept
    (with its activity history) under a name no user can choose.
    """
    server.name = f"{server.name} (deleted #{server.id})"
    server.port = None


# Server lifecycle. Transitional states are set by the API when a job is
# queued; the worker moves the server to a settled state when the job ends.
TRANSITIONAL_STATES = {"starting", "stopping", "restarting", "updating"}
SETTLED_STATES = {"running", "exited", "failed"}


class ServerShare(Base):
    """A user (other than the owner) who may view and control a server."""
    __tablename__ = "server_shares"

    server_id = Column(Integer, ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True)
    user_uid = Column(String, ForeignKey("users.uid", ondelete="CASCADE"), primary_key=True, index=True)
    granted_by = Column(String, nullable=False)
    created = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ServerEvent(Base):
    """Activity history: who did what to a server, and when."""
    __tablename__ = "server_events"

    id = Column(Integer, primary_key=True)
    server_id = Column(Integer, ForeignKey("servers.id", ondelete="CASCADE"), index=True, nullable=False)
    actor_uid = Column(String, nullable=True)  # None for system events (e.g. a crash)
    action = Column(String, nullable=False)
    detail = Column(Text, nullable=True)
    created = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
