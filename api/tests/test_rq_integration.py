"""
The API with a real RQ queue (on fakeredis): jobs are enqueued the way the
docker-executer worker expects to receive them, and status polling reads real
RQ job state.
"""
import fakeredis
import pytest
from rq import Queue, SimpleWorker
from rq.job import Job, JobStatus

import app.depenencies as deps


@pytest.fixture
def redis():
    return fakeredis.FakeStrictRedis()


@pytest.fixture
def rq_queue(redis):
    return Queue("default", connection=redis)


@pytest.fixture
def rq_client(app, rq_queue):
    from fastapi.testclient import TestClient
    app.dependency_overrides[deps.get_redis_queue] = lambda: rq_queue
    with TestClient(app) as client:
        yield client


def create(client, person, name="mc1", **body):
    response = client.post("/servers/create", headers=person.headers,
                           json={"name": name, "game_type": "minecraft", "environment": {}, **body})
    assert response.status_code == 201, response.text
    return response.json()["msg"]["job_id"]


def test_create_enqueues_the_worker_job(rq_client, alice, rq_queue, redis):
    job_id = create(rq_client, alice)
    assert rq_queue.job_ids == [job_id]
    job = Job.fetch(job_id, connection=redis)
    assert job.func_name == "tasks.dockerjobs.create_server"
    name, env, ports, image, data_path = job.args
    assert (name, ports, image, data_path) == ("mc1", {"25565/tcp": "10000"}, "itzg/minecraft-server", "/data")
    assert env["EULA"] == "true"
    assert job.kwargs == {}
    assert job.meta == {"owner_id": alice.uid}


def test_jobs_are_queued_in_order(rq_client, alice, rq_queue, set_state):
    create(rq_client, alice)
    set_state("mc1", "running", container_id="cid1")
    rq_client.post("/servers/mc1", headers=alice.headers, json={"Action": 2})
    rq_client.delete("/servers/mc1", headers=alice.headers)
    assert [job.func_name for job in rq_queue.jobs] == [
        "tasks.dockerjobs.create_server",
        "tasks.dockerjobs.stop_server",
        "tasks.dockerjobs.delete_server",
    ]
    assert rq_queue.jobs[2].args == ("mc1",)


@pytest.mark.parametrize("status, code", [
    (JobStatus.QUEUED, 1), (JobStatus.STARTED, 2), (JobStatus.FINISHED, 3), (JobStatus.FAILED, 4),
])
def test_polling_reads_real_job_state(rq_client, alice, redis, status, code):
    job_id = create(rq_client, alice)
    job = Job.fetch(job_id, connection=redis)
    job.set_status(status)
    response = rq_client.get(f"/job/{job_id}", headers=alice.headers)
    assert response.json() == {"msg": {"status": code}}


def test_only_the_requester_can_poll(rq_client, alice, bob, redis):
    job_id = create(rq_client, alice)
    assert rq_client.get(f"/job/{job_id}", headers=bob.headers).status_code == 404


def test_jobs_from_other_tools_are_hidden(rq_client, alice, rq_queue):
    job = rq_queue.enqueue("tasks.jobs.goob")
    assert rq_client.get(f"/job/{job.id}", headers=alice.headers).status_code == 404


def test_expired_job(rq_client, alice, redis):
    job_id = create(rq_client, alice)
    Job.fetch(job_id, connection=redis).delete()
    assert rq_client.get(f"/job/{job_id}", headers=alice.headers).status_code == 404


def test_a_worker_runs_the_job_and_polling_sees_it_finish(rq_client, alice, rq_queue, redis, monkeypatch):
    """End to end through RQ: a worker picks up the job; the API reports it finished."""
    import sys
    import types

    calls = []
    tasks = types.ModuleType("tasks")
    dockerjobs = types.ModuleType("tasks.dockerjobs")
    dockerjobs.create_server = lambda *args: calls.append(args) or "Finished"
    tasks.dockerjobs = dockerjobs
    monkeypatch.setitem(sys.modules, "tasks", tasks)
    monkeypatch.setitem(sys.modules, "tasks.dockerjobs", dockerjobs)

    job_id = create(rq_client, alice)
    SimpleWorker([rq_queue], connection=redis).work(burst=True)
    assert calls and calls[0][0] == "mc1"
    assert rq_client.get(f"/job/{job_id}", headers=alice.headers).json() == {"msg": {"status": 3}}


def test_a_failing_job_is_reported_failed(rq_client, alice, rq_queue, redis, monkeypatch):
    import sys
    import types

    def boom(*args):
        raise RuntimeError("image pull failed")

    tasks = types.ModuleType("tasks")
    dockerjobs = types.ModuleType("tasks.dockerjobs")
    dockerjobs.create_server = boom
    tasks.dockerjobs = dockerjobs
    monkeypatch.setitem(sys.modules, "tasks", tasks)
    monkeypatch.setitem(sys.modules, "tasks.dockerjobs", dockerjobs)

    job_id = create(rq_client, alice)
    SimpleWorker([rq_queue], connection=redis).work(burst=True)
    assert rq_client.get(f"/job/{job_id}", headers=alice.headers).json() == {"msg": {"status": 4}}


def test_default_queue_connection():
    assert deps.redis_queue.name == "default"
    kwargs = deps.redis_conn.connection_pool.connection_kwargs
    assert (kwargs["host"], kwargs["port"], kwargs["db"]) == ("redis", 6379, 0)
