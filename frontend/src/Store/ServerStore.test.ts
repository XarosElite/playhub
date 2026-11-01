import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeWebSocket, makeServer } from '../test/utils';
import { ServerActionType, TopLevelServerType } from '../Api/GameServer';

const mocks = vi.hoisted(() => ({
  getServers: vi.fn(),
  makeServerAction: vi.fn(),
  deleteServer: vi.fn(),
  openAuthedSocket: vi.fn(),
}));

vi.mock('../Api/Socket', () => ({ openAuthedSocket: mocks.openAuthedSocket, WS_UNAUTHORIZED: 4401 }));
vi.mock('../Api/GameServer', async importOriginal => ({
  ...(await importOriginal<typeof import('../Api/GameServer')>()),
  GameServerApi: {
    getServers: mocks.getServers,
    makeServerAction: mocks.makeServerAction,
    deleteServer: mocks.deleteServer,
  },
}));

type Store = typeof import('./ServerStore')['serverStore'];
let store: Store;

beforeEach(async () => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
  mocks.openAuthedSocket.mockImplementation((path: string) => new FakeWebSocket(`ws://localhost/api${path}`));
  mocks.getServers.mockResolvedValue({ msg: [] });
  vi.resetModules();
  store = (await import('./ServerStore')).serverStore;
});

afterEach(() => {
  vi.useRealTimers();
});

const push = (ws: FakeWebSocket, servers: TopLevelServerType[]) => ws.receive({ type: 'servers', servers });

