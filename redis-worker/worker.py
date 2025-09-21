import os
import redis

from dotenv import load_dotenv
from rq import Worker, Queue

# read in env file
basedir = os.path.abspath(os.path.dirname(__name__))
dotenv_path = os.path.join(basedir, '.env')
load_dotenv(dotenv_path)

listen = ['default']
port = os.getenv('REDIS_PORT', 6379)
conn = redis.from_url(f'redis://redis:{port}')

if __name__ == '__main__':
    worker = Worker(['default'], connection=conn)
    worker.work()
