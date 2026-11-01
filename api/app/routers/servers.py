import datetime
import logging

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, or_

from app.database import get_db
from app.depenencies import (
    r_queue,
    load_game_validator,
    get_next_available_port,
    CreateServerPayload,
)
from app.internal.auth import CurrentUser
from app.internal.config import (
    GAMES,
    EnvironmentValidationError,
    container_port_key,
    public_game,
    validate_environment,
)
from app.internal.events import record_event
from app.internal.live import get_live
from app.models.servers import TRANSITIONAL_STATES, Server, ServerEvent, ServerShare, release_name_and_port
from app.models.users import User, user_to_dict

router = APIRouter(
    prefix="/servers",
    tags=["servers"],
    dependencies=[],
    responses={404: {"description": "Not found"}},
)


class ServerAction:
    START = 1
    STOP = 2
    RESTART = 3
    DELETE = 100


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------
def _iso(value) -> str:
    if isinstance(value, datetime.datetime):
        return value.isoformat()
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def server_to_dict(serv, viewer_uid: str, owner=None, shared_with=None, with_history: bool = True):
    """
    Serialises a server for the given viewer. ``shared_with`` (the users it is
    shared with) is only included for the owner.
    """
    game = GAMES.get(serv.game_type) or {}
    is_owner = serv.owner_id == viewer_uid
    return {
        "Created": _iso(serv.created),
        "GameType": serv.game_type,
        "ID": serv.container_id if serv.container_id else serv.name,
        "Image": game.get("image", "unknown"),
        "Name": serv.name,
        "State": serv.state or "running",
        "StatusMessage": serv.status_message,
        "Ports": {"primary_port": serv.port},
        "Protocol": game.get("protocol", "tcp"),
        "SupportsPlayers": game.get("status_query", "none") != "none",
        "Live": get_live(serv.id, with_history=with_history),
        "IsOwner": is_owner,
        "Owner": user_to_dict(owner) if owner else {"uid": serv.owner_id, "name": None, "email": None, "picture": None},
        "SharedWith": [user_to_dict(u) for u in (shared_with or [])] if is_owner else None,
    }


def serialize_servers(db, servers, viewer_uid: str, with_history: bool = True):
    """Serialises servers with their owners and (for the viewer's own servers) shares, in two queries."""
    owner_ids = {s.owner_id for s in servers if s.owner_id}
    owners = {u.uid: u for u in db.scalars(select(User).where(User.uid.in_(owner_ids)))} if owner_ids else {}

    owned_ids = [s.id for s in servers if s.owner_id == viewer_uid]
    shares: dict[int, list] = {}
    if owned_ids:
        rows = db.execute(
            select(ServerShare.server_id, User)
            .join(User, User.uid == ServerShare.user_uid)
            .where(ServerShare.server_id.in_(owned_ids))
            .order_by(User.name, User.email)
        ).all()
        for server_id, shared_user in rows:
            shares.setdefault(server_id, []).append(shared_user)

    return [
        server_to_dict(s, viewer_uid, owners.get(s.owner_id), shares.get(s.id), with_history)
        for s in servers
    ]


def list_accessible_servers(db, uid: str):
    stmt = select(Server).where(Server.state != "deleted", can_access(uid)).order_by(Server.created)
    return db.scalars(stmt).all()


# ---------------------------------------------------------------------------
# Access control
# ---------------------------------------------------------------------------
def can_access(uid: str):
    """SQL condition: the user owns the server or it has been shared with them."""
    return or_(
        Server.owner_id == uid,
        Server.id.in_(select(ServerShare.server_id).where(ServerShare.user_uid == uid)),
    )


def find_server(db, server_id: str, uid: str):
    """Finds a server the user can access (owned or shared) by container id, name, or DB id."""
    stmt = select(Server).where(
        can_access(uid),
        Server.state != "deleted",
        or_(
            Server.container_id == server_id,
            Server.name == server_id,
            Server.id == (int(server_id) if server_id.isdigit() else -1)
        )
    )
    return db.scalars(stmt).first()


def get_accessible_server(db, server_id: str, uid: str):
    """A server the user owns or that is shared with them, or 404."""
    server = find_server(db, server_id, uid)
    if not server:
        raise HTTPException(status_code=404, detail=f"Server {server_id} not found")
    return server


def get_owned_server(db, server_id: str, uid: str, action: str):
    """A server the user owns. 404 if they can't see it, 403 if it's only shared with them."""
    server = get_accessible_server(db, server_id, uid)
    if server.owner_id != uid:
        raise HTTPException(status_code=403, detail=f"Only the server's owner can {action}")
    return server


def ensure_not_busy(server):
    if server.state in TRANSITIONAL_STATES:
        raise HTTPException(status_code=409, detail=f"{server.name} is busy ({server.state}). Try again in a moment.")


