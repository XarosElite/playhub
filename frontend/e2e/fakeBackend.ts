/**
 * A stateful, in-memory PlayHub API for browser tests. It answers the app's
 * REST calls and WebSockets (via Playwright routing), and simulates the
 * worker: jobs settle after a short delay and every change is pushed to open
 * /servers/live sockets, like the real API.
 */
import type { Page, Route, WebSocketRoute } from '@playwright/test';

export interface FakeUser { uid: string; name: string | null; email: string | null; picture: string | null }
export interface FakeServer {
  Created: string; GameType: string; ID: string; Image: string; Name: string; State: string;
  StatusMessage: string | null; Ports: { primary_port: number }; Protocol: 'tcp' | 'udp'; SupportsPlayers: boolean;
  Live: unknown; IsOwner: boolean; Owner: FakeUser; SharedWith: FakeUser[] | null;
  environment: Record<string, unknown>;
}

export const ME: FakeUser = { uid: 'uid-me', name: 'Jacob Poling', email: 'jacob@example.com', picture: null };
export const SAM: FakeUser = { uid: 'uid-sam', name: 'Sam Rivera', email: 'sam@example.com', picture: null };
export const ALEX: FakeUser = { uid: 'uid-alex', name: 'Alex Chen', email: 'alex@example.com', picture: null };

const GAMES = [
  {
    game_type: 'minecraft', image: 'itzg/minecraft-server', internal_port: 25565, protocol: 'tcp', supports_players: true,
    common_fields: { MAX_PLAYERS: { type: 'integer', label: 'Max Players', required: false, default: 20, min: 1, max: 100 } },
    fields: {
      EULA: { type: 'boolean', label: 'Accept Minecraft EULA', required: true, default: true },
      MODE: { type: 'string', label: 'Game Mode', required: false, default: 'survival', enum: ['survival', 'creative', 'adventure', 'spectator'] },
      SEED: { type: 'string', label: 'World Seed', required: false, default: null },
    },
  },
  {
    game_type: 'palworld', image: 'thijsvanloef/palworld-server-docker:latest', internal_port: 8211, protocol: 'udp', supports_players: false,
    common_fields: { MAX_PLAYERS: { type: 'integer', label: 'Max Players', required: false, default: 32, min: 1, max: 100 } },
    fields: { DIFFICULTY: { type: 'string', label: 'Difficulty', required: false, default: 'Normal', enum: ['Casual', 'Normal', 'Hard'] } },
  },
];

const ACTIONS: Record<number, [string, string, string]> = {
  1: ['starting', 'running', 'started'],
  2: ['stopping', 'exited', 'stopped'],
  3: ['restarting', 'running', 'restarted'],
};

function live(players = 3) {
  const now = Date.now();
  return {
    cpu_pct: 14.2, mem_used_mb: 1843, mem_limit_mb: 8192,
    players: { online: players, max: 20, version: '1.21.4' },
    started_at: new Date(now - 3 * 3600 * 1000).toISOString(),
    updated: new Date(now).toISOString(),
    history: Array.from({ length: 12 }, (_, i) => ({
      time: new Date(now - (12 - i) * 3000).toISOString(), cpu_pct: 8 + (i % 4) * 3, mem_used_mb: 1800 + i * 4,
    })),
  };
}

export function server(name: string, overrides: Partial<FakeServer> = {}): FakeServer {
  const state = overrides.State ?? 'running';
  return {
    Created: new Date(Date.now() - 3 * 86400 * 1000).toISOString(), GameType: 'minecraft', ID: `cid-${name}`,
    Image: 'itzg/minecraft-server', Name: name, State: state, StatusMessage: null, Ports: { primary_port: 10000 },
    Protocol: 'tcp', SupportsPlayers: true, Live: state === 'running' ? live() : null, IsOwner: true, Owner: ME,
    SharedWith: [], environment: { MAX_PLAYERS: 20, EULA: true, MODE: 'survival', SEED: '' },
    ...overrides,
  };
}

export class FakePlayhub {
  servers: FakeServer[];
  users: FakeUser[] = [SAM, ALEX];
  events: Record<string, Array<{ id: number; action: string; detail: string | null; created: string; actor: FakeUser | null }>> = {};
  requests: Array<{ method: string; path: string; body: unknown; auth: string | null }> = [];
  /** How long simulated jobs take, in ms. */
  jobDelay = 600;
  private sockets = new Set<WebSocketRoute>();
  private nextEventId = 1;
  private nextPort = 10010;

