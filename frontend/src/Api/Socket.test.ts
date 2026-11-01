import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeWebSocket, flushPromises } from '../test/utils';

const getIdToken = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
vi.mock('../Auth/firebase', () => ({ getIdToken, auth: null, isFirebaseConfigured: false }));

import { openAuthedSocket, WS_UNAUTHORIZED } from './Socket';

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  getIdToken.mockResolvedValue('id-token');
});

describe('openAuthedSocket', () => {
  it('connects to the API path on the same host', () => {
    openAuthedSocket('/servers/live');
    expect(FakeWebSocket.last.url).toBe(`ws://${window.location.host}/api/servers/live`);
  });

  it('sends the ID token as the first message, then calls onReady', async () => {
    const onReady = vi.fn((ws: WebSocket) => ws.send('refresh'));
    const ws = openAuthedSocket('/servers/live', onReady);
    const fake = FakeWebSocket.last;
    fake.open();
    await flushPromises();
    expect(fake.sent).toEqual(['id-token', 'refresh']);
    expect(onReady).toHaveBeenCalledWith(ws);
  });

  it('closes without a session', async () => {
    getIdToken.mockResolvedValue(null);
    const onReady = vi.fn();
    openAuthedSocket('/servers/live', onReady);
    const fake = FakeWebSocket.last;
    fake.open();
    await flushPromises();
    expect(fake.sent).toEqual([]);
    expect(fake.readyState).toBe(FakeWebSocket.CLOSED);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('does not send if the socket closed while fetching the token', async () => {
    let resolve!: (token: string) => void;
    getIdToken.mockReturnValue(new Promise(r => { resolve = r; }));
    openAuthedSocket('/servers/live');
    const fake = FakeWebSocket.last;
    fake.open();
    fake.close();
    resolve('id-token');
    await flushPromises();
    expect(fake.sent).toEqual([]);
  });

  it('exposes the API close code for expired sessions', () => {
    expect(WS_UNAUTHORIZED).toBe(4401);
  });
});
