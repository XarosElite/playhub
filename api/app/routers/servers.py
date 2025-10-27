from fastapi import APIRouter, Body
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
def create_server(payload: dict = Body(...)):
    """
        Takes in a game config and spins up a docker container hosting the given game.

        Returns 200, result
    """
    # Parse Body into Docker Format
    logging.info(f"---------------------------------------------------------------")
    logging.info(f"The Body: {payload}")
    logging.info(f"---------------------------------------------------------------")

    # Enqueue Docker as redis job

    # Add info to DB

    # Return Docker Job ID
    return payload





@router.post('/<server_id>')
def run_action(body, server_id):
    """
        Takes in a action config and Runs the action on the corrosponding container

        Returns 200, result
    """
    return None



