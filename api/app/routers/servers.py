from typing import Annotated
from fastapi import APIRouter, Body, Depends
from app.depenencies import r_queue, load_game_validator, get_free_port
from app.internal.config import GAME_CONFIGS
from app.database import get_db
from sqlalchemy import select
from app.models.servers import Server
import logging

router = APIRouter(
    prefix="/servers",
    tags=["servers"],
    dependencies=[],
    responses={404: {"description": "Not found"}},
)

def server_to_dict(serv):
    server_dict = {
        "Created": True,
        "GameType": serv.game_type,
        "ID": serv.container_id,
        "Image": "temp",
        "Name": serv.name,
        "State": "running",
        "Ports": {"primary_port": serv.port}
    }
    return server_dict

@router.get('/')
def get_servers(db = Depends(get_db)):
    """
        Gets a list of all running servers.

        Returns 200, result
    """
    stmt = select(Server)
    results = db.scalars(stmt).all()

    results = [server_to_dict(serv) for serv in results]
    logging.info(results)
    
    return {"msg": results}


@router.get('/<server_id>')
def get_server(server_id):
    """
        Gets Information about a given server bases on the Docker inspect command.

        Returns 200, result
    """
    return None


@router.delete('/<server_id>')
def delete_server(server_id):
    """
        Deletes a given docker container by id.

        Returns 200, result
    """
    return None



@router.post('/create', status_code=201)
async def create_server(redis_queue: r_queue, payload = Depends(load_game_validator), port = Depends(get_free_port), db = Depends(get_db)):
    """
        Takes in a game config and spins up a docker container hosting the given game.

        Returns 200, result
    """
    # Parse Body into Docker Format
    logging.info(f"---------------------------------------------------------------") 
    logging.info(f"The Body watched: {payload}") 
    logging.info(f"---------------------------------------------------------------")

    logging.info(f"GAME_CONFIGS:{GAME_CONFIGS}")

    # Enqueue Docker as redis job
    img = GAME_CONFIGS.get(payload.game_type).get("image")
    internal_port = GAME_CONFIGS.get(payload.game_type).get("default_port")
    job = redis_queue.enqueue("tasks.dockerjobs.create_server", payload.name,
                        payload.environment.model_dump(), {str(internal_port):str(port)},
                        img)

    # Add info to DB
    server = Server(created=False, game_type=payload.game_type, 
                    container_id="", name=payload.name, state="running",
                    port=port)
    db.add(server)
    db.commit()

    # Return Docker Job ID
    return {"msg": {"job_id": job.id}}





@router.post('/<server_id>')
def run_action(body, server_id):
    """
        Takes in a action config and Runs the action on the corrosponding container

        Returns 200, result
    """
    return None



