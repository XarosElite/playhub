import logging
import docker
import os

client = docker.DockerClient(base_url=os.environ["DOCKER_HOST"])
logger = logging.getLogger("rq.worker")

def goob(gobParams):
    logger.info("I'm a goober")
    client.containers.run("itzg/minecraft-server", environment=gobParams)

