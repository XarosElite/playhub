/**
 * The REST client: URLs, payloads, the auth header, error handling and job polling.
 * Requests are answered by a fake axios adapter, so the real interceptors run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';

const firebase = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'uid-me' } as unknown, signOut: vi.fn() },
  getIdToken: vi.fn<() => Promise<string | null>>(),
}));
vi.mock('../Auth/firebase', () => ({ auth: firebase.auth, getIdToken: firebase.getIdToken, isFirebaseConfigured: true }));

const notifications = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock('@mantine/notifications', () => ({ notifications }));

import api from './Config/AxiosConfig';
import { GameServerApi, ServerActionType } from './GameServer';
import { JobApi, JobStatus, waitForJobExit } from './Job';
import { UsersApi, displayUserName } from './Users';
import { AuthApi } from './Auth';
import { SystemApi } from './System';
import { defineCancelApiObject } from './Config/AxiosUtils';

interface Reply { status?: number; data?: unknown }
let requests: InternalAxiosRequestConfig[];
let replies: Array<Reply | ((config: InternalAxiosRequestConfig) => Reply)>;

const adapter: AxiosAdapter = async config => {
  requests.push(config);
  const next = replies.shift() ?? { data: { msg: null } };
  const reply = typeof next === 'function' ? next(config) : next;
  const response = { data: reply.data ?? {}, status: reply.status ?? 200, statusText: '', headers: {}, config };
  if (response.status >= 400) {
    const error = Object.assign(new Error(`Request failed with status code ${response.status}`), {
      isAxiosError: true, response, config,
    });
    throw error;
  }
  return response;
};

beforeEach(() => {
  requests = [];
  replies = [];
  api.defaults.adapter = adapter;
  firebase.getIdToken.mockResolvedValue('id-token-123');
  firebase.auth.currentUser = { uid: 'uid-me' };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

const last = () => requests[requests.length - 1];
const body = (config: InternalAxiosRequestConfig) => (typeof config.data === 'string' ? JSON.parse(config.data) : config.data);

describe('auth header', () => {
  it('sends the Firebase ID token as a bearer token', async () => {
    await api.get('/servers/');
    expect(last().headers.Authorization).toBe('Bearer id-token-123');
    expect(last().baseURL).toBe('/api');
  });

  it('sends no header when signed out', async () => {
    firebase.getIdToken.mockResolvedValue(null);
    await api.get('/servers/');
    expect(last().headers.Authorization).toBeUndefined();
  });
});

describe('error handling', () => {
  it('signs out on 401', async () => {
    replies.push({ status: 401, data: { detail: 'Invalid or expired session' } });
    await expect(api.get('/servers/')).rejects.toThrow();
    expect(firebase.auth.signOut).toHaveBeenCalled();
    expect(notifications.show).not.toHaveBeenCalled();
  });

  it('signs out on 403 and explains why', async () => {
    replies.push({ status: 403, data: { detail: 'This account is not allowed to access PlayHub' } });
    await expect(api.get('/servers/')).rejects.toThrow();
    expect(firebase.auth.signOut).toHaveBeenCalled();
    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({
      id: 'auth-forbidden', title: 'Access denied', message: 'This account is not allowed to access PlayHub', color: 'red',
    }));
  });

  it('403 without a detail gets a generic message', async () => {
    replies.push({ status: 403, data: {} });
    await expect(api.get('/servers/')).rejects.toThrow();
    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'This account is not allowed to access PlayHub.' }));
  });

  it('the login page reports /auth/me 403s itself', async () => {
    replies.push({ status: 403, data: { detail: 'nope' } });
    await expect(AuthApi.getMe()).rejects.toThrow();
    expect(notifications.show).not.toHaveBeenCalled();
    expect(firebase.auth.signOut).toHaveBeenCalled();
  });

  it('other errors are passed through without signing out', async () => {
    replies.push({ status: 409, data: { detail: 'mc1 is busy' } });
    await expect(api.post('/servers/mc1', {})).rejects.toMatchObject({ response: { status: 409 } });
    expect(firebase.auth.signOut).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('GameServerApi', () => {
  it('getServers', async () => {
    replies.push({ data: { msg: [{ Name: 'mc1' }] } });
    expect(await GameServerApi.getServers()).toEqual({ msg: [{ Name: 'mc1' }] });
    expect([last().method, last().url]).toEqual(['get', '/servers/']);
  });

  it('getGames', async () => {
    replies.push({ data: { msg: [{ game_type: 'minecraft' }] } });
    expect(await GameServerApi.getGames()).toEqual([{ game_type: 'minecraft' }]);
    expect(last().url).toBe('/servers/games');
  });

  it('deleteServer encodes the id', async () => {
    await GameServerApi.deleteServer('my server/1');
    expect([last().method, last().url]).toEqual(['delete', '/servers/my%20server%2F1']);
  });

  it('shares', async () => {
    replies.push({ data: { msg: [{ uid: 'u1' }] } }, { data: { msg: [{ uid: 'u2' }] } });
    expect(await GameServerApi.getShares('mc1')).toEqual([{ uid: 'u1' }]);
    expect(last().url).toBe('/servers/mc1/shares');
    expect(await GameServerApi.setShares('mc1', ['u2'])).toEqual([{ uid: 'u2' }]);
    expect([last().method, body(last())]).toEqual(['put', { user_ids: ['u2'] }]);
  });

  it('settings', async () => {
    replies.push({ data: { msg: { game_type: 'minecraft', environment: { PVP: true } } } }, { data: { msg: { job_id: 'j1', changed: ['PvP'] } } });
    expect(await GameServerApi.getSettings('mc1')).toEqual({ game_type: 'minecraft', environment: { PVP: true } });
    expect(await GameServerApi.updateSettings('mc1', { PVP: false })).toEqual({ job_id: 'j1', changed: ['PvP'] });
    expect([last().method, last().url, body(last())]).toEqual(['put', '/servers/mc1/settings', { environment: { PVP: false } }]);
  });

  it('activity', async () => {
    replies.push({ data: { msg: [{ id: 1, action: 'created' }] } });
    expect(await GameServerApi.getActivity('mc1')).toEqual([{ id: 1, action: 'created' }]);
    expect(last().url).toBe('/servers/mc1/activity');
  });

  it('createServer posts the payload, reports queuing, then waits for the job', async () => {
    vi.useFakeTimers();
    const onQueued = vi.fn();
    replies.push(
      { status: 201, data: { msg: { job_id: 'job-7' } } },
      { data: { msg: { status: JobStatus.STARTED } } },
      { data: { msg: { status: JobStatus.FINISHED } } },
    );
    const payload = { game_type: 'minecraft', name: 'mc1', environment: { MAX_PLAYERS: 10 } };
    const result = GameServerApi.createServer(payload, onQueued);
    await vi.advanceTimersByTimeAsync(0);
    expect(body(requests[0])).toEqual(payload);
    expect(requests[0].url).toBe('/servers/create');
    expect(onQueued).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(6000);
    await expect(result).resolves.toBe(true);
    expect(requests.map(r => r.url)).toEqual(['/servers/create', '/job/job-7', '/job/job-7']);
  });

  it('createServer validation errors reject before queuing', async () => {
    const onQueued = vi.fn();
    replies.push({ status: 422, data: { detail: { msg: 'Invalid server settings', fields: { MAX_PLAYERS: 'Must be at most 100' } } } });
    await expect(GameServerApi.createServer({ game_type: 'minecraft', name: 'mc1', environment: {} }, onQueued)).rejects.toThrow();
    expect(onQueued).not.toHaveBeenCalled();
  });

  it('makeServerAction sends the action and resolves false if the job fails', async () => {
    vi.useFakeTimers();
    const onQueued = vi.fn();
    replies.push({ data: { msg: { job_id: 'job-9' } } }, { data: { msg: { status: JobStatus.FAILED } } });
    const result = GameServerApi.makeServerAction('cid 1', ServerActionType.STOP, onQueued);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(result).resolves.toBe(false);
    expect([requests[0].method, requests[0].url, body(requests[0])]).toEqual(['post', '/servers/cid%201', { Action: 2 }]);
    expect(onQueued).toHaveBeenCalledOnce();
  });
});

describe('waitForJobExit', () => {
  it('polls every 3 seconds until the job settles', async () => {
    vi.useFakeTimers();
    replies.push(
      { data: { msg: { status: JobStatus.QUEUED } } },
      { data: { msg: { status: JobStatus.STARTED } } },
      { data: { msg: { status: JobStatus.FINISHED } } },
    );
    let settled = false;
    const result = waitForJobExit('j1').then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(2999);
    expect(requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBe(true);
    expect(requests).toHaveLength(3);
  });

  it('JobApi.getStatus', async () => {
    replies.push({ data: { msg: { status: JobStatus.QUEUED } } });
    expect(await JobApi.getStatus('abc')).toEqual({ msg: { status: 1 } });
    expect(last().url).toBe('/job/abc');
  });
});

describe('other APIs', () => {
  it('UsersApi.list', async () => {
    replies.push({ data: { msg: [{ uid: 'u1' }] } });
    expect(await UsersApi.list()).toEqual([{ uid: 'u1' }]);
    expect(last().url).toBe('/users/');
  });

  it('AuthApi.getMe', async () => {
    replies.push({ data: { msg: { uid: 'uid-me' } } });
    expect(await AuthApi.getMe()).toEqual({ uid: 'uid-me' });
    expect(last().url).toBe('/auth/me');
  });

  it('SystemApi', async () => {
    replies.push(
      { data: { msg: { sys_info: { cpu_usage: 5 } } } },
      { data: { msg: { ip: '203.0.113.7' } } },
      { data: { msg: { open_status: true } } },
    );
    expect(await SystemApi.getSystemInfo()).toEqual({ sys_info: { cpu_usage: 5 } });
    expect(await SystemApi.getSystemIp()).toEqual({ ip: '203.0.113.7' });
    expect(await SystemApi.getPortOpen(10000)).toBe(true);
    expect(requests.map(r => r.url)).toEqual(['/sys/info', '/sys/ip', '/sys/?open_port=10000']);
  });
});

describe('displayUserName', () => {
  it.each([
    [{ uid: 'u', name: 'Sam', email: 's@x.com', picture: null }, 'Sam'],
    [{ uid: 'u', name: null, email: 's@x.com', picture: null }, 's@x.com'],
    [{ uid: 'u', name: '', email: null, picture: null }, 'Unknown user'],
    [null, 'Unknown user'],
    [undefined, 'Unknown user'],
  ])('%o → %s', (user, expected) => {
    expect(displayUserName(user)).toBe(expected);
  });
});

describe('defineCancelApiObject', () => {
  it('gives each API a controller that aborts the previous request', () => {
    const cancel = defineCancelApiObject({ getThing: async () => null, other: async () => null });
    const first = cancel.getThing.handleRequestCancellation();
    const second = cancel.getThing.handleRequestCancellation();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(cancel.other.handleRequestCancellation().signal.aborted).toBe(false);
  });
});
