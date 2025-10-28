import docker
import logging
import os

client = docker.DockerClient(base_url=os.environ["DOCKER_HOST"])
logger = logging.getLogger("rq.worker")

def create_server(name, env, ports, img):
    client.containers.run(image=img, name=name, ports=ports, environment=env, detach=True)
    return "Finished"


