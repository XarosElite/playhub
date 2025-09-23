import os
import redis
import logging
import docker

from dotenv import load_dotenv
from rq import Worker, Queue



logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO) 

# read in env file
basedir = os.path.abspath(os.path.dirname(__name__))
dotenv_path = os.path.join(basedir, '.env')
load_dotenv(dotenv_path)
def test_q():
    logger.info("I'm a goofer")
listen = ['default']
port = os.getenv('REDIS_PORT', 6379)
r = redis.Redis(host="redis", port=6379, db=0)
q = Queue("default", connection=r)

if __name__ == '__main__':
    logger.info("Prints are working")
    worker = Worker([q], connection=r)
    worker.work()
