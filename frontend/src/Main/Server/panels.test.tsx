import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FRIEND, MINECRAFT, OTHER, makeServer, renderWithProviders } from '../../test/utils';
import { ServerEventType } from '../../Api/GameServer';

const api = vi.hoisted(() => ({
  getGames: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getShares: vi.fn(),
  setShares: vi.fn(),
  getActivity: vi.fn(),
}));
vi.mock('../../Api/GameServer', async importOriginal => ({
  ...(await importOriginal<typeof import('../../Api/GameServer')>()),
  GameServerApi: api,
}));
const users = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../Api/Users', async importOriginal => ({
  ...(await importOriginal<typeof import('../../Api/Users')>()),
  UsersApi: users,
}));

import SettingsPanel from './SettingsPanel';
import SharePanel from './SharePanel';
import ActivityTimeline from './ActivityTimeline';

const server = makeServer({ Name: 'mc1', ID: 'cid-mc1' });

// ---------------------------------------------------------------------------
describe('SettingsPanel', () => {
  beforeEach(() => {
    api.getGames.mockResolvedValue([MINECRAFT]);
    api.getSettings.mockResolvedValue({ game_type: 'minecraft', environment: { MAX_PLAYERS: 12, EULA: true, MODE: 'creative' } });
    api.updateSettings.mockResolvedValue({ job_id: 'job-1', changed: ['Max Players'] });
  });

  it('loads the saved settings, filling gaps with defaults', async () => {
    renderWithProviders(<SettingsPanel server={server} onSaved={() => {}} />);
    expect(await screen.findByLabelText('Max Players')).toHaveValue('12');
    expect(screen.getByRole('textbox', { name: 'Game Mode' })).toHaveValue('creative');
    expect(screen.getByLabelText('World Seed')).toHaveValue('');
    expect(api.getSettings).toHaveBeenCalledWith('mc1');
  });

  it('nothing to save until something changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPanel server={server} onSaved={() => {}} />);
    const save = await screen.findByRole('button', { name: 'Save settings' });
    expect(save).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeDisabled();
    await user.type(screen.getByLabelText('World Seed'), '1');
    expect(save).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('World Seed')).toHaveValue('');
    expect(save).toBeDisabled();
  });

  it('confirms the restart, then saves', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithProviders(<SettingsPanel server={server} onSaved={onSaved} />);
    const players = await screen.findByLabelText('Max Players');
    await user.clear(players);
    await user.type(players, '30');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('Apply new settings?')).toBeInTheDocument();
    expect(api.updateSettings).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Apply and restart' }));

    expect(api.updateSettings).toHaveBeenCalledWith('mc1', { MAX_PLAYERS: 30, EULA: true, MODE: 'creative', SEED: '' });
    expect(await screen.findByText('Applying Max Players. The server restarts with the new settings.')).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalled();
  });

  it('cancelling the confirmation saves nothing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPanel server={server} onSaved={() => {}} />);
    await user.type(await screen.findByLabelText('World Seed'), '9');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it('numbers are kept within their bounds', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPanel server={server} onSaved={() => {}} />);
    const players = await screen.findByLabelText('Max Players');
    await user.clear(players);
    await user.type(players, '500');
    await user.tab();
    expect(players).toHaveValue('100');
  });

  it('backend field errors appear inline', async () => {
    const user = userEvent.setup();
    api.updateSettings.mockRejectedValue({
      isAxiosError: true,
      response: { status: 422, data: { detail: { msg: 'Invalid server settings', fields: { SEED: 'Must be text' } } } },
    });
    renderWithProviders(<SettingsPanel server={server} onSaved={() => {}} />);
    await user.type(await screen.findByLabelText('World Seed'), 'x');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await user.click(await screen.findByRole('button', { name: 'Apply and restart' }));
    expect(await screen.findByText('Must be text')).toBeInTheDocument();
    expect(screen.getByText('Invalid server settings')).toBeInTheDocument();
  });

  it('busy servers cannot be reconfigured', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPanel server={{ ...server, State: 'updating' }} onSaved={() => {}} />);
    const seed = await screen.findByLabelText('World Seed');
    expect(seed).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it('says so when nothing changed on the server', async () => {
    const user = userEvent.setup();
    api.updateSettings.mockResolvedValue({ job_id: null, changed: [] });
    const onSaved = vi.fn();
    renderWithProviders(<SettingsPanel server={server} onSaved={onSaved} />);
    await user.type(await screen.findByLabelText('World Seed'), ' ');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await user.click(await screen.findByRole('button', { name: 'Apply and restart' }));
    expect(await screen.findByText('No changes to apply.')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('games removed from the catalog cannot be edited', async () => {
    api.getGames.mockResolvedValue([]);
    renderWithProviders(<SettingsPanel server={server} onSaved={() => {}} />);
    expect(await screen.findByText(/no longer in the catalog/)).toBeInTheDocument();
  });

  it('load failures are reported', async () => {
    api.getSettings.mockRejectedValue(new Error('404'));
    renderWithProviders(<SettingsPanel server={server} onSaved={() => {}} />);
    expect(await screen.findByText('Unable to load settings.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('SharePanel', () => {
  beforeEach(() => {
    users.list.mockResolvedValue([FRIEND, OTHER]);
    api.getShares.mockResolvedValue([FRIEND]);
    api.setShares.mockImplementation(async (_id: string, ids: string[]) => [FRIEND, OTHER].filter(u => ids.includes(u.uid)));
  });

  it('shows who it is already shared with', async () => {
    renderWithProviders(<SharePanel server={server} />);
    expect(await screen.findByText('Sam Rivera')).toBeInTheDocument();
    expect(api.getShares).toHaveBeenCalledWith('cid-mc1');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('adds someone, found by email', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithProviders(<SharePanel server={server} onSaved={onSaved} />);
    const input = await screen.findByRole('textbox', { name: 'Shared with' });
    await user.click(input);
    await user.type(input, 'alex@');
    await user.click(await screen.findByRole('option', { name: /Alex Chen/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.setShares).toHaveBeenCalledWith('cid-mc1', ['uid-sam', 'uid-alex']);
    expect(await screen.findByText('mc1 is shared with 2 people.')).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalled();
  });

  it('search with no matches', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SharePanel server={server} />);
    const input = await screen.findByRole('textbox', { name: 'Shared with' });
    await user.click(input);
    await user.type(input, 'zzz');
    expect(await screen.findByText('No one matches')).toBeInTheDocument();
  });

  it('removing everyone', async () => {
    const user = userEvent.setup();
    api.setShares.mockResolvedValue([]);
    renderWithProviders(<SharePanel server={server} />);
    await screen.findByText('Sam Rivera');
    await user.click(screen.getByRole('textbox', { name: 'Shared with' }));
    await user.keyboard('{Backspace}');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.setShares).toHaveBeenCalledWith('cid-mc1', []);
    expect(await screen.findByText('mc1 is no longer shared.')).toBeInTheDocument();
  });

  it('nobody else has signed in yet', async () => {
    users.list.mockResolvedValue([]);
    api.getShares.mockResolvedValue([]);
    renderWithProviders(<SharePanel server={server} />);
    expect(await screen.findByText(/Nobody else has signed in to PlayHub yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('save errors are reported', async () => {
    const user = userEvent.setup();
    api.setShares.mockRejectedValue({ isAxiosError: true, response: { data: { detail: 'Unknown user(s): uid-x' } } });
    renderWithProviders(<SharePanel server={server} />);
    await screen.findByText('Sam Rivera');
    await user.click(screen.getByRole('textbox', { name: 'Shared with' }));
    await user.keyboard('{Backspace}');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Unknown user(s): uid-x')).toBeInTheDocument();
  });

  it('load errors are reported', async () => {
    users.list.mockRejectedValue(new Error('500'));
    renderWithProviders(<SharePanel server={server} />);
    expect(await screen.findByText('Unable to load users.')).toBeInTheDocument();
  });

  it('cancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithProviders(<SharePanel server={server} onCancel={onCancel} />);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('ActivityTimeline', () => {
  const event = (id: number, action: ServerEventType['action'], detail: string | null, actor = FRIEND): ServerEventType =>
    ({ id, action, detail, created: new Date(Date.now() - id * 60000).toISOString(), actor });

  it('describes each event and who did it', async () => {
    api.getActivity.mockResolvedValue([
      event(1, 'settings_updated', 'Game Mode, Max Players'),
      event(2, 'shared', 'Alex Chen'),
      { ...event(3, 'crashed', 'Stopped unexpectedly (exit code 137)'), actor: null },
      event(4, 'created', null),
    ]);
    renderWithProviders(<ActivityTimeline serverId="mc1" refreshKey="a" />);
    expect(await screen.findByText('changed Game Mode, Max Players')).toBeInTheDocument();
    expect(screen.getByText('shared it with Alex Chen')).toBeInTheDocument();
    expect(screen.getByText('Stopped unexpectedly (exit code 137)')).toBeInTheDocument();
    expect(screen.getByText('created the server')).toBeInTheDocument();
    expect(screen.getAllByText('Sam Rivera')).toHaveLength(3); // not on the system event
    expect(screen.getByText('4 minutes ago')).toBeInTheDocument();
  });

  it.each([
    ['started', null, 'started the server'],
    ['stopped', null, 'stopped the server'],
    ['restarted', null, 'restarted the server'],
    ['unshared', 'Bob', 'stopped sharing with Bob'],
    ['deleted', null, 'deleted the server'],
    ['failed', "Couldn't start: boom", "Couldn't start: boom"],
    ['failed', null, 'A job failed'],
    ['missing', null, 'The container went missing'],
    ['crashed', null, 'The server stopped unexpectedly'],
    ['settings_updated', null, 'changed settings'],
    ['something_new', null, 'something_new'],
  ])('%s', async (action, detail, text) => {
    api.getActivity.mockResolvedValue([event(1, action as ServerEventType['action'], detail)]);
    renderWithProviders(<ActivityTimeline serverId="mc1" refreshKey="a" />);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('empty', async () => {
    api.getActivity.mockResolvedValue([]);
    renderWithProviders(<ActivityTimeline serverId="mc1" refreshKey="a" />);
    expect(await screen.findByText('No activity yet.')).toBeInTheDocument();
  });

  it('errors read as empty', async () => {
    api.getActivity.mockRejectedValue(new Error('500'));
    renderWithProviders(<ActivityTimeline serverId="mc1" refreshKey="a" />);
    expect(await screen.findByText('No activity yet.')).toBeInTheDocument();
  });

  it('reloads when the server changes state', async () => {
    api.getActivity.mockResolvedValue([]);
    const { rerender } = renderWithProviders(<ActivityTimeline serverId="mc1" refreshKey="running|0" />);
    await waitFor(() => expect(api.getActivity).toHaveBeenCalledTimes(1));
    rerender(<ActivityTimeline serverId="mc1" refreshKey="exited|0" />);
    await waitFor(() => expect(api.getActivity).toHaveBeenCalledTimes(2));
  });
});
