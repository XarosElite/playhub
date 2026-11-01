"""
WebSocket endpoints for servers. Browsers can't set headers on websockets, so
each one expects the Firebase ID token as the first message (see
authenticate_websocket).

* /servers/live              pushes the user's server list (with live stats)
* /servers/{id}/logs         streams a container's logs
* /servers/{id}/terminal     interactive shell in a container
"""
import asyncio
import json
import os
import threading
import time

import docker
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from app.database import SessionLocal
from app.internal.auth import WEBSOCKET_UNAUTHORIZED, authenticate_websocket
from app.routers.servers import find_server, list_accessible_servers, serialize_servers

router = APIRouter(prefix="/servers", tags=["servers"])

LIVE_PUSH_SECONDS = 2
LOG_TAIL_LINES = 300


def _docker_client():
    return docker.DockerClient(base_url=os.environ.get("DOCKER_HOST", "tcp://docker-proxy:2375"))


async def _close_if_expired(websocket: WebSocket, user) -> bool:
    if user.expires_at and time.time() >= user.expires_at:
        await websocket.close(code=WEBSOCKET_UNAUTHORIZED, reason="Session expired")
        return True
    return False


@router.websocket('/live')
async def live_servers_websocket(websocket: WebSocket):
    """
    Pushes {"type": "servers", "servers": [...]} whenever the user's server list
    or stats change (checked every few seconds). The client may send "refresh"
    to get an immediate update, e.g. right after starting an action. Closes with
    code 4401 when the ID token expires so the client reconnects with a new one.
    """
    await websocket.accept()
    user = await authenticate_websocket(websocket)
    if user is None:
        return

    def snapshot():
        with SessionLocal() as db:
            return serialize_servers(db, list_accessible_servers(db, user.uid), user.uid)

    last_payload = None
    try:
        while True:
            if await _close_if_expired(websocket, user):
                return
            payload = json.dumps({"type": "servers", "servers": await run_in_threadpool(snapshot)})
            if payload != last_payload:
                await websocket.send_text(payload)
                last_payload = payload
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=LIVE_PUSH_SECONDS)
            except asyncio.TimeoutError:
                pass
    except WebSocketDisconnect:
        pass


@router.websocket('/{server_id}/logs')
async def server_logs_websocket(websocket: WebSocket, server_id: str):
    """Streams the last few hundred log lines, then follows new output."""
    await websocket.accept()
    user = await authenticate_websocket(websocket)
    if user is None:
        return
    with SessionLocal() as db:
        server = find_server(db, server_id, user.uid)
    if not server:
        await websocket.send_text(f"\033[31mServer {server_id} not found\033[0m\r\n")
        await websocket.close()
        return

    try:
        client = _docker_client()
        stream = client.api.logs(server.container_id or server.name, stream=True, follow=True,
                                 tail=LOG_TAIL_LINES, timestamps=False)
    except Exception as e:
        await websocket.send_text(f"\033[31mUnable to read logs: {e}\033[0m\r\n")
        await websocket.close()
        return

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def pump():
        # Blocking iteration over the Docker log stream, handed to the event loop.
        try:
            for chunk in stream:
                loop.call_soon_threadsafe(queue.put_nowait, chunk)
        except Exception:
            pass
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=pump, name=f"logs-{server.name}", daemon=True).start()

    async def forward():
        while True:
            chunk = await queue.get()
            if chunk is None:
                await websocket.send_text("\r\n\033[33m[Log stream ended – the server stopped]\033[0m\r\n")
                return
            await websocket.send_text(chunk.decode("utf-8", errors="replace"))

    async def wait_for_disconnect():
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass

    tasks = [asyncio.create_task(forward()), asyncio.create_task(wait_for_disconnect())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in tasks:
            task.cancel()
        try:
            stream.close()
            client.close()
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket('/{server_id}/terminal')
async def server_terminal_websocket(websocket: WebSocket, server_id: str):
    await websocket.accept()

    user = await authenticate_websocket(websocket)
    if user is None:
        return
    # Short-lived session: don't hold a DB connection for the life of the terminal.
    with SessionLocal() as db:
        server = find_server(db, server_id, user.uid)
    if not server:
        await websocket.send_text(f"\r\n\033[31mServer {server_id} not found\033[0m\r\n")
        await websocket.close()
        return


    try:
        docker_client = _docker_client()
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