  constructor(servers?: FakeServer[]) {
    this.servers = servers ?? [
      server('survival-world', { Ports: { primary_port: 10000 }, SharedWith: [SAM], Created: '2026-10-01T10:00:00Z' }),
      server('creative-build', { State: 'exited', Ports: { primary_port: 10001 }, Created: '2026-10-02T10:00:00Z' }),
      server('pals-with-sam', {
        GameType: 'palworld', Image: 'thijsvanloef/palworld-server-docker:latest', Protocol: 'udp', SupportsPlayers: false,
        Ports: { primary_port: 10002 }, IsOwner: false, Owner: SAM, SharedWith: null, Created: '2026-10-03T10:00:00Z',
        environment: { MAX_PLAYERS: 32, DIFFICULTY: 'Normal' },
      }),
    ];
    this.servers.forEach(s => this.record(s, ME, 'created'));
  }

  find(id: string) {
    return this.servers.find(s => s.ID === id || s.Name === id);
  }

  async install(page: Page) {
    await page.route('**/api/**', route => this.handle(route));
    await page.routeWebSocket(/\/api\/servers\/live$/, ws => this.liveSocket(ws));
    await page.routeWebSocket(/\/api\/servers\/[^/]+\/logs$/, ws => {
      ws.onMessage(() => {
        ws.send('[Server] Starting minecraft server version 1.21.4\r\n');
        ws.send('[Server] Done (3.2s)! For help, type "help"\r\n');
      });
    });
    await page.routeWebSocket(/\/api\/servers\/[^/]+\/terminal$/, ws => {
      let authed = false;
      ws.onMessage(message => {
        if (!authed) { authed = true; ws.send('/data # '); return; }
        ws.send(String(message));
      });
    });
  }

  /** Push the current list to every open live socket (the API does this every 2s when it changes). */
  broadcast() {
    for (const ws of this.sockets) ws.send(this.livePayload());
  }

  update(name: string, changes: Partial<FakeServer>) {
    Object.assign(this.find(name)!, changes);
    this.broadcast();
  }

  // -------------------------------------------------------------------------
  private livePayload() {
    // Settings aren't part of the server list.
    const servers = this.servers.map(s => Object.fromEntries(Object.entries(s).filter(([key]) => key !== 'environment')));
    return JSON.stringify({ type: 'servers', servers });
  }

  private liveSocket(ws: WebSocketRoute) {
    let authed = false;
    ws.onMessage(message => {
      if (!authed) {
        authed = String(message).startsWith('e2e-token-');
        if (!authed) { ws.close({ code: 4401, reason: 'Invalid or expired session' }); return; }
        this.sockets.add(ws);
      }
      ws.send(this.livePayload());
    });
    ws.onClose(() => this.sockets.delete(ws));
  }

  private record(target: FakeServer, actor: FakeUser | null, action: string, detail: string | null = null) {
    (this.events[target.Name] ??= []).unshift({ id: this.nextEventId++, action, detail, created: new Date().toISOString(), actor });
  }

  private settle(target: FakeServer, state: string, changes: Partial<FakeServer> = {}) {
    setTimeout(() => {
      if (!this.servers.includes(target)) return;
      Object.assign(target, { State: state, StatusMessage: null, Live: state === 'running' ? live(0) : null }, changes);
      this.broadcast();
    }, this.jobDelay);
  }