def enqueue_for(redis_queue, user, func: str, *args):
    """Enqueue a job tagged with the requesting user so only they can poll its status."""
    return redis_queue.enqueue(func, *args, meta={"owner_id": user.uid})


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get('/')
def get_servers(user: CurrentUser, db = Depends(get_db)):
    """
    Gets the servers the signed-in user owns or that have been shared with them.
    """
    return {"msg": serialize_servers(db, list_accessible_servers(db, user.uid), user.uid)}


@router.get('/games')
def get_games(user: CurrentUser):
    """
    Gets the list of supported game types with their configuration.
    """
    games = [public_game(game) for game in GAMES.values()]
    return {"msg": games}


@router.get('/{server_id}')
def get_server(server_id: str, user: CurrentUser, db = Depends(get_db)):
    """
    Gets Information about a given server.
    """
    server = get_accessible_server(db, server_id, user.uid)
    return {"msg": serialize_servers(db, [server], user.uid)[0]}


@router.delete('/{server_id}')
def delete_server(server_id: str, user: CurrentUser, redis_queue: r_queue, db = Depends(get_db)):
    """
    Deletes one of the signed-in user's servers by container id or name. Owner only.
    """
    server = get_owned_server(db, server_id, user.uid, "delete it")
    return {"msg": {"job_id": _delete(db, redis_queue, user, server)}}


def _delete(db, redis_queue, user, server) -> str:
    # The container and volume are named after the server; the worker removes them.
    name = server.name
    server.state = "deleted"
    server.status_message = None
    release_name_and_port(server)
    record_event(db, server, user.uid, "deleted")
    db.commit()
    return enqueue_for(redis_queue, user, "tasks.dockerjobs.delete_server", name).id


@router.post('/create', status_code=201)
async def create_server(user: CurrentUser, redis_queue: r_queue, payload: CreateServerPayload = Depends(load_game_validator), db = Depends(get_db)):
    """
    Takes in a game config and spins up a docker container hosting the given game.
    The environment is validated against the game's schema in games.yaml.
    Host port is automatically allocated starting from 10000.
    """
    logging.info(f"Creating {payload.game_type} server '{payload.name}'")

    if db.scalars(select(Server.id).where(Server.name == payload.name)).first() is not None:
        raise HTTPException(status_code=409, detail=f"The name '{payload.name}' is already taken")

    game = GAMES[payload.game_type]

    # Automatically allocate host port (starting from 10000) - host port is not decided by user
    port = get_next_available_port(requested_port=None, db=db)

    # Save the server before queueing the job, so the worker always finds its row.
    server = Server(
        created=datetime.datetime.now(datetime.timezone.utc),
        game_type=payload.game_type,
        container_id="",
        name=payload.name,
        state="starting",
        port=port,
        owner_id=user.uid,
        config=payload.settings
    )
    db.add(server)
    db.flush()
    record_event(db, server, user.uid, "created")
    db.commit()

    job = enqueue_for(redis_queue, user, "tasks.dockerjobs.create_server", payload.name,
                      payload.container_env, {container_port_key(game): str(port)},
                      game["image"], game["data_path"])

    return {"msg": {"job_id": job.id}}


# action -> (worker job, transitional state, event name)
_ACTIONS = {
    ServerAction.START: ("tasks.dockerjobs.start_server", "starting", "started"),
    ServerAction.STOP: ("tasks.dockerjobs.stop_server", "stopping", "stopped"),
    ServerAction.RESTART: ("tasks.dockerjobs.restart_server", "restarting", "restarted"),
}


@router.post('/{server_id}')
def run_action(server_id: str, user: CurrentUser, redis_queue: r_queue, body: dict = Body(...), db = Depends(get_db)):
    """
    Takes in an action config and runs the action on a container the user owns or
    that has been shared with them. Deleting is owner only.
    """
    action = body.get("Action")
    server = get_accessible_server(db, server_id, user.uid)

    if action == ServerAction.DELETE:
        if server.owner_id != user.uid:
            raise HTTPException(status_code=403, detail="Only the server's owner can delete it")
        return {"msg": {"job_id": _delete(db, redis_queue, user, server)}}

    if action not in _ACTIONS:
        raise HTTPException(status_code=400, detail=f"Invalid Action: {action}")
    ensure_not_busy(server)

    job_name, transitional_state, event = _ACTIONS[action]
    server.state = transitional_state
    server.status_message = None
    record_event(db, server, user.uid, event)
    db.commit()
    job = enqueue_for(redis_queue, user, job_name, server.name)
    return {"msg": {"job_id": job.id}}


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
class SettingsUpdateRequest(BaseModel):
    environment: dict


@router.get('/{server_id}/settings')
def get_settings(server_id: str, user: CurrentUser, db = Depends(get_db)):
    """
    The server's current settings, keyed by field name (see GET /servers/games
    for the schema). Owner and shared users.
    """
    server = get_accessible_server(db, server_id, user.uid)
    return {"msg": {"game_type": server.game_type, "environment": server.config or {}}}


