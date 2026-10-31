import os
import logging
import datetime
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

def update_server_db(server_name, container_id=None, state=None, created=None):
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
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        update_server_db(name, container_id=container.id, state="running", created=now_utc)
        return "Finished"
    except Exception as e:
        logger.error(f"Failed to create server {name}: {e}")
        update_server_db(name, state="failed")
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
