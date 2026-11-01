import datetime
import os
import asyncio
import docker
from typing import Annotated
from fastapi import APIRouter, Body, Depends, HTTPException, WebSocket, WebSocketDisconnect
from app.depenencies import (
    r_queue,
    load_game_validator,
    get_next_available_port,
    CreateServerPayload,
)
from app.internal.config import GAMES, public_game
from app.internal.auth import CurrentUser, authenticate_websocket
from app.database import get_db, SessionLocal
from sqlalchemy import select, or_
from app.models.servers import Server
import logging

router = APIRouter(
    prefix="/servers",
    tags=["servers"],
    dependencies=[],
    responses={404: {"description": "Not found"}},
)

def server_to_dict(serv):
    img = GAMES.get(serv.game_type, {}).get("image", "unknown") if serv.game_type else "unknown"
    server_id = serv.container_id if serv.container_id else serv.name

    created_val = serv.created
    if isinstance(created_val, datetime.datetime):
        created_val = created_val.isoformat()
    elif not created_val or str(created_val) in ("False", "True"):
        created_val = datetime.datetime.now(datetime.timezone.utc).isoformat()

    return {
        "Created": str(created_val),
        "GameType": serv.game_type,
        "ID": server_id,
        "Image": img,
        "Name": serv.name,
        "State": serv.state or "running",
        "Ports": {"primary_port": serv.port}
    }

def find_server(db, server_id: str, owner_id: str):
    """Finds a server owned by the given user by container id, name, or DB id."""
    stmt = select(Server).where(
        Server.owner_id == owner_id,
        or_(
            Server.container_id == server_id,
            Server.name == server_id,
            Server.id == (int(server_id) if server_id.isdigit() else -1)
        )
    )
    return db.scalars(stmt).first()

def get_owned_server(db, server_id: str, owner_id: str):
    server = find_server(db, server_id, owner_id)
    if not server or server.state == "deleted":
        raise HTTPException(status_code=404, detail=f"Server {server_id} not found")
    return server

def enqueue_for(redis_queue, user, func: str, *args):
    """Enqueue a job tagged with its owner so only they can poll its status."""
    return redis_queue.enqueue(func, *args, meta={"owner_id": user.uid})

@router.get('/')
def get_servers(user: CurrentUser, db = Depends(get_db)):
    """
    Gets a list of the signed-in user's active servers.
    """
    stmt = select(Server).where(Server.state != "deleted", Server.owner_id == user.uid)
    results = db.scalars(stmt).all()
    results_dict = [server_to_dict(serv) for serv in results]
    return {"msg": results_dict}


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
    return {"msg": server_to_dict(get_owned_server(db, server_id, user.uid))}

@router.delete('/{server_id}')
def delete_server(server_id: str, user: CurrentUser, redis_queue: r_queue, db = Depends(get_db)):
    """
    Deletes one of the signed-in user's servers by container id or name.
    """
    server = get_owned_server(db, server_id, user.uid)
    job = enqueue_for(redis_queue, user, "tasks.dockerjobs.delete_server", server.name)
    server.state = "deleted"
    db.commit()
    return {"msg": {"job_id": job.id}}

@router.post('/create', status_code=201)
async def create_server(user: CurrentUser, redis_queue: r_queue, payload: CreateServerPayload = Depends(load_game_validator), db = Depends(get_db)):
    """
    Takes in a game config and spins up a docker container hosting the given game.
    The environment is validated against the game's schema in games.yaml.
    Host port is automatically allocated starting from 10000.
    """
    logging.info(f"Creating {payload.game_type} server '{payload.name}'")

    game = GAMES[payload.game_type]
    img = game["image"]
    internal_port = game["internal_port"]

    # Automatically allocate host port (starting from 10000) - host port is not decided by user
    port = get_next_available_port(requested_port=None, db=db)

    job = enqueue_for(redis_queue, user, "tasks.dockerjobs.create_server", payload.name,
                        payload.container_env, {str(internal_port): str(port)},
                        img)

    # Add info to DB
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    server = Server(
        created=now_utc,
        game_type=payload.game_type, 
        container_id="",
        name=payload.name,
        state="starting",
        port=port,
        owner_id=user.uid,
        config=payload.settings
    )
    db.add(server)
    db.commit()

    return {"msg": {"job_id": job.id}}

