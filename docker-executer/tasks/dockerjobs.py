import docker
import logging
import os
from sqlalchemy import create_engine, text

client = docker.DockerClient(base_url=os.environ.get("DOCKER_HOST", "tcp://docker-proxy:2375"))
logger = logging.getLogger("rq.worker")

def get_db_engine():
    user = os.environ.get("POSTGRES_USER", "playhuber")
    password = os.environ.get("POSTGRES_PASSWORD", "Blayhub")
    host = os.environ.get("POSTGRES_HOST", "db")
    db_name = os.environ.get("POSTGRES_DB", "playhub")
    url = f"postgresql+psycopg2://{user}:{password}@{host}/{db_name}"
    return create_engine(url)

def update_server_db(server_name, container_id=None, state=None, created=True):
    try:
        engine = get_db_engine()
        with engine.connect() as conn:
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
                params["created"] = str(created)
            
            if updates:
                sql = text(f"UPDATE servers SET {', '.join(updates)} WHERE name = :name")
                conn.execute(sql, params)
                conn.commit()
    except Exception as e:
        logger.error(f"Error updating DB for server {server_name}: {e}")

def create_server(name, env, ports, img):
    logger.info(f"Creating server {name} with image {img}")
    try:
        try:
            old_container = client.containers.get(name)
            old_container.remove(force=True)
        except docker.errors.NotFound:
            pass

        container = client.containers.run(image=img, name=name, ports=ports, environment=env, detach=True)
        update_server_db(name, container_id=container.id, state="running", created=True)
        return "Finished"
    except Exception as e:
        logger.error(f"Failed to create server {name}: {e}")
        update_server_db(name, state="failed", created=False)
        raise e

def stop_server(name):
    logger.info(f"Stopping server {name}")
    try:
        container = client.containers.get(name)
        container.stop()
        update_server_db(name, state="exited")
        return "Finished"
    except Exception as e:
        logger.error(f"Failed to stop server {name}: {e}")
        raise e

def start_server(name):
    logger.info(f"Starting server {name}")
    try:
        container = client.containers.get(name)
        container.start()
        update_server_db(name, state="running")
        return "Finished"
    except Exception as e:
        logger.error(f"Failed to start server {name}: {e}")
        raise e

def restart_server(name):
    logger.info(f"Restarting server {name}")
    try:
        container = client.containers.get(name)
        container.restart()
        update_server_db(name, state="running")
        return "Finished"
    except Exception as e:
        logger.error(f"Failed to restart server {name}: {e}")
        raise e

def delete_server(name):
    logger.info(f"Deleting server {name}")
    try:
        try:
            container = client.containers.get(name)
            container.remove(force=True)
        except docker.errors.NotFound:
            pass
        update_server_db(name, state="deleted")
        return "Finished"
    except Exception as e:
        logger.error(f"Failed to delete server {name}: {e}")
        raise e
