import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MINECRAFT, PALWORLD, renderWithProviders } from '../../../test/utils';

const api = vi.hoisted(() => ({ getGames: vi.fn(), createServer: vi.fn() }));
vi.mock('../../../Api/GameServer', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../Api/GameServer')>()),
  GameServerApi: api,
}));

import ServerModal from './ServerModal';

beforeEach(() => {
  api.getGames.mockResolvedValue([MINECRAFT, PALWORLD]);
  api.createServer.mockImplementation(async (_payload, onQueued?: () => void) => { onQueued?.(); return true; });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function setup(props: Partial<React.ComponentProps<typeof ServerModal>> = {}) {
  const closeHandler = vi.fn();
  const onCreated = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(<ServerModal opened closeHandler={closeHandler} onCreated={onCreated} {...props} />);
  return { user, closeHandler, onCreated };
}

async function chooseGame(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(await screen.findByRole('textbox', { name: 'Game' }));
  // The dropdown renders outside the modal, which marks the rest of the page aria-hidden.
  await user.click(await screen.findByRole('option', { name: label, hidden: true }));
}

describe('ServerModal', () => {
  it('loads the game catalog when opened', async () => {
    setup();
    await chooseGame(userEvent.setup(), 'MINECRAFT');
    expect(api.getGames).toHaveBeenCalledOnce();
  });

  it('does not load while closed', () => {
    renderWithProviders(<ServerModal opened={false} closeHandler={() => {}} />);
    expect(api.getGames).not.toHaveBeenCalled();
  });

  it('a catalog failure is reported', async () => {
    api.getGames.mockRejectedValue(new Error('offline'));
    setup();
    expect(await screen.findByText('Failed to load game catalog.')).toBeInTheDocument();
  });

  it('renders the chosen game’s settings with their defaults', async () => {
    const { user } = setup();
    await chooseGame(user, 'MINECRAFT');
    expect(screen.getByLabelText(/Server Name/)).toHaveValue('');
    expect(screen.getByLabelText('Max Players')).toHaveValue('20');
    expect(screen.getByRole('checkbox', { name: /Accept Minecraft EULA/ })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Game Mode' })).toHaveValue('survival');
    expect(screen.getByText('Leave empty for a random world')).toBeInTheDocument();
    expect(screen.getByText(/Internal Container Port: 25565/)).toBeInTheDocument();
  });

  it('switching games resets the fields', async () => {
    const { user } = setup();
    await chooseGame(user, 'MINECRAFT');
    await chooseGame(user, 'PALWORLD');
    expect(screen.queryByText('Accept Minecraft EULA')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Max Players')).toHaveValue('32');
    expect(screen.getByLabelText('Server Password')).toHaveAttribute('type', 'password');
  });

  it('submit stays disabled until the server has a name', async () => {
    const { user } = setup();
    await chooseGame(user, 'MINECRAFT');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Server Name/), 'my-world');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
  });

  it('creates the server, then closes as soon as it is queued', async () => {
    const { user, closeHandler, onCreated } = setup();
    await chooseGame(user, 'MINECRAFT');
    await user.type(screen.getByLabelText(/Server Name/), '  my-world ');
    await user.clear(screen.getByLabelText('Max Players'));
    await user.type(screen.getByLabelText('Max Players'), '8');
    await user.type(screen.getByLabelText('World Seed'), '42');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(api.createServer).toHaveBeenCalledWith({
      game_type: 'minecraft',
      name: 'my-world',
      environment: { MAX_PLAYERS: 8, EULA: true, MODE: 'survival', SEED: '42' },
    }, expect.any(Function));
    expect(await screen.findByText(/my-world is starting up/)).toBeInTheDocument();
    expect(closeHandler).toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalled();
  });

  it('validates the name before sending', async () => {
    const { user } = setup();
    await chooseGame(user, 'MINECRAFT');
    await user.type(screen.getByLabelText(/Server Name/), 'my world!');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Can only contain letters, numbers, ".", "_", or "-"')).toBeInTheDocument();
    expect(api.createServer).not.toHaveBeenCalled();
  });

  it('validates settings before sending', async () => {
    const { user } = setup();
    await chooseGame(user, 'PALWORLD');
    await user.type(screen.getByLabelText(/Server Name/), 'pals');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Required')).toBeInTheDocument(); // Admin Token
    expect(api.createServer).not.toHaveBeenCalled();
  });

  it('shows the backend’s per-field errors inline', async () => {
    api.createServer.mockRejectedValue({
      isAxiosError: true,
      response: { status: 422, data: { detail: { msg: 'Invalid server settings', fields: { MAX_PLAYERS: 'Must be at most 50' } } } },
    });
    const { user, closeHandler } = setup();
    await chooseGame(user, 'MINECRAFT');
    await user.type(screen.getByLabelText(/Server Name/), 'my-world');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Must be at most 50')).toBeInTheDocument();
    expect(screen.getByText('Invalid server settings')).toBeInTheDocument();
    expect(closeHandler).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument(); // can fix and retry
  });

  it('shows plain error messages', async () => {
    api.createServer.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { detail: "The name 'my-world' is already taken" } } });
    const { user } = setup();
    await chooseGame(user, 'MINECRAFT');
    await user.type(screen.getByLabelText(/Server Name/), 'my-world');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText("The name 'my-world' is already taken")).toBeInTheDocument();
  });

  it('a create job that fails later is reported', async () => {
    api.createServer.mockImplementation(async (_payload, onQueued?: () => void) => { onQueued?.(); return false; });
    const { user } = setup();
    await chooseGame(user, 'MINECRAFT');
    await user.type(screen.getByLabelText(/Server Name/), 'my-world');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText("my-world couldn't be created. Check its status for details.")).toBeInTheDocument();
  });

  it('shows progress while queueing', async () => {
    api.createServer.mockReturnValue(new Promise(() => {}));
    const { user } = setup();
    await chooseGame(user, 'MINECRAFT');
    await user.type(screen.getByLabelText(/Server Name/), 'my-world');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Queueing your game server...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });

  it('cancel closes and resets', async () => {
    const { user, closeHandler } = setup();
    await chooseGame(user, 'MINECRAFT');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(closeHandler).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText(/Server Name/)).not.toBeInTheDocument());
  });
});