describe('subscribing', () => {
  it('opens one live socket however many components subscribe', () => {
    const a = store.subscribe();
    const b = store.subscribe();
    expect(mocks.openAuthedSocket).toHaveBeenCalledTimes(1);
    expect(mocks.openAuthedSocket).toHaveBeenCalledWith('/servers/live');
    expect(store.connection).toBe('connecting');
    a();
    expect(FakeWebSocket.last.readyState).not.toBe(FakeWebSocket.CLOSED);
    b();
    expect(FakeWebSocket.last.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it('pushed server lists replace the current one', () => {
    store.subscribe();
    const ws = FakeWebSocket.last;
    ws.open();
    expect(store.loaded).toBe(false);
    const servers = [makeServer({ Name: 'mc1' }), makeServer({ Name: 'mc2' })];
    push(ws, servers);
    expect(store.loaded).toBe(true);
    expect(store.connection).toBe('live');
    expect(store.servers.map(s => s.Name)).toEqual(['mc1', 'mc2']);
    push(ws, [servers[1]]);
    expect(store.servers.map(s => s.Name)).toEqual(['mc2']);
  });

  it('ignores other message types', () => {
    store.subscribe();
    FakeWebSocket.last.receive({ type: 'hello' });
    expect(store.loaded).toBe(false);
  });

  it('closing after unsubscribing does not reconnect', () => {
    const unsubscribe = store.subscribe();
    unsubscribe();
    vi.advanceTimersByTime(60000);
    expect(mocks.openAuthedSocket).toHaveBeenCalledTimes(1);
    expect(mocks.getServers).not.toHaveBeenCalled();
  });

  it('can resubscribe after everyone left', () => {
    store.subscribe()();
    store.subscribe();
    expect(mocks.openAuthedSocket).toHaveBeenCalledTimes(2);
  });
});

describe('when the socket drops', () => {
  it('polls while reconnecting, with exponential backoff', async () => {
    store.subscribe();
    FakeWebSocket.last.serverClose(1006);
    expect(store.connection).toBe('polling');
    expect(mocks.getServers).toHaveBeenCalledTimes(1); // immediate fetch

    vi.advanceTimersByTime(999);
    expect(mocks.openAuthedSocket).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(mocks.openAuthedSocket).toHaveBeenCalledTimes(2); // after 1s

    FakeWebSocket.last.serverClose(1006);
    vi.advanceTimersByTime(1999);
    expect(mocks.openAuthedSocket).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(mocks.openAuthedSocket).toHaveBeenCalledTimes(3); // after 2s

    FakeWebSocket.last.serverClose(1006);
    vi.advanceTimersByTime(4000);
    expect(mocks.openAuthedSocket).toHaveBeenCalledTimes(4); // after 4s
  });

  it('backoff is capped at 30 seconds', () => {
    store.subscribe();
    for (let i = 0; i < 10; i++) {
      FakeWebSocket.last.serverClose(1006);
      vi.advanceTimersByTime(30000);
    }
    const before = mocks.openAuthedSocket.mock.calls.length;
    FakeWebSocket.last.serverClose(1006);
    vi.advanceTimersByTime(29999);
    expect(mocks.openAuthedSocket).toHaveBeenCalledTimes(before);
    vi.advanceTimersByTime(1);
    expect(mocks.openAuthedSocket).toHaveBeenCalledTimes(before + 1);
  });

  it('polls every 5 seconds until live again', async () => {
    store.subscribe();
    FakeWebSocket.last.serverClose(1006);
    mocks.getServers.mockClear();
    vi.advanceTimersByTime(15000);
    expect(mocks.getServers.mock.calls.length).toBeGreaterThanOrEqual(3);

    const ws = FakeWebSocket.last;
    ws.open();
    push(ws, [makeServer()]);
    expect(store.connection).toBe('live');
    mocks.getServers.mockClear();
    vi.advanceTimersByTime(15000);
    expect(mocks.getServers).not.toHaveBeenCalled();
  });

  it('polled results update the store', async () => {
    mocks.getServers.mockResolvedValue({ msg: [makeServer({ Name: 'polled' })] });
    store.subscribe();
    FakeWebSocket.last.serverClose(1006);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.servers.map(s => s.Name)).toEqual(['polled']);
    expect(store.loaded).toBe(true);
  });

  it('poll failures are ignored', async () => {
    mocks.getServers.mockRejectedValue(new Error('offline'));
    store.subscribe();
    FakeWebSocket.last.serverClose(1006);
    await vi.advanceTimersByTimeAsync(10000);
    expect(store.loaded).toBe(false);
  });

  it('reconnects immediately when the session expired (4401), with a fresh token', () => {
    store.subscribe();
    FakeWebSocket.last.serverClose(4401);
    vi.advanceTimersByTime(0);
    expect(mocks.openAuthedSocket).toHaveBeenCalledTimes(2);
  });

  it('backoff resets once live again', () => {
    store.subscribe();
    FakeWebSocket.last.serverClose(1006);
    vi.advanceTimersByTime(1000);
    FakeWebSocket.last.serverClose(1006);
    vi.advanceTimersByTime(2000);
    const ws = FakeWebSocket.last;
    ws.open();
    push(ws, []);
    ws.serverClose(1006);
    const before = mocks.openAuthedSocket.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(mocks.openAuthedSocket).toHaveBeenCalledTimes(before + 1);
  });
});

describe('refresh', () => {
  it('asks the live socket for an update', () => {
    store.subscribe();
    const ws = FakeWebSocket.last;
    ws.open();
    push(ws, []);
    store.refresh();
    expect(ws.sent).toEqual(['refresh']);
    expect(mocks.getServers).not.toHaveBeenCalled();
  });

  it('fetches over HTTP when not live', () => {
    store.refresh();
    expect(mocks.getServers).toHaveBeenCalledTimes(1);
  });
});

describe('actions', () => {
  beforeEach(() => {
    store.subscribe();
    const ws = FakeWebSocket.last;
    ws.open();
    push(ws, [makeServer({ Name: 'mc1', ID: 'cid1', State: 'running', StatusMessage: 'old' }), makeServer({ Name: 'mc2', ID: 'cid2' })]);
  });

  it.each([
    [ServerActionType.START, 'starting'],
    [ServerActionType.STOP, 'stopping'],
    [ServerActionType.RESTART, 'restarting'],
  ])('shows action %s as %s straight away', async (action, state) => {
    let finish!: (ok: boolean) => void;
    mocks.makeServerAction.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const result = store.runAction(store.byId('cid1')!, action);
    expect(store.byId('cid1')!.State).toBe(state);
    expect(store.byId('cid1')!.StatusMessage).toBeNull();
    expect(store.byId('cid2')!.State).toBe('running');
    finish(true);
    expect(await result).toBe(true);
  });

  it('refreshes when queued and when finished', async () => {
    const ws = FakeWebSocket.last;
    mocks.makeServerAction.mockImplementation(async (_id: string, _action: number, onQueued: () => void) => {
      onQueued();
      return false;
    });
    expect(await store.runAction(store.byId('mc1')!, ServerActionType.STOP)).toBe(false);
    expect(ws.sent).toEqual(['refresh', 'refresh']);
    expect(mocks.makeServerAction).toHaveBeenCalledWith('cid1', ServerActionType.STOP, expect.any(Function));
  });

  it('refreshes even when the request fails', async () => {
    mocks.makeServerAction.mockRejectedValue(new Error('409'));
    await expect(store.runAction(store.byId('mc1')!, ServerActionType.START)).rejects.toThrow('409');
    expect(FakeWebSocket.last.sent).toContain('refresh');
  });

  it('deleting removes the server right away', async () => {
    mocks.deleteServer.mockResolvedValue(undefined);
    await store.deleteServer(store.byId('mc1')!);
    expect(mocks.deleteServer).toHaveBeenCalledWith('cid1');
    expect(store.servers.map(s => s.Name)).toEqual(['mc2']);
  });

  it('a failed delete keeps the server', async () => {
    mocks.deleteServer.mockRejectedValue(new Error('403'));
    await expect(store.deleteServer(store.byId('mc1')!)).rejects.toThrow();
    expect(store.servers).toHaveLength(2);
  });

  it('byId matches the container ID or the name', () => {
    expect(store.byId('cid1')!.Name).toBe('mc1');
    expect(store.byId('mc2')!.ID).toBe('cid2');
    expect(store.byId('nope')).toBeUndefined();
    expect(store.byId(undefined)).toBeUndefined();
  });
});

describe('celebrating new servers', () => {
  const fresh = (overrides: Partial<TopLevelServerType>) =>
    makeServer({ Name: 'new', Created: new Date().toISOString(), ...overrides });

  it('fires when a newly created server goes from starting to running', () => {
    const listener = vi.fn();
    store.onServerLive(listener);
    store.subscribe();
    const ws = FakeWebSocket.last;
    push(ws, [fresh({ ID: 'new', State: 'starting' })]);
    expect(listener).not.toHaveBeenCalled();
    // The ID changes from the name to the container ID once the container exists.
    push(ws, [fresh({ ID: 'cid-new', State: 'running' })]);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].ID).toBe('cid-new');
    push(ws, [fresh({ ID: 'cid-new', State: 'running' })]);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('not for servers that were already running when the page loaded', () => {
    const listener = vi.fn();
    store.onServerLive(listener);
    store.subscribe();
    push(FakeWebSocket.last, [fresh({ State: 'running' })]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('not for old servers being started again', () => {
    const listener = vi.fn();
    store.onServerLive(listener);
    store.subscribe();
    const old = { Created: new Date(Date.now() - 20 * 60 * 1000).toISOString() };
    push(FakeWebSocket.last, [fresh({ ...old, State: 'starting' })]);
    push(FakeWebSocket.last, [fresh({ ...old, State: 'running' })]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('not for restarts or failures', () => {
    const listener = vi.fn();
    store.onServerLive(listener);
    store.subscribe();
    push(FakeWebSocket.last, [fresh({ State: 'restarting' })]);
    push(FakeWebSocket.last, [fresh({ State: 'running' })]);
    push(FakeWebSocket.last, [fresh({ State: 'starting' })]);
    push(FakeWebSocket.last, [fresh({ State: 'failed' })]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('listeners can stop listening', () => {
    const listener = vi.fn();
    const stop = store.onServerLive(listener);
    stop();
    store.subscribe();
    push(FakeWebSocket.last, [fresh({ State: 'starting' })]);
    push(FakeWebSocket.last, [fresh({ State: 'running' })]);
    expect(listener).not.toHaveBeenCalled();
  });
});
