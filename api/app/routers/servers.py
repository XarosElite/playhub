from fastapi import APIRouter, Body
from app.depenencies import r_queue
from app.validators.gamevalidators.minecraft import MinecraftGameValidator
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



@router.post('/create')
def create_server(redis_queue: r_queue, payload: MinecraftGameValidator):
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
    logging.info(f"img:{img}")

    redis_queue.enqueue("tasks.dockerjobs.create_server", payload.name,
                        payload.environment.model_dump(), {"25565":"25565"},
                        img)

    # Add info to DB

    # Return Docker Job ID
    return 200





@router.post('/<server_id>')
def run_action(body, server_id):
    """
        Takes in a action config and Runs the action on the corrosponding container

        Returns 200, result
    """
    return None



