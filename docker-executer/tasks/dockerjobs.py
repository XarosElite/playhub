import os
import logging
import datetime
import time
import docker
from sqlalchemy import create_engine, text

client = docker.DockerClient(base_url=os.environ.get("DOCKER_HOST", "tcp://docker-proxy:2375"))
logger = logging.getLogger("rq.worker")

user = os.environ.get("POSTGRES_USER", "playhuber")
password = os.environ.get("POSTGRES_PASSWORD", "Blayhub")
host = os.environ.get("POSTGRES_HOST", "db")
db_port = os.environ.get("POSTGRES_PORT", "5432")
db_name = os.environ.get("POSTGRES_DB", "playhub")

db_url = f"postgresql+psycopg2://{user}:{password}@{host}:{db_port}/{db_name}"
db_engine = create_engine(db_url, pool_pre_ping=True)

# Sentinel: "leave this column unchanged" (None means "set to NULL").
_UNCHANGED = object()

# How long to wait for a game to save and shut down before Docker kills it.
STOP_TIMEOUT_SECONDS = 30


def update_server_db(server_name, container_id=None, state=None, created=None, status_message=_UNCHANGED):
    try:
        with db_engine.connect() as conn:
            updates = []
            params = {"name": server_name}
            if container_id is not None:
                updates.append("container_id = :container_id")
                params["container_id"] = container_id
            if state is not None:
                updates.append("state = :state")
                params["state"] = state
            if created is not None:
                updates.append("created = :created")
                params["created"] = created
            if status_message is not _UNCHANGED:
                updates.append("status_message = :status_message")
                params["status_message"] = status_message

            if updates:
                sql = text(f"UPDATE servers SET {', '.join(updates)} WHERE name = :name AND state != 'deleted'")
                conn.execute(sql, params)
                conn.commit()
    except Exception as e:
        logger.error(f"Error updating DB for server {server_name}: {e}")


def record_event(server_name, action, detail=None):
    """System activity event (no actor), e.g. a failed job."""
    try:
        with db_engine.connect() as conn:
            conn.execute(text(
                "INSERT INTO server_events (server_id, actor_uid, action, detail, created) "
                "SELECT id, NULL, :action, :detail, :created FROM servers WHERE name = :name"
            ), {"name": server_name, "action": action, "detail": detail,
                "created": datetime.datetime.now(datetime.timezone.utc)})
            conn.commit()
    except Exception as e:
        logger.error(f"Error recording event for server {server_name}: {e}")


def _error_message(e: Exception) -> str:
    if isinstance(e, docker.errors.APIError) and e.explanation:
        return str(e.explanation)
    return str(e) or type(e).__name__


def _fail(name, action, e, settled_state="failed"):
    message = _error_message(e)
    logger.error(f"Failed to {action} server {name}: {message}")
    update_server_db(name, state=settled_state, status_message=f"Failed to {action}: {message}")
    record_event(name, "failed", f"Couldn't {action}: {message}")


def volume_name(name):
    return f"playhub-{name}-data"


def _volumes(name, data_path):
    """Named volume holding the game's data, so it survives recreating the container."""
    if not data_path:
        return None
    return {volume_name(name): {"bind": data_path, "mode": "rw"}}


def create_server(name, env, ports, img, data_path=None):
    logger.info(f"Creating server {name} with image {img}")
    try:
        try:
            old_container = client.containers.get(name)
            old_container.remove(force=True)
        except docker.errors.NotFound:
            pass

        container = client.containers.run(image=img, name=name, ports=ports, environment=env,
                                          volumes=_volumes(name, data_path), detach=True)
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        update_server_db(name, container_id=container.id, state="running", created=now_utc, status_message=None)
        return "Finished"
    except Exception as e:
        _fail(name, "create", e)
        raise e


def recreate_server(name, env, ports, img, data_path=None):
    """
    Replaces a server's container with one using new settings, keeping its data.
    Containers created before named volumes were introduced keep their data by
    inheriting the old container's volumes. Rolls back to the old container if
    the new one can't be created.
    """
    logger.info(f"Recreating server {name} with new settings")
    try:
        old = client.containers.get(name)
    except docker.errors.NotFound:
        return create_server(name, env, ports, img, data_path)
    except Exception as e:
        _fail(name, "apply settings", e)
        raise e

    was_running = old.status == "running"
    mounts = old.attrs.get("Mounts") or []
    has_named_volume = any(m.get("Name") == volume_name(name) for m in mounts)
    run_kwargs = dict(image=img, name=name, ports=ports, environment=env, detach=True)
    if data_path and (has_named_volume or not mounts):
        run_kwargs["volumes"] = _volumes(name, data_path)
    elif mounts:
        run_kwargs["volumes_from"] = [old.id]

    backup_name = f"{name}-replaced-{int(time.time())}"
    try:
        old.stop(timeout=STOP_TIMEOUT_SECONDS)
        old.rename(backup_name)
        new = client.containers.run(**run_kwargs)
    except Exception as e:
        # Put the old container back the way it was. If the new container was
        # created but failed to start (e.g. its port is taken), it holds the
        # name, so remove it first. Its data volumes are shared with the old
        # container, so they are kept.
        try:
            leftover = client.containers.get(name)
            if leftover.id != old.id:
                leftover.remove(force=True)
        except docker.errors.NotFound:
            pass
        except Exception as cleanup_error:
            logger.error(f"Failed to remove the new container for {name}: {cleanup_error}")
        try:
            old.reload()
            if old.name == backup_name:
                old.rename(name)
            if was_running:
                old.start()
        except Exception as restore_error:
            logger.error(f"Failed to restore old container for {name}: {restore_error}")
        _fail(name, "apply settings", e, settled_state="running" if was_running else "exited")
        raise e

    try:
        old.remove()  # keeps volumes; the new container uses them
    except Exception as e:
        logger.warning(f"Could not remove replaced container {backup_name}: {e}")

    update_server_db(name, container_id=new.id, state="running", status_message=None)
    return "Finished"


def stop_server(name):
    logger.info(f"Stopping server {name}")
    try:
        container = client.containers.get(name)
        container.stop(timeout=STOP_TIMEOUT_SECONDS)
        update_server_db(name, state="exited", status_message=None)
        return "Finished"
    except Exception as e:
        _fail(name, "stop", e, settled_state="running")
        raise e


def start_server(name):
    logger.info(f"Starting server {name}")
    try:
        container = client.containers.get(name)
        container.start()
        update_server_db(name, state="running", status_message=None)
        return "Finished"
    except Exception as e:
        _fail(name, "start", e)
        raise e


def restart_server(name):
    logger.info(f"Restarting server {name}")
    try:
        container = client.containers.get(name)
        container.restart(timeout=STOP_TIMEOUT_SECONDS)
        update_server_db(name, state="running", status_message=None)
        return "Finished"
    except Exception as e:
        _fail(name, "restart", e)
        raise e


def delete_server(name):
    logger.info(f"Deleting server {name}")
    try:
        try:
            container = client.containers.get(name)
            container.remove(force=True, v=True)
        except docker.errors.NotFound:
            pass
        try:
            client.volumes.get(volume_name(name)).remove(force=True)
        except docker.errors.NotFound:
            pass
        # The API has already marked the row deleted and released its name, so
        # it must not be looked up by name here: a new server may now use it.
        return "Finished"
    except Exception as e:
        logger.error(f"Failed to delete server {name}: {e}")
        raise e
