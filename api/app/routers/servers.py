from typing import Annotated
from fastapi import APIRouter, Body, Depends
from app.depenencies import r_queue, load_game_validator, get_free_port
from app.internal.config import GAME_CONFIGS
import logging

router = APIRouter(
    prefix="/servers",
    tags=["servers"],
    dependencies=[],
    responses={404: {"description": "Not found"}},
)


@router.get('/')
def get_servers():
    """
        Gets a list of all running servers.

        Returns 200, result
    """
    # 
    return None


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
async def create_server(redis_queue: r_queue, payload = Depends(load_game_validator), port = Depends(get_free_port)):
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

    # Return Docker Job ID
    return {"msg": {"job_id": job.id}}





@router.post('/<server_id>')
def run_action(body, server_id):
    """
        Takes in a action config and Runs the action on the corrosponding container

        Returns 200, result
    """
    return None



