import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FRIEND, FakeWebSocket, MINECRAFT, OTHER, flushPromises, makeLive, makeServer, renderWithProviders } from '../../test/utils';
import { ServerActionType, TopLevelServerType } from '../../Api/GameServer';

// xterm needs a real canvas; record what would be drawn instead.
const terminals = vi.hoisted(() => ({ all: [] as Array<{ output: string[]; disposed: boolean; onDataHandler?: (d: string) => void; cleared: number }> }));
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    output: string[] = [];
    disposed = false;
    cleared = 0;
    onDataHandler?: (data: string) => void;
    constructor() { terminals.all.push(this); }
    loadAddon() {}
    open() {}
    write(data: string) { this.output.push(data); }
    writeln(data: string) { this.output.push(`${data}\n`); }
    clear() { this.cleared += 1; }
    scrollToBottom() {}
    dispose() { this.disposed = true; }
    onData(handler: (data: string) => void) { this.onDataHandler = handler; return { dispose() {} }; }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));

const api = vi.hoisted(() => ({
  getGames: vi.fn(), getSettings: vi.fn(), updateSettings: vi.fn(), getShares: vi.fn(), setShares: vi.fn(),
  getActivity: vi.fn(), makeServerAction: vi.fn(), deleteServer: vi.fn(), getServers: vi.fn(),
}));
vi.mock('../../Api/GameServer', async importOriginal => ({
  ...(await importOriginal<typeof import('../../Api/GameServer')>()),
  GameServerApi: api,
}));
vi.mock('../../Api/Users', async importOriginal => ({
  ...(await importOriginal<typeof import('../../Api/Users')>()),
  UsersApi: { list: async () => [FRIEND, OTHER] },
}));
const getIdToken = vi.hoisted(() => vi.fn(async () => 'id-token'));
vi.mock('../../Auth/firebase', () => ({ getIdToken, auth: null, isFirebaseConfigured: false }));

import ServerPage from './ServerPage';
import { serverStore } from '../../Store/ServerStore';
import { systemInfoStore } from '../../Store/SystemInfoStore';

const mine = makeServer({ Name: 'mc1', ID: 'cid-mc1', SharedWith: [FRIEND] });
const theirs = makeServer({ Name: 'pals', ID: 'cid-pals', GameType: 'palworld', Protocol: 'udp', SupportsPlayers: false,
  IsOwner: false, Owner: FRIEND, SharedWith: null, Live: makeLive({ players: null }) });

function load(servers: TopLevelServerType[], loaded = true) {
  runInAction(() => { serverStore.servers = servers; serverStore.loaded = loaded; });
}

const open = (route: string) => renderWithProviders(<ServerPage />, { route, path: '/server/:serverId' });

beforeEach(() => {
  terminals.all = [];
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  load([mine, theirs]);
  runInAction(() => { systemInfoStore.systemIP = '203.0.113.7'; });
  api.getActivity.mockResolvedValue([]);
  api.getGames.mockResolvedValue([MINECRAFT]);
  api.getSettings.mockResolvedValue({ game_type: 'minecraft', environment: {} });
  api.getShares.mockResolvedValue([FRIEND]);
  api.getServers.mockImplementation(async () => ({ msg: serverStore.servers }));
  api.makeServerAction.mockResolvedValue(true);
  api.deleteServer.mockResolvedValue(undefined);
});

