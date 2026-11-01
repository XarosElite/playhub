import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FRIEND, FakeWebSocket, MINECRAFT, OTHER, makeLive, makeServer, renderWithProviders } from '../../../test/utils';
import { ServerActionType, TopLevelServerType } from '../../../Api/GameServer';

const api = vi.hoisted(() => ({
  getServers: vi.fn(),
  getGames: vi.fn(),
  makeServerAction: vi.fn(),
  deleteServer: vi.fn(),
  getShares: vi.fn(),
  setShares: vi.fn(),
}));
vi.mock('../../../Api/GameServer', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../Api/GameServer')>()),
  GameServerApi: api,
}));
vi.mock('../../../Api/Socket', () => ({
  openAuthedSocket: (path: string) => new FakeWebSocket(path),
  WS_UNAUTHORIZED: 4401,
}));
const users = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../../Api/Users', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../Api/Users')>()),
  UsersApi: users,
}));

import ServerTable from './ServerTable';
import { serverStore } from '../../../Store/ServerStore';
import { systemInfoStore } from '../../../Store/SystemInfoStore';

function load(servers: TopLevelServerType[], loaded = true) {
  runInAction(() => {
    serverStore.servers = servers;
    serverStore.loaded = loaded;
  });
}

const rowFor = (name: string) => screen.getByText(name, { selector: 'p' }).closest('tr')!;
const visibleNames = () => Array.from(document.querySelectorAll('tbody tr[data-row-id]'))
  .map(row => row.querySelector('p')?.textContent);

const survival = makeServer({ Name: 'survival-world', ID: 'cid-survival', Created: '2026-10-01T00:00:00Z', SharedWith: [FRIEND, OTHER] });
const creative = makeServer({ Name: 'creative-build', ID: 'cid-creative', State: 'exited', Created: '2026-10-02T00:00:00Z', Live: null });
const pals = makeServer({
  Name: 'pals-with-sam', ID: 'cid-pals', GameType: 'palworld', Protocol: 'udp', SupportsPlayers: false,
  Created: '2026-10-03T00:00:00Z', IsOwner: false, Owner: FRIEND, SharedWith: null,
  Live: makeLive({ players: null }),
});

beforeEach(() => {
  FakeWebSocket.reset();
  load([survival, creative, pals]);
  runInAction(() => { systemInfoStore.systemIP = '203.0.113.7'; });
  api.getServers.mockImplementation(async () => ({ msg: serverStore.servers }));
  api.getGames.mockResolvedValue([MINECRAFT]);
  api.makeServerAction.mockImplementation(async (_id, _action, onQueued?: () => void) => { onQueued?.(); return true; });
  api.deleteServer.mockResolvedValue(undefined);
});

describe('loading and empty states', () => {
  it('shows a skeleton until the first update arrives', () => {
    load([], false);
    renderWithProviders(<ServerTable />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search servers')).toBeInTheDocument();
  });

  it('invites you to add a first server', async () => {
    load([]);
    renderWithProviders(<ServerTable />);
    expect(screen.getByText('No servers yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add your first server' }));
    expect(await screen.findByText('Add Server', { selector: 'h2' })).toBeInTheDocument();
    expect(api.getGames).toHaveBeenCalled();
  });
});

