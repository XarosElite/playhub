import { makeAutoObservable, runInAction } from "mobx";
import { createContext } from "react";

import { GameServerApi, ServerActionType, ServerState, TopLevelServerType } from "../Api/GameServer";
import { openAuthedSocket, WS_UNAUTHORIZED } from "../Api/Socket";

export type ConnectionState = 'connecting' | 'live' | 'polling';

// A server created this recently that comes up gets a celebration.
const CELEBRATE_WITHIN_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;
const MAX_BACKOFF_MS = 30000;

// State shown immediately when an action is requested, before the API confirms.
const OPTIMISTIC_STATE: Partial<Record<ServerActionType, ServerState>> = {
    [ServerActionType.START]: 'starting',
    [ServerActionType.STOP]: 'stopping',
    [ServerActionType.RESTART]: 'restarting',
};

type LiveListener = (server: TopLevelServerType) => void;

/**
 * The signed-in user's servers, kept up to date over the /servers/live
 * websocket (falling back to polling if it can't connect).
 */
class ServerStore {
    public servers: TopLevelServerType[] = [];
    public loaded: boolean = false;
    public connection: ConnectionState = 'connecting';

    private socket: WebSocket | null = null;
    private subscribers = 0;
    private reconnectTimer: number | undefined;
    private pollTimer: number | undefined;
    private backoffMs = 1000;
    private liveListeners = new Set<LiveListener>();

    constructor() {
        makeAutoObservable<ServerStore, 'socket' | 'reconnectTimer' | 'pollTimer' | 'backoffMs' | 'liveListeners' | 'subscribers'>(this, {
            socket: false, reconnectTimer: false, pollTimer: false, backoffMs: false, liveListeners: false, subscribers: false,
        }, { autoBind: true });
    }

    public byId(id: string | undefined): TopLevelServerType | undefined {
        return this.servers.find(s => s.ID === id || s.Name === id);
    }

    /**
     * Start receiving updates. Returns an unsubscribe function; the socket stays
     * open while at least one component is subscribed.
     */
    public subscribe(): () => void {
        this.subscribers++;
        if (this.subscribers === 1) this.connect();
        return () => {
            this.subscribers--;
            if (this.subscribers === 0) this.disconnect();
        };
    }

    /** Called when a newly created server becomes reachable for the first time. */
    public onServerLive(listener: LiveListener): () => void {
        this.liveListeners.add(listener);
        return () => this.liveListeners.delete(listener);
    }

    /** Ask for an immediate update (e.g. right after an action). */
    public refresh() {
        if (this.socket?.readyState === WebSocket.OPEN && this.connection === 'live') {
            this.socket.send('refresh');
        } else {
            this.fetchOnce();
        }
    }

    /**
     * Runs an action, showing its transitional state straight away.
     * Resolves true if the job finished successfully.
     */
    public async runAction(server: TopLevelServerType, action: ServerActionType): Promise<boolean> {
        const optimistic = OPTIMISTIC_STATE[action];
        if (optimistic) this.patch(server.ID, { State: optimistic, StatusMessage: null });
        try {
            const success = await GameServerApi.makeServerAction(server.ID, action, () => this.refresh());
            return success;
        } finally {
            this.refresh();
        }
    }

    public async deleteServer(server: TopLevelServerType): Promise<void> {
        await GameServerApi.deleteServer(server.ID);
        runInAction(() => {
            this.servers = this.servers.filter(s => s.ID !== server.ID);
        });
        this.refresh();
    }

    // ---------------------------------------------------------------------

    private patch(id: string, changes: Partial<TopLevelServerType>) {
        this.servers = this.servers.map(s => (s.ID === id ? { ...s, ...changes } : s));
    }

    private setServers(next: TopLevelServerType[]) {
        const previous = new Map(this.servers.map(s => [s.ID, s]));
        const previousByName = new Map(this.servers.map(s => [s.Name, s]));
        const now = Date.now();
        const cameUp: TopLevelServerType[] = [];

        for (const server of next) {
            // The ID changes from the name to the container ID once the container exists.
            const before = previous.get(server.ID) ?? previousByName.get(server.Name);
            const isNew = now - new Date(server.Created).getTime() < CELEBRATE_WITHIN_MS;
            if (this.loaded && before?.State === 'starting' && server.State === 'running' && isNew) {
                cameUp.push(server);
            }
        }

        this.servers = next;
        this.loaded = true;
        cameUp.forEach(server => this.liveListeners.forEach(listener => listener(server)));
    }

    private connect() {
        window.clearTimeout(this.reconnectTimer);
        this.connection = this.connection === 'polling' ? 'polling' : 'connecting';

        const ws = openAuthedSocket('/servers/live');
        this.socket = ws;

        ws.onmessage = event => {
            const message = JSON.parse(event.data);
            if (message.type === 'servers') {
                runInAction(() => {
                    this.connection = 'live';
                    this.setServers(message.servers);
                });
                this.backoffMs = 1000;
                this.stopPolling();
            }
        };

        ws.onclose = event => {
            if (this.socket !== ws) return;  // replaced or intentionally closed
            this.socket = null;
            if (this.subscribers === 0) return;
            // Expired token: reconnect straight away (a fresh token is fetched).
            const delay = event.code === WS_UNAUTHORIZED ? 0 : this.backoffMs;
            this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
            this.startPolling();
            this.reconnectTimer = window.setTimeout(this.connect, delay);
        };
    }

    private disconnect() {
        window.clearTimeout(this.reconnectTimer);
        this.stopPolling();
        const ws = this.socket;
        this.socket = null;
        ws?.close();
        this.connection = 'connecting';
    }

    private startPolling() {
        runInAction(() => {
            this.connection = 'polling';
        });
        if (this.pollTimer !== undefined) return;
        this.fetchOnce();
        this.pollTimer = window.setInterval(this.fetchOnce, POLL_INTERVAL_MS);
    }

    private stopPolling() {
        window.clearInterval(this.pollTimer);
        this.pollTimer = undefined;
    }

    private fetchOnce() {
        GameServerApi.getServers()
            .then(res => runInAction(() => this.setServers(res.msg)))
            .catch(() => undefined);
    }
}

export const serverStore = new ServerStore();
export const ServerStoreContext = createContext(serverStore);