@router.post('/{server_id}')
def run_action(server_id: str, user: CurrentUser, redis_queue: r_queue, body: dict = Body(...), db = Depends(get_db)):
    """
    Takes in an action config and runs the action on one of the signed-in user's containers.
    """
    action = body.get("Action")
    server = get_owned_server(db, server_id, user.uid)
    target_name = server.name

    job = None
    if action == 1:  # START
        job = enqueue_for(redis_queue, user, "tasks.dockerjobs.start_server", target_name)
        server.state = "running"
    elif action == 2:  # STOP
        job = enqueue_for(redis_queue, user, "tasks.dockerjobs.stop_server", target_name)
        server.state = "exited"
    elif action == 3:  # RESTART
        job = enqueue_for(redis_queue, user, "tasks.dockerjobs.restart_server", target_name)
        server.state = "running"
    elif action == 100:  # DELETE
        job = enqueue_for(redis_queue, user, "tasks.dockerjobs.delete_server", target_name)
        server.state = "deleted"
    else:
        raise HTTPException(status_code=400, detail=f"Invalid Action: {action}")

    db.commit()

    return {"msg": {"job_id": job.id}}


@router.websocket('/{server_id}/terminal')
async def server_terminal_websocket(websocket: WebSocket, server_id: str):
    await websocket.accept()

    user = await authenticate_websocket(websocket)
    if user is None:
        return
    # Short-lived session: don't hold a DB connection for the life of the terminal.
    with SessionLocal() as db:
        server = find_server(db, server_id, user.uid)
    if not server or server.state == "deleted":
        await websocket.send_text(f"\r\n\033[31mServer {server_id} not found\033[0m\r\n")
        await websocket.close()
        return

    docker_host = os.environ.get("DOCKER_HOST", "tcp://docker-proxy:2375")
    try:
        docker_client = docker.DockerClient(base_url=docker_host)
    except Exception as e:
        await websocket.send_text(f"\r\n\033[31mError connecting to Docker API: {e}\033[0m\r\n")
        await websocket.close()
        return

    target = server.container_id or server.name
    exec_cmd = ["/bin/sh"]
    try:
        exec_inst = docker_client.api.exec_create(
            container=target,
            cmd=exec_cmd,
            stdin=True,
            stdout=True,
            stderr=True,
            tty=True
        )
        sock = docker_client.api.exec_start(exec_inst["Id"], detach=False, tty=True, stream=False, socket=True)
    except Exception:
        try:
            exec_inst = docker_client.api.exec_create(
                container=target,
                cmd=["/bin/bash"],
                stdin=True,
                stdout=True,
                stderr=True,
                tty=True
            )
            sock = docker_client.api.exec_start(exec_inst["Id"], detach=False, tty=True, stream=False, socket=True)
        except Exception as ex:
            await websocket.send_text(f"\r\n\033[31mError starting container terminal exec session: {ex}\033[0m\r\n")
            await websocket.close()
            return

    raw_sock = sock._sock if hasattr(sock, '_sock') else sock

    async def read_docker():
        def _recv():
            try:
                return raw_sock.recv(4096)
            except Exception:
                return None

        while True:
            data = await asyncio.to_thread(_recv)
            if not data:
                break
            try:
                await websocket.send_text(data.decode('utf-8', errors='ignore'))
            except Exception:
                break

    read_task = asyncio.create_task(read_docker())

    try:
        while True:
            msg = await websocket.receive_text()
            def _send():
                try:
                    raw_sock.sendall(msg.encode('utf-8'))
                except Exception:
                    pass
            await asyncio.to_thread(_send)
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        read_task.cancel()
        try:
            raw_sock.close()
        except Exception:
            pass