describe('rows', () => {
  it('lists every server with its status, players and owner badges', () => {
    renderWithProviders(<ServerTable />);
    expect(visibleNames()).toEqual(['survival-world', 'creative-build', 'pals-with-sam']);

    const survivalRow = rowFor('survival-world');
    expect(within(survivalRow).getByText('Running')).toBeInTheDocument();
    expect(within(survivalRow).getByText('3 / 20')).toBeInTheDocument(); // players online
    expect(within(survivalRow).getByText(/Created .* ago/)).toBeInTheDocument();
    expect(within(survivalRow).getByText('2')).toBeInTheDocument(); // shared with two people

    expect(within(rowFor('creative-build')).getByText('Stopped')).toBeInTheDocument();
    const palsRow = rowFor('pals-with-sam');
    expect(within(palsRow).getByText('Shared')).toBeInTheDocument();
    expect(within(palsRow).getAllByText('—').length).toBeGreaterThan(0); // no player counts for Palworld
  });

  it('shows the connect address', () => {
    renderWithProviders(<ServerTable />);
    expect(screen.getAllByText(`203.0.113.7:${survival.Ports.primary_port}`).length).toBeGreaterThan(0);
  });

  it('updates live as the store changes', async () => {
    renderWithProviders(<ServerTable />);
    act(() => load([{ ...survival, State: 'stopping', Live: null }, creative, pals]));
    expect(within(rowFor('survival-world')).getByText('Stopping')).toBeInTheDocument();
  });
});

describe('search and filters', () => {
  it('filters as you type and explains when nothing matches', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServerTable />);
    await user.type(screen.getByPlaceholderText('Search servers'), 'creative');
    expect(visibleNames()).toEqual(['creative-build']);

    await user.type(screen.getByPlaceholderText('Search servers'), '-nope');
    expect(screen.getByText('No servers match')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(visibleNames()).toHaveLength(3);
  });

  it('clearing the search box', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServerTable />);
    await user.type(screen.getByPlaceholderText('Search servers'), 'pals');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(visibleNames()).toHaveLength(3);
  });

  it('All / Mine / Shared with me', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServerTable />);
    await user.click(screen.getByText('Shared with me'));
    expect(visibleNames()).toEqual(['pals-with-sam']);
    await user.click(screen.getByText('Mine'));
    expect(visibleNames()).toEqual(['survival-world', 'creative-build']);
  });

  it('the scope control only appears when something is shared with you', () => {
    load([survival, creative]);
    renderWithProviders(<ServerTable />);
    expect(screen.queryByText('Shared with me')).not.toBeInTheDocument();
  });

  it('game chips', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServerTable />);
    await user.click(screen.getByRole('checkbox', { name: 'palworld' }));
    expect(visibleNames()).toEqual(['pals-with-sam']);
  });

  it('status filter', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServerTable />);
    await user.click(screen.getByRole('textbox', { name: 'Filter by status' }));
    await user.click(await screen.findByRole('option', { name: 'Stopped' }));
    expect(visibleNames()).toEqual(['creative-build']);
  });
});

describe('sorting', () => {
  it('defaults to oldest first and toggles by column', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServerTable />);
    expect(visibleNames()).toEqual(['survival-world', 'creative-build', 'pals-with-sam']);
    await user.click(screen.getByRole('button', { name: /^Name/ }));
    await waitFor(() => expect(visibleNames()).toEqual(['creative-build', 'pals-with-sam', 'survival-world']));
    await user.click(screen.getByRole('button', { name: /^Name/ }));
    await waitFor(() => expect(visibleNames()).toEqual(['survival-world', 'pals-with-sam', 'creative-build']));
  });

  it('remembers the sort between visits', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<ServerTable />);
    await user.click(screen.getByRole('button', { name: /^Status/ }));
    expect(JSON.parse(localStorage.getItem('playhub-server-sort')!)).toEqual({ columnAccessor: 'State', direction: 'asc' });
    unmount();
    renderWithProviders(<ServerTable />);
    expect(visibleNames()[visibleNames().length - 1]).toBe('creative-build');
  });
});

