"""Records server activity (the history shown on a server's page)."""
from app.models.servers import ServerEvent


def record_event(db, server, actor_uid, action: str, detail: str | None = None):
    """Adds an event to the session; committed with the caller's transaction."""
    db.add(ServerEvent(server_id=server.id, actor_uid=actor_uid, action=action, detail=detail))
