import datetime
import os
import asyncio
import docker
from typing import Annotated
from fastapi import APIRouter, Body, Depends, HTTPException, WebSocket, WebSocketDisconnect
from app.depenencies import r_queue, load_game_validator, get_free_port, free_port
from app.internal.config import GAME_CONFIGS
from app.database import get_db
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
    img = GAME_CONFIGS.get(serv.game_type, {}).get("image", "unknown") if serv.game_type else "unknown"
    server_id = serv.container_id if serv.container_id else serv.name

    created_val = serv.created
    if not created_val or created_val in ("False", "True"):
        created_val = datetime.datetime.now(datetime.timezone.utc).isoformat()

    return {
        "Created": created_val,
        "GameType": serv.game_type,
        "ID": server_id,
        "Image": img,
        "Name": serv.name,
        "State": serv.state or "running",
        "Ports": {"primary_port": serv.port}
    }

def find_server(db, server_id: str):
    stmt = select(Server).where(
        or_(
            Server.container_id == server_id,
            Server.name == server_id,
            Server.id == (int(server_id) if server_id.isdigit() else -1)
        )
    )
    return db.scalars(stmt).first()

@router.get('/')
def get_servers(db = Depends(get_db)):
    """
    Gets a list of all active servers.
    """
    stmt = select(Server).where(Server.state != "deleted")
    results = db.scalars(stmt).all()
    results_dict = [server_to_dict(serv) for serv in results]
    return {"msg": results_dict}

@router.get('/{server_id}')
def get_server(server_id: str, db = Depends(get_db)):
    """
    Gets Information about a given server.
    """
    server = find_server(db, server_id)
    if not server:
        raise HTTPException(status_code=404, detail=f"Server {server_id} not found")
    return {"msg": server_to_dict(server)}

@router.delete('/{server_id}')
def delete_server(server_id: str, redis_queue: r_queue, db = Depends(get_db)):
    """
    Deletes a given docker container by id or name.
    """
    server = find_server(db, server_id)
    if not server:
        # Fallback if server ID is passed directly
        job = redis_queue.enqueue("tasks.dockerjobs.delete_server", server_id)
        return {"msg": {"job_id": job.id}}
    
    name = server.name
    job = redis_queue.enqueue("tasks.dockerjobs.delete_server", name)
    server.state = "deleted"
    db.commit()
    return {"msg": {"job_id": job.id}}

@router.post('/create', status_code=201)
async def create_server(redis_queue: r_queue, payload = Depends(load_game_validator), port = Depends(get_free_port), db = Depends(get_db)):
    """
    Takes in a game config and spins up a docker container hosting the given game.
    """
    logging.info(f"Creating server payload: {payload}")

    img = GAME_CONFIGS.get(payload.game_type, {}).get("image")
    internal_port = GAME_CONFIGS.get(payload.game_type, {}).get("default_port")
    
    if not img or not internal_port:
        raise HTTPException(status_code=400, detail=f"Unsupported game_type: {payload.game_type}")

    job = redis_queue.enqueue("tasks.dockerjobs.create_server", payload.name,
                        payload.environment.model_dump(), {str(internal_port): str(port)},
                        img)

    # Add info to DB
    created_time = datetime.datetime.now(datetime.timezone.utc).isoformat()
    server = Server(created=created_time, game_type=payload.game_type, 
                    container_id="", name=payload.name, state="starting",
                    port=port)
    db.add(server)
    db.commit()

    return {"msg": {"job_id": job.id}}

@router.post('/{server_id}')
def run_action(server_id: str, redis_queue: r_queue, body: dict = Body(...), db = Depends(get_db)):
    """
    Takes in an action config and runs the action on the corresponding container.
    """
    action = body.get("Action")
    server = find_server(db, server_id)
    target_name = server.name if server else server_id

    job = None
    if action == 1:  # START
        job = redis_queue.enqueue("tasks.dockerjobs.start_server", target_name)
        if server:
            server.state = "running"
    elif action == 2:  # STOP
        job = redis_queue.enqueue("tasks.dockerjobs.stop_server", target_name)
        if server:
            server.state = "exited"
    elif action == 3:  # RESTART
        job = redis_queue.enqueue("tasks.dockerjobs.restart_server", target_name)
        if server:
            server.state = "running"
    elif action == 100:  # DELETE
        job = redis_queue.enqueue("tasks.dockerjobs.delete_server", target_name)
        if server:
            server.state = "deleted"
    else:
        raise HTTPException(status_code=400, detail=f"Invalid Action: {action}")

    if server:
        db.commit()

    return {"msg": {"job_id": job.id}}


@router.websocket('/{server_id}/terminal')
async def server_terminal_websocket(websocket: WebSocket, server_id: str):
    await websocket.accept()

    docker_host = os.environ.get("DOCKER_HOST", "tcp://docker-proxy:2375")
    try:
        docker_client = docker.DockerClient(base_url=docker_host)
    except Exception as e:
        await websocket.send_text(f"\r\n\033[31mError connecting to Docker API: {e}\033[0m\r\n")
        await websocket.close()
        return

    target = server_id
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