@router.put('/{server_id}/settings')
def update_settings(server_id: str, body: SettingsUpdateRequest, user: CurrentUser,
                    redis_queue: r_queue, db = Depends(get_db)):
    """
    Validates and saves new settings, then recreates the container with them.
    World data in the game's data directory is kept. Owner and shared users.
    """
    server = get_accessible_server(db, server_id, user.uid)
    ensure_not_busy(server)
    game = GAMES.get(server.game_type)
    if game is None:
        raise HTTPException(status_code=400, detail=f"Unsupported game_type: {server.game_type}")

    try:
        settings, container_env = validate_environment(game, body.environment)
    except EnvironmentValidationError as e:
        raise HTTPException(status_code=422, detail={"msg": str(e), "fields": e.errors})

    changed = sorted(
        game["common_fields"].get(k, game["fields"].get(k, {})).get("label", k)
        for k in set(settings) | set(server.config or {})
        if (server.config or {}).get(k) != settings.get(k)
    )
    if not changed:
        return {"msg": {"job_id": None, "changed": []}}

    server.config = settings
    server.state = "updating"
    server.status_message = None
    record_event(db, server, user.uid, "settings_updated", ", ".join(changed))
    db.commit()

    job = enqueue_for(redis_queue, user, "tasks.dockerjobs.recreate_server", server.name,
                      container_env, {container_port_key(game): str(server.port)},
                      game["image"], game["data_path"])
    return {"msg": {"job_id": job.id, "changed": changed}}


# ---------------------------------------------------------------------------
# Activity
# ---------------------------------------------------------------------------
@router.get('/{server_id}/activity')
def get_activity(server_id: str, user: CurrentUser, db = Depends(get_db), limit: int = 50):
    """
    Recent activity for a server, newest first. Owner and shared users.
    """
    server = get_accessible_server(db, server_id, user.uid)
    rows = db.execute(
        select(ServerEvent, User)
        .outerjoin(User, User.uid == ServerEvent.actor_uid)
        .where(ServerEvent.server_id == server.id)
        .order_by(ServerEvent.created.desc(), ServerEvent.id.desc())
        .limit(max(1, min(limit, 200)))
    ).all()
    return {"msg": [
        {
            "id": event.id,
            "action": event.action,
            "detail": event.detail,
            "created": _iso(event.created),
            "actor": user_to_dict(actor) if actor else (
                {"uid": event.actor_uid, "name": None, "email": None, "picture": None} if event.actor_uid else None
            ),
        }
        for event, actor in rows
    ]}


# ---------------------------------------------------------------------------
# Sharing
# ---------------------------------------------------------------------------
class ShareUpdateRequest(BaseModel):
    user_ids: list[str]


def get_shared_users(db, server):
    stmt = (
        select(User)
        .join(ServerShare, ServerShare.user_uid == User.uid)
        .where(ServerShare.server_id == server.id)
        .order_by(User.name, User.email)
    )
    return [user_to_dict(u) for u in db.scalars(stmt)]


@router.get('/{server_id}/shares')
def get_shares(server_id: str, user: CurrentUser, db = Depends(get_db)):
    """
    Lists the users a server is shared with. Owner only.
    """
    server = get_owned_server(db, server_id, user.uid, "manage sharing")
    return {"msg": get_shared_users(db, server)}


@router.put('/{server_id}/shares')
def set_shares(server_id: str, body: ShareUpdateRequest, user: CurrentUser, db = Depends(get_db)):
    """
    Replaces the set of users a server is shared with. Owner only.
    Shared users can view, control and reconfigure the server but not delete it or change sharing.
    """
    server = get_owned_server(db, server_id, user.uid, "manage sharing")

    wanted = set(body.user_ids)
    if server.owner_id in wanted:
        raise HTTPException(status_code=400, detail="You can't share a server with yourself")
    known = {u.uid: u for u in db.scalars(select(User).where(User.uid.in_(wanted)))} if wanted else {}
    unknown = wanted - known.keys()
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown user(s): {', '.join(sorted(unknown))}")

    current = {
        share.user_uid: share
        for share in db.scalars(select(ServerShare).where(ServerShare.server_id == server.id))
    }
    removed = [uid for uid in current if uid not in wanted]
    added = sorted(wanted - current.keys())
    for uid in removed:
        db.delete(current[uid])
    for uid in added:
        db.add(ServerShare(server_id=server.id, user_uid=uid, granted_by=user.uid))

    if added or removed:
        names = {u.uid: (u.name or u.email or u.uid) for u in db.scalars(select(User).where(User.uid.in_(set(added) | set(removed))))}
        if added:
            record_event(db, server, user.uid, "shared", ", ".join(names.get(uid, uid) for uid in added))
        if removed:
            record_event(db, server, user.uid, "unshared", ", ".join(names.get(uid, uid) for uid in removed))
    db.commit()

    logging.info(f"Server '{server.name}' is now shared with {len(wanted)} user(s)")
    return {"msg": get_shared_users(db, server)}
