/**
 * Signing in, the route guard, the app shell (Main) and the dashboard pieces
 * around the server table.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { runInAction } from 'mobx';
import { Route, Routes } from 'react-router-dom';
import { FirebaseError } from 'firebase/app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeWebSocket, makeServer, renderWithProviders } from './test/utils';

const firebaseAuth = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(() => () => {}),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(function (this: { setCustomParameters: () => void }) { this.setCustomParameters = () => {}; }),
}));
vi.mock('firebase/auth', () => firebaseAuth);

const config = vi.hoisted(() => ({ configured: true }));
vi.mock('./Auth/firebase', () => ({
  auth: { name: 'auth' },
  get isFirebaseConfigured() { return config.configured; },
  getIdToken: async () => 'id-token',
}));

const getMe = vi.hoisted(() => vi.fn());
vi.mock('./Api/Auth', () => ({ AuthApi: { getMe } }));
vi.mock('./Api/System', () => ({
  SystemApi: {
    getSystemInfo: vi.fn(async () => ({ sys_info: { cpu_usage: 42.5, total_ram_gb: 32, used_ram_gb: 12.3, used_ram_pct: 38.4, time: new Date().toISOString() } })),
    getSystemIp: vi.fn(async () => ({ ip: '203.0.113.7' })),
  },
}));
vi.mock('./Api/Socket', () => ({ openAuthedSocket: (path: string) => new FakeWebSocket(path), WS_UNAUTHORIZED: 4401 }));
vi.mock('./Api/GameServer', async importOriginal => ({
  ...(await importOriginal<typeof import('./Api/GameServer')>()),
  GameServerApi: { getServers: vi.fn(async () => ({ msg: [] })), getGames: vi.fn(async () => []) },
}));

import Login from './Login';
import RequireAuth from './Auth/RequireAuth';
import Main from './Main';
import SystemInfo from './Main/Dashboard/SystemInfo';
import NotFound from './NotFound';
import { authStore } from './Store/AuthStore';
import { serverStore } from './Store/ServerStore';

type FakeUser = { uid: string; email: string; displayName: string | null; photoURL: string | null };
const ME: FakeUser = { uid: 'uid-me', email: 'jacob@example.com', displayName: 'Jacob Poling', photoURL: null };

function signedIn(user: FakeUser | null, initializing = false) {
  runInAction(() => {
    authStore.user = user as never;
    authStore.initializing = initializing;
    authStore.signingIn = false;
  });
}

beforeEach(() => {
  config.configured = true;
  FakeWebSocket.reset();
  signedIn(null);
  firebaseAuth.signInWithPopup.mockResolvedValue({});
  firebaseAuth.signOut.mockResolvedValue(undefined);
  getMe.mockResolvedValue({ uid: 'uid-me' });
  runInAction(() => { serverStore.servers = []; serverStore.loaded = true; });
});

// ---------------------------------------------------------------------------
describe('Login', () => {
  const renderLogin = () => renderWithProviders(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<div>app</div>} />
    </Routes>,
    { route: '/login' },
  );

  it('offers Google sign-in', () => {
    renderLogin();
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  });

  it('signs in with Google', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(firebaseAuth.signInWithPopup).toHaveBeenCalled();
    expect(getMe).toHaveBeenCalled();
  });

  it.each([
    [new FirebaseError('auth/popup-blocked', 'blocked'), 'Your browser blocked the sign-in popup. Allow popups for this site and try again.'],
    [new FirebaseError('auth/unauthorized-domain', 'x'), `${window.location.hostname} is not an authorized domain in Firebase. Add it under Authentication → Settings → Authorized domains.`],
    [new FirebaseError('auth/network-request-failed', 'x'), 'Sign-in failed (auth/network-request-failed).'],
    [new Error('weird'), 'Sign-in failed. Please try again.'],
  ])('explains %s', async (error, message) => {
    firebaseAuth.signInWithPopup.mockRejectedValue(error);
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('explains when the backend rejects the account', async () => {
    getMe.mockRejectedValue({ isAxiosError: true, response: { status: 403, data: { detail: 'This account is not allowed to access PlayHub' } } });
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByText('This account is not allowed to access PlayHub')).toBeInTheDocument();
    expect(firebaseAuth.signOut).toHaveBeenCalled();
  });

  it('explains when the backend is unreachable', async () => {
    getMe.mockRejectedValue({ isAxiosError: true, response: undefined });
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByText('Signed in with Google, but the PlayHub server could not be reached.')).toBeInTheDocument();
  });

  it.each(['auth/popup-closed-by-user', 'auth/cancelled-popup-request'])('says nothing when the user backs out (%s)', async code => {
    firebaseAuth.signInWithPopup.mockRejectedValue(new FirebaseError(code, 'closed'));
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(authStore.signingIn).toBe(false));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('errors can be dismissed', async () => {
    firebaseAuth.signInWithPopup.mockRejectedValue(new Error('x'));
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    const alert = await screen.findByRole('alert');
    await userEvent.click(alert.querySelector('button')!);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('warns when Firebase is not configured', () => {
    config.configured = false;
    renderLogin();
    expect(screen.getByText('Sign-in is not configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  });

  it('already signed in: goes to the app', () => {
    signedIn(ME);
    renderLogin();
    expect(screen.getByText('app')).toBeInTheDocument();
  });

  it('toggles the color scheme', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Toggle color theme' }));
    expect(document.documentElement).toHaveAttribute('data-mantine-color-scheme', 'light');
  });
});

// ---------------------------------------------------------------------------
describe('RequireAuth', () => {
  const app = () => (
    <Routes>
      <Route path="/login" element={<div>login page</div>} />
      <Route path="/*" element={<RequireAuth><div>secret dashboard</div></RequireAuth>} />
    </Routes>
  );

  it('waits for Firebase to restore the session', () => {
    signedIn(null, true);
    renderWithProviders(app(), { route: '/server/mc1' });
    expect(screen.queryByText('secret dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('login page')).not.toBeInTheDocument();
  });

  it('sends signed-out visitors to the login page', () => {
    renderWithProviders(app(), { route: '/server/mc1' });
    expect(screen.getByText('login page')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });

  it('shows the app when signed in', () => {
    signedIn(ME);
    renderWithProviders(app(), { route: '/server/mc1' });
    expect(screen.getByText('secret dashboard')).toBeInTheDocument();
  });

  it('after signing in, returns to where the user was headed', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<RequireAuth><div>secret dashboard</div></RequireAuth>} />
      </Routes>,
      { route: '/server/mc1?tab=console' },
    );
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    act(() => signedIn(ME));
    expect(await screen.findByText('secret dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/server/mc1');
  });
});

// ---------------------------------------------------------------------------
describe('Main (app shell)', () => {
  beforeEach(() => signedIn(ME));

  it('shows the signed-in user and signs out', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Main />);
    expect(screen.getByText('Jacob Poling')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(await screen.findByText('jacob@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(firebaseAuth.signOut).toHaveBeenCalled();
  });

  it('falls back to the email when there is no display name', () => {
    signedIn({ ...ME, displayName: null });
    renderWithProviders(<Main />);
    expect(screen.getByRole('button', { name: 'Account menu' })).toHaveTextContent('jacob@example.com');
  });

  it('navigation highlights the current page, including server pages', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Main />, { route: '/server/mc1' });
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('data-active', 'true');
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/settings');
    expect(await screen.findByText(/This is the settings page/)).toBeInTheDocument();
  });

  it('unknown pages', async () => {
    renderWithProviders(<Main />, { route: '/nope' });
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });

  it('subscribes to live server updates while mounted', () => {
    const { unmount } = renderWithProviders(<Main />);
    const ws = FakeWebSocket.last;
    expect(ws.url).toBe('/servers/live');
    unmount();
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it('celebrates when a new server comes up', async () => {
    runInAction(() => { serverStore.loaded = false; });
    renderWithProviders(<Main />);
    const ws = FakeWebSocket.last;
    const fresh = { Name: 'brand-new', ID: 'cid-new', Created: new Date().toISOString() };
    act(() => ws.receive({ type: 'servers', servers: [makeServer({ ...fresh, State: 'starting' })] }));
    act(() => ws.receive({ type: 'servers', servers: [makeServer({ ...fresh, State: 'running' })] }));
    expect(await screen.findByText('🎉 brand-new is live!')).toBeInTheDocument();
  });

  it('polls system stats every 3 seconds', async () => {
    const { SystemApi } = await import('./Api/System');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { unmount } = renderWithProviders(<Main />);
      const before = vi.mocked(SystemApi.getSystemInfo).mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
      expect(vi.mocked(SystemApi.getSystemInfo).mock.calls.length - before).toBeGreaterThanOrEqual(2);
      unmount();
      const after = vi.mocked(SystemApi.getSystemInfo).mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
      expect(vi.mocked(SystemApi.getSystemInfo).mock.calls.length).toBe(after);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
describe('SystemInfo', () => {
  it('collapses to a one-line summary and remembers it', async () => {
    const { systemInfoStore } = await import('./Store/SystemInfoStore');
    await systemInfoStore.fetchSystemInfoPoint();
    const user = userEvent.setup();
    renderWithProviders(<SystemInfo />);
    const toggle = screen.getByRole('button', { name: /System Information/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Total CPU Usage')).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(localStorage.getItem('playhub-system-info-expanded')).toBe('false');
    expect(toggle).toHaveTextContent('CPU 42.5%');
    expect(toggle).toHaveTextContent('RAM 38.4% (12.3 GB)');
  });

  it('starts collapsed if it was collapsed last time', () => {
    localStorage.setItem('playhub-system-info-expanded', 'false');
    renderWithProviders(<SystemInfo />);
    expect(screen.getByRole('button', { name: /System Information/ })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('NotFound', () => {
  it('renders', () => {
    renderWithProviders(<NotFound />);
    expect(document.body.textContent).toMatch(/not found|404/i);
  });
});