describe('row actions', () => {
  it('stop button stops a running server and shows progress straight away', async () => {
    let finish!: (ok: boolean) => void;
    api.makeServerAction.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderWithProviders(<ServerTable />);
    await userEvent.click(screen.getByRole('button', { name: 'Stop survival-world' }));
    expect(api.makeServerAction).toHaveBeenCalledWith('cid-survival', ServerActionType.STOP, expect.any(Function));
    expect(within(rowFor('survival-world')).getByText('Stopping')).toBeInTheDocument();
    await act(async () => finish(true));
  });

  it('start button starts a stopped server', async () => {
    renderWithProviders(<ServerTable />);
    await userEvent.click(screen.getByRole('button', { name: 'Start creative-build' }));
    expect(api.makeServerAction).toHaveBeenCalledWith('cid-creative', ServerActionType.START, expect.any(Function));
  });

  it('busy servers cannot be toggled', () => {
    load([{ ...survival, State: 'restarting' }]);
    renderWithProviders(<ServerTable />);
    expect(screen.getByRole('button', { name: 'Start survival-world' })).toBeDisabled();
  });

  it('failed actions are reported', async () => {
    api.makeServerAction.mockResolvedValue(false);
    renderWithProviders(<ServerTable />);
    await userEvent.click(screen.getByRole('button', { name: 'Start creative-build' }));
    expect(await screen.findByText("Couldn't start the server. Hover its status for details.")).toBeInTheDocument();
  });

  it('API errors show the reason', async () => {
    api.makeServerAction.mockRejectedValue({ isAxiosError: true, response: { data: { detail: 'creative-build is busy (updating).' } } });
    renderWithProviders(<ServerTable />);
    await userEvent.click(screen.getByRole('button', { name: 'Start creative-build' }));
    expect(await screen.findByText('creative-build is busy (updating).')).toBeInTheDocument();
  });

  it('owners can share and delete from the menu; shared users cannot', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServerTable />);
    await user.click(screen.getByRole('button', { name: 'More actions for survival-world' }));
    expect(await screen.findByRole('menuitem', { name: 'Share…' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete…' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'More actions for pals-with-sam' }));
    expect(await screen.findByRole('menuitem', { name: 'Open server page' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Share…' })).not.toBeInTheDocument();
  });

  it('restart is only offered for running servers', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServerTable />);
    await user.click(screen.getByRole('button', { name: 'More actions for creative-build' }));
    expect(await screen.findByRole('menuitem', { name: 'Restart' })).toBeDisabled();
  });

  it('deleting asks first, then removes the server', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServerTable />);
    await user.click(screen.getByRole('button', { name: 'More actions for creative-build' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    expect(await screen.findByText('Delete creative-build?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(api.deleteServer).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'More actions for creative-build' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    await user.click(await screen.findByRole('button', { name: 'Delete server' }));
    expect(api.deleteServer).toHaveBeenCalledWith('cid-creative');
    expect(await screen.findByText('Server deleted.')).toBeInTheDocument();
    await waitFor(() => expect(visibleNames()).not.toContain('creative-build'));
  });

  it('a failed delete is reported and the server stays', async () => {
    const user = userEvent.setup();
    api.deleteServer.mockRejectedValue({ isAxiosError: true, response: { data: { detail: "Only the server's owner can delete it" } } });
    renderWithProviders(<ServerTable />);
    await user.click(screen.getByRole('button', { name: 'More actions for creative-build' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    await user.click(await screen.findByRole('button', { name: 'Delete server' }));
    expect(await screen.findByText("Only the server's owner can delete it")).toBeInTheDocument();
    expect(visibleNames()).toContain('creative-build');
  });

  it('open server page from the menu', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServerTable />);
    await user.click(screen.getByRole('button', { name: 'More actions for survival-world' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Open server page' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/server/survival-world');
  });

  it('double-clicking a row opens its page', async () => {
    renderWithProviders(<ServerTable />);
    await userEvent.dblClick(rowFor('pals-with-sam'));
    expect(screen.getByTestId('location')).toHaveTextContent('/server/pals-with-sam');
  });
});

describe('expanded rows', () => {
  it('clicking a row shows its details', async () => {
    const user = userEvent.setup();
    load([{ ...survival, StatusMessage: null }, { ...creative, StatusMessage: 'Stopped unexpectedly (exit code 137)' }]);
    renderWithProviders(<ServerTable />);
    await user.click(rowFor('creative-build'));
    expect(await screen.findByText('Stopped unexpectedly (exit code 137)')).toBeInTheDocument();
    expect(screen.getByText('Address · TCP')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
  });
});

describe('a server coming up', () => {
  it('keeps its row (and expansion) when its ID changes to the container ID', async () => {
    const user = userEvent.setup();
    const starting = makeServer({ Name: 'fresh', ID: 'fresh', State: 'starting', Live: null });
    load([starting]);
    renderWithProviders(<ServerTable />);
    await user.click(rowFor('fresh'));
    expect(await screen.findByText('Address · TCP')).toBeInTheDocument();

    act(() => load([{ ...starting, ID: 'cid-fresh', State: 'running', Live: makeLive() }]));
    expect(document.querySelectorAll('tbody tr[data-row-id]')).toHaveLength(1);
    expect(document.querySelector('.rowLeaving')).toBeNull();
    expect(within(rowFor('fresh')).getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Address · TCP')).toBeInTheDocument(); // still expanded
  });
});

describe('keyboard', () => {
  it('/ focuses search; arrows move; Enter expands; O opens', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServerTable />);
    await user.keyboard('/');
    expect(screen.getByPlaceholderText('Search servers')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByPlaceholderText('Search servers')).not.toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(rowFor('survival-world')).toHaveClass('rowActive');
    await user.keyboard('{ArrowDown}');
    expect(rowFor('creative-build')).toHaveClass('rowActive');
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(rowFor('survival-world')).toHaveClass('rowActive');

    await user.keyboard('{Enter}');
    expect(await screen.findByText('Address · TCP')).toBeInTheDocument();
    await user.keyboard('o');
    expect(screen.getByTestId('location')).toHaveTextContent('/server/survival-world');
  });
});

describe('bulk actions', () => {
  const select = async (user: ReturnType<typeof userEvent.setup>, name: string) =>
    user.click(within(rowFor(name)).getByRole('checkbox'));

  it('appears when servers are selected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServerTable />);
    await select(user, 'survival-world');
    await select(user, 'creative-build');
    expect(await screen.findByText('2 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    await waitFor(() => expect(screen.queryByText('2 selected')).not.toBeInTheDocument());
  });

  it('only acts on servers the action applies to', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServerTable />);
    await select(user, 'survival-world');
    await select(user, 'creative-build');
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(api.makeServerAction).toHaveBeenCalledTimes(1);
    expect(api.makeServerAction).toHaveBeenCalledWith('cid-survival', ServerActionType.STOP, expect.any(Function));
    expect(await screen.findByText('1 server stopped.')).toBeInTheDocument();
  });

  it('says so when nothing applies', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServerTable />);
    await select(user, 'creative-build');
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByText('None of the selected servers can be stopped right now.')).toBeInTheDocument();
    expect(api.makeServerAction).not.toHaveBeenCalled();
  });

  it('reports partial failures', async () => {
    const user = userEvent.setup();
    load([survival, { ...creative, State: 'running' }, pals]);
    api.makeServerAction.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    renderWithProviders(<ServerTable />);
    await select(user, 'survival-world');
    await select(user, 'creative-build');
    await user.click(await screen.findByRole('button', { name: 'Restart' }));
    expect(await screen.findByText('1 of 2 servers restarted; 1 failed.')).toBeInTheDocument();
  });

  it('bulk delete skips servers you do not own', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServerTable />);
    await select(user, 'creative-build');
    await select(user, 'pals-with-sam');
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete 1 server?')).toBeInTheDocument();
    expect(screen.getByText(/1 shared server will be skipped/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteServer).toHaveBeenCalledTimes(1));
    expect(api.deleteServer).toHaveBeenCalledWith('cid-creative');
  });

  it('bulk delete of only shared servers explains why not', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ServerTable />);
    await select(user, 'pals-with-sam');
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByText("Only a server's owner can delete it.")).toBeInTheDocument();
  });
});
