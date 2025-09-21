import os
import redis

from dotenv import load_dotenv
from rq import Worker, Queue, Connection

# read in env file
basedir = os.path.abspath(os.path.dirname(__name__))
dotenv_path = os.path.join(basedir, '.env')
load_dotenv(dotenv_path)

listen = ['default']
port = os.getenv('REDIS_PORT', 6380)
conn = redis.from_url(f'redis://127.0.0.1:{port}')

if __name__ == '__main__':
    with Connection(conn):
        worker = Worker(list(map(Queue, listen)))
        worker.work()