  private async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()!) : null;
    const auth = (await request.allHeaders())['authorization'] ?? null;
    this.requests.push({ method, path, body, auth });

    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (!auth?.startsWith('Bearer e2e-token-')) return json({ detail: 'Not signed in' }, 401);

    let match: RegExpMatchArray | null;
    if (path === '/auth/me') return json({ msg: { uid: ME.uid, name: ME.name, email: ME.email, picture: null } });
    if (path === '/sys/info') {
      return json({ msg: { sys_info: { cpu_usage: 23.4, total_ram_gb: 31.2, used_ram_gb: 12.8, used_ram_pct: 41.0, time: new Date().toISOString() } } });
    }
    if (path === '/sys/ip') return json({ msg: { ip: '203.0.113.7' } });
    if (path === '/users/') return json({ msg: this.users });
    if (path === '/servers/games') return json({ msg: GAMES });
    if ((match = path.match(/^\/job\/(.+)$/))) return json({ msg: { status: 3 } });
    if (path === '/servers/' && method === 'GET') return json({ msg: JSON.parse(this.livePayload()).servers });

    if (path === '/servers/create' && method === 'POST') {
      if (this.find(body.name)) return json({ detail: `The name '${body.name}' is already taken` }, 409);
      const game = GAMES.find(g => g.game_type === body.game_type)!;
      const created = server(body.name, {
        GameType: body.game_type, ID: body.name, State: 'starting', Live: null, Image: game.image,
        Protocol: game.protocol as 'tcp' | 'udp', SupportsPlayers: game.supports_players,
        Created: new Date().toISOString(), Ports: { primary_port: this.nextPort++ }, environment: body.environment,
      });
      this.servers.push(created);
      this.record(created, ME, 'created');
      this.broadcast();
      this.settle(created, 'running', { ID: `cid-${body.name}` });
      return json({ msg: { job_id: `job-${Date.now()}` } }, 201);
    }

    if ((match = path.match(/^\/servers\/([^/]+)$/))) {
      const target = this.find(decodeURIComponent(match[1]));
      if (!target) return json({ detail: 'Server not found' }, 404);
      if (method === 'GET') return json({ msg: target });
      if (method === 'DELETE') {
        if (!target.IsOwner) return json({ detail: "Only the server's owner can delete it" }, 403);
        this.servers = this.servers.filter(s => s !== target);
        this.broadcast();
        return json({ msg: { job_id: 'job-delete' } });
      }
      const action = ACTIONS[body?.Action];
      if (!action) return json({ detail: `Invalid Action: ${body?.Action}` }, 400);
      if (['starting', 'stopping', 'restarting', 'updating'].includes(target.State)) {
        return json({ detail: `${target.Name} is busy (${target.State}). Try again in a moment.` }, 409);
      }
      const [transitional, settled, event] = action;
      Object.assign(target, { State: transitional, StatusMessage: null });
      this.record(target, ME, event);
      this.broadcast();
      this.settle(target, settled);
      return json({ msg: { job_id: `job-${event}` } });
    }

    if ((match = path.match(/^\/servers\/([^/]+)\/(settings|activity|shares)$/))) {
      const target = this.find(decodeURIComponent(match[1]));
      if (!target) return json({ detail: 'Server not found' }, 404);
      const resource = match[2];
      if (resource === 'activity') return json({ msg: this.events[target.Name] ?? [] });
      if (resource === 'settings' && method === 'GET') return json({ msg: { game_type: target.GameType, environment: target.environment } });
      if (resource === 'settings') {
        const changed = Object.keys(body.environment).filter(k => body.environment[k] !== target.environment[k]);
        if (Number(body.environment.MAX_PLAYERS) > 100) {
          return json({ detail: { msg: 'Invalid server settings', fields: { MAX_PLAYERS: 'Must be at most 100' } } }, 422);
        }
        if (changed.length === 0) return json({ msg: { job_id: null, changed: [] } });
        target.environment = body.environment;
        target.State = 'updating';
        const labels = changed.map(k => ({ MAX_PLAYERS: 'Max Players', MODE: 'Game Mode', SEED: 'World Seed', EULA: 'Accept Minecraft EULA', DIFFICULTY: 'Difficulty' }[k] ?? k)).sort();
        this.record(target, ME, 'settings_updated', labels.join(', '));
        this.broadcast();
        this.settle(target, 'running');
        return json({ msg: { job_id: 'job-settings', changed: labels } });
      }
      if (!target.IsOwner) return json({ detail: "Only the server's owner can manage sharing" }, 403);
      if (method === 'GET') return json({ msg: target.SharedWith ?? [] });
      target.SharedWith = this.users.filter(u => body.user_ids.includes(u.uid));
      this.record(target, ME, 'shared', target.SharedWith.map(u => u.name).join(', ') || null);
      this.broadcast();
      return json({ msg: target.SharedWith });
    }

    return json({ detail: `Not found: ${method} ${path}` }, 404);
  }
}
