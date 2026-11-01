/**
 * Helpers shared by the component tests: a provider wrapper matching App.tsx,
 * fixture factories, and a controllable fake WebSocket.
 */
import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MotionConfig } from 'motion/react';

import { ServerLiveType, TopLevelServerType, GameCatalogType } from '../Api/GameServer';
import { UserSummaryType } from '../Api/Users';

interface ProviderOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial URL, e.g. "/server/mc1?tab=settings". */
  route?: string;
  /** Route pattern the UI is mounted at, e.g. "/server/:serverId". */
  path?: string;
}

/** Shows the current location so tests can assert navigation. */
export const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
};

export function renderWithProviders(ui: React.ReactElement, { route = '/', path, ...options }: ProviderOptions = {}) {
  // A wrapper (rather than wrapping `ui`) so rerender() keeps the providers.
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <MotionConfig reducedMotion="always">
      <MantineProvider defaultColorScheme="dark">
        <Notifications />
        <ModalsProvider>
          <MemoryRouter initialEntries={[route]}>
            {path
              ? <Routes><Route path={path} element={children} /><Route path="*" element={null} /></Routes>
              : children}
            <LocationProbe />
          </MemoryRouter>
        </ModalsProvider>
      </MantineProvider>
    </MotionConfig>
  );
  return render(ui, { wrapper: Wrapper, ...options });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
export const ME: UserSummaryType = { uid: 'uid-me', name: 'Jacob', email: 'jacob@example.com', picture: null };
export const FRIEND: UserSummaryType = { uid: 'uid-sam', name: 'Sam Rivera', email: 'sam@example.com', picture: null };
export const OTHER: UserSummaryType = { uid: 'uid-alex', name: 'Alex Chen', email: 'alex@example.com', picture: null };

let serverCount = 0;

export function makeLive(overrides: Partial<ServerLiveType> = {}): ServerLiveType {
  return {
    cpu_pct: 12.5,
    mem_used_mb: 1536,
    mem_limit_mb: 8192,
    players: { online: 3, max: 20, version: '1.21.4' },
    started_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    updated: new Date().toISOString(),
    history: [
      { time: new Date(Date.now() - 6000).toISOString(), cpu_pct: 10, mem_used_mb: 1500 },
      { time: new Date(Date.now() - 3000).toISOString(), cpu_pct: 12.5, mem_used_mb: 1536 },
    ],
    ...overrides,
  };
}

export function makeServer(overrides: Partial<TopLevelServerType> = {}): TopLevelServerType {
  serverCount += 1;
  const name = overrides.Name ?? `server-${serverCount}`;
  const state = overrides.State ?? 'running';
  return {
    Created: new Date(Date.now() - serverCount * 86400 * 1000).toISOString(),
    GameType: 'minecraft',
    ID: `cid-${name}`,
    Image: 'itzg/minecraft-server',
    Name: name,
    State: state,
    StatusMessage: null,
    Ports: { primary_port: 10000 + serverCount },
    Protocol: 'tcp',
    SupportsPlayers: true,
    Live: state === 'running' ? makeLive() : null,
    IsOwner: true,
    Owner: ME,
    SharedWith: [],
    ...overrides,
  };
}

export const MINECRAFT: GameCatalogType = {
  game_type: 'minecraft',
  image: 'itzg/minecraft-server',
  internal_port: 25565,
  protocol: 'tcp',
  supports_players: true,
  common_fields: {
    MAX_PLAYERS: { type: 'integer', label: 'Max Players', required: false, default: 20, min: 1, max: 100 },
  },
  fields: {
    EULA: { type: 'boolean', label: 'Accept Minecraft EULA', required: true, default: true, description: 'Required by the server to start' },
    MODE: { type: 'string', label: 'Game Mode', required: false, default: 'survival', enum: ['survival', 'creative', 'adventure', 'spectator'] },
    SEED: { type: 'string', label: 'World Seed', required: false, default: null, description: 'Leave empty for a random world' },
  },
};

export const PALWORLD: GameCatalogType = {
  game_type: 'palworld',
  image: 'thijsvanloef/palworld-server-docker:latest',
  internal_port: 8211,
  protocol: 'udp',
  supports_players: false,
  common_fields: {
    SERVER_PASSWORD: { type: 'password', label: 'Server Password', required: false, default: null },
    MAX_PLAYERS: { type: 'integer', label: 'Max Players', required: false, default: 32, min: 1, max: 100 },
  },
  fields: {
    EXP_RATE: { type: 'number', label: 'EXP Rate', required: false, default: 1.0 },
    ADMIN_TOKEN: { type: 'string', label: 'Admin Token', required: true, default: null },
  },
};

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
type Listener = (event: Event) => void;

/** Stands in for the browser WebSocket; tests drive it with open()/receive()/serverClose(). */
export class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  static get last(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  static reset() {
    FakeWebSocket.instances = [];
  }

  addEventListener(type: string, listener: Listener) {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter(l => l !== listener);
  }

  send(data: string) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('WebSocket is not open');
    this.sent.push(data);
  }

  close(code = 1000) {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code } as CloseEvent);
  }

  // --- test controls ---
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', new Event('open'));
  }

  receive(data: unknown) {
    this.emit('message', { data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent);
  }

  serverClose(code = 1006) {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code } as CloseEvent);
  }

  private emit(type: string, event: unknown) {
    (this.listeners[type] ?? []).forEach(l => l(event as Event));
    const handler = (this as unknown as Record<string, ((e: unknown) => void) | null>)[`on${type}`];
    handler?.(event);
  }
}

/** Resolves after pending promise callbacks have run. */
export const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 0));