describe('header', () => {
  it('shows the server, its status and address', () => {
    open('/server/mc1');
    expect(screen.getByRole('heading', { name: 'mc1' })).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText(`203.0.113.7:${mine.Ports.primary_port}`)).toBeInTheDocument();
    expect(screen.getByText('minecraft · TCP')).toBeInTheDocument();
    expect(screen.getByText('Shared with 1')).toBeInTheDocument();
  });

  it('finds servers by container ID too', () => {
    open('/server/cid-mc1');
    expect(screen.getByRole('heading', { name: 'mc1' })).toBeInTheDocument();
  });

  it('shared servers say who shared them', () => {
    open('/server/pals');
    expect(screen.getByText('Shared by Sam Rivera')).toBeInTheDocument();
    expect(screen.getByText('palworld · UDP')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('loading skeleton', () => {
    load([], false);
    open('/server/mc1');
    expect(screen.queryByRole('heading', { name: 'mc1' })).not.toBeInTheDocument();
    expect(screen.queryByText('Server not found')).not.toBeInTheDocument();
  });

  it('server not found', async () => {
    open('/server/gone');
    expect(screen.getByText('Server not found')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Back to dashboard' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  });

  it('back link', async () => {
    open('/server/mc1');
    await userEvent.click(screen.getByRole('link', { name: /Servers/ }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  });
});

describe('actions', () => {
  it('stop and restart', async () => {
    const user = userEvent.setup();
    open('/server/mc1');
    await user.click(screen.getByRole('button', { name: 'Restart' }));
    expect(api.makeServerAction).toHaveBeenCalledWith('cid-mc1', ServerActionType.RESTART, expect.any(Function));
    act(() => load([mine, theirs]));
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(api.makeServerAction).toHaveBeenCalledWith('cid-mc1', ServerActionType.STOP, expect.any(Function));
  });

  it('start a stopped server; restart is unavailable', async () => {
    load([{ ...mine, State: 'exited', Live: null }]);
    open('/server/mc1');
    expect(screen.getByRole('button', { name: 'Restart' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(api.makeServerAction).toHaveBeenCalledWith('cid-mc1', ServerActionType.START, expect.any(Function));
  });

  it('deleting returns to the dashboard', async () => {
    const user = userEvent.setup();
    open('/server/mc1');
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    await user.click(await screen.findByRole('button', { name: 'Delete server' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
    expect(api.deleteServer).toHaveBeenCalledWith('cid-mc1');
  });

  it('Share… opens the sharing tab', async () => {
    const user = userEvent.setup();
    open('/server/mc1');
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Share…' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/server/mc1?tab=sharing');
  });
});

describe('tabs', () => {
  it('overview by default, with live stats', () => {
    open('/server/mc1');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Players')).toBeInTheDocument();
    expect(screen.getByText('Version 1.21.4')).toBeInTheDocument();
    expect(screen.getByText('1.5 GB')).toBeInTheDocument();
    expect(screen.getByText('of 8.0 GB')).toBeInTheDocument();
    expect(screen.getByText('2 hours')).toBeInTheDocument();
    expect(screen.getByText('CPU (last 2 minutes)')).toBeInTheDocument();
  });

  it('overview for a stopped server', () => {
    load([{ ...mine, State: 'failed', Live: null, StatusMessage: 'Failed to start: port is already allocated' }]);
    open('/server/mc1');
    expect(screen.getByText('Failed to start: port is already allocated')).toBeInTheDocument();
    expect(screen.getByText('Start the server to see live resource usage.')).toBeInTheDocument();
  });

  it('overview while history is still being collected', () => {
    load([{ ...mine, Live: makeLive({ history: [] }) }]);
    open('/server/mc1');
    expect(screen.getByText('Collecting resource history…')).toBeInTheDocument();
  });

  it('player counts are unavailable for some games', () => {
    open('/server/pals');
    expect(screen.getByText('Not available for this game')).toBeInTheDocument();
  });

  it('the tab is kept in the URL', async () => {
    const user = userEvent.setup();
    open('/server/mc1');
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/server/mc1?tab=activity');
    expect(await screen.findByText('No activity yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/\/server\/mc1$/);
  });

  it('opens straight to a tab from the URL; unknown tabs fall back to overview', () => {
    open('/server/mc1?tab=settings');
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
  });

  it('unknown tab names show the overview', () => {
    open('/server/mc1?tab=bogus');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('sharing is only for the owner', () => {
    open('/server/pals?tab=sharing');
    expect(screen.queryByRole('tab', { name: 'Sharing' })).not.toBeInTheDocument();
  });

  it('sharing tab for the owner', async () => {
    open('/server/mc1?tab=sharing');
    expect(await screen.findByText('Sam Rivera')).toBeInTheDocument();
  });

  it('terminal needs a running server', () => {
    load([{ ...mine, State: 'exited', Live: null }]);
    open('/server/mc1?tab=terminal');
    expect(screen.getByText('Start the server to open a terminal.')).toBeInTheDocument();
  });
});

describe('console', () => {
  it('streams the server log over an authenticated socket', async () => {
    open('/server/mc1?tab=console');
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    const ws = FakeWebSocket.last;
    expect(ws.url).toBe(`ws://${window.location.host}/api/servers/mc1/logs`);
    ws.open();
    await act(flushPromises);
    expect(ws.sent).toEqual(['id-token']);
    expect(screen.getByText('Live')).toBeInTheDocument();
    ws.receive('[Server] Done (3.2s)!\n');
    expect(terminals.all[0].output).toContain('[Server] Done (3.2s)!\n');
  });

  it('reports an expired session', async () => {
    open('/server/mc1?tab=console');
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    act(() => FakeWebSocket.last.serverClose(4401));
    expect(terminals.all[0].output.join('')).toContain('Not authorized');
    expect(screen.getByText('Not streaming')).toBeInTheDocument();
  });

  it('clear and reload', async () => {
    const user = userEvent.setup();
    open('/server/mc1?tab=console');
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    await user.click(screen.getByRole('button', { name: 'Clear console' }));
    expect(terminals.all[0].cleared).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Reload logs' }));
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    expect(terminals.all[0].disposed).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);
  });

  it('closes the stream when leaving the tab', async () => {
    const user = userEvent.setup();
    open('/server/mc1?tab=console');
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(FakeWebSocket.last.readyState).toBe(FakeWebSocket.CLOSED);
    expect(terminals.all[0].disposed).toBe(true);
  });
});

describe('terminal', () => {
  it('connects, authenticates, then relays keystrokes', async () => {
    open('/server/mc1?tab=terminal');
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    const ws = FakeWebSocket.last;
    expect(ws.url).toBe(`ws://${window.location.host}/api/servers/mc1/terminal`);
    const term = terminals.all[0];
    term.onDataHandler!('ignored before auth');
    ws.readyState = FakeWebSocket.OPEN;
    await act(async () => { await ws.onopen!(new Event('open')); });
    expect(ws.sent).toEqual(['id-token']);
    expect(screen.getByText('Connected')).toBeInTheDocument();
    term.onDataHandler!('ls\r');
    expect(ws.sent).toEqual(['id-token', 'ls\r']);
    ws.receive('file.txt\r\n');
    expect(term.output).toContain('file.txt\r\n');
  });

  it('closes without a session', async () => {
    getIdToken.mockResolvedValueOnce(null as unknown as string);
    open('/server/mc1?tab=terminal');
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    const ws = FakeWebSocket.last;
    ws.readyState = FakeWebSocket.OPEN;
    await act(async () => { await ws.onopen!(new Event('open')); });
    expect(ws.sent).toEqual([]);
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it('reports a closed or failed session', async () => {
    open('/server/mc1?tab=terminal');
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    const ws = FakeWebSocket.last;
    act(() => ws.onerror!(new Event('error')));
    act(() => ws.onclose!({ code: 4401 } as CloseEvent));
    const output = terminals.all[0].output.join('');
    expect(output).toContain('WebSocket Connection Error');
    expect(output).toContain('Not authorized');
    expect(output).toContain('Terminal session closed');
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });
});
