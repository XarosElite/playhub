import { ServerState, TopLevelServerType } from "../../Api/GameServer";

/** Address players connect to, e.g. 203.0.113.7:10000. */
export function serverAddress(server: TopLevelServerType, hostIp: string): string {
    return `${hostIp}:${server.Ports.primary_port}`;
}

/** Route for a server's page. Names are unique and stable (IDs change once the container exists). */
export function serverPath(server: Pick<TopLevelServerType, 'Name'>): string {
    return `/server/${encodeURIComponent(server.Name)}`;
}

export type StatusFilter = 'all' | 'running' | 'stopped' | 'busy' | 'failed';
export type ScopeFilter = 'all' | 'mine' | 'shared';

export interface ServerFilters {
    search: string;
    scope: ScopeFilter;
    games: string[];
    status: StatusFilter;
}

export const DEFAULT_FILTERS: ServerFilters = { search: '', scope: 'all', games: [], status: 'all' };

const STATUS_GROUP: Record<ServerState, Exclude<StatusFilter, 'all'>> = {
    running: 'running',
    exited: 'stopped',
    created: 'stopped',
    starting: 'busy',
    stopping: 'busy',
    restarting: 'busy',
    updating: 'busy',
    failed: 'failed',
};

export function isFiltered(filters: ServerFilters): boolean {
    return filters.search.trim() !== '' || filters.scope !== 'all' || filters.games.length > 0 || filters.status !== 'all';
}

export function filterServers(servers: TopLevelServerType[], filters: ServerFilters): TopLevelServerType[] {
    const query = filters.search.trim().toLowerCase();
    return servers.filter(server => {
        if (filters.scope === 'mine' && !server.IsOwner) return false;
        if (filters.scope === 'shared' && server.IsOwner) return false;
        if (filters.games.length && !filters.games.includes(server.GameType)) return false;
        if (filters.status !== 'all' && STATUS_GROUP[server.State] !== filters.status) return false;
        if (query) {
            const haystack = [server.Name, server.GameType, server.Owner.name, server.Owner.email, String(server.Ports.primary_port)];
            if (!haystack.some(text => text?.toLowerCase().includes(query))) return false;
        }
        return true;
    });
}

const STATE_ORDER: Record<ServerState, number> = {
    running: 0, starting: 1, restarting: 1, updating: 1, stopping: 2, failed: 3, exited: 4, created: 4,
};

export type SortKey = 'Name' | 'GameType' | 'State' | 'Players' | 'Resources' | 'Created';

const SORT_VALUE: Record<SortKey, (s: TopLevelServerType) => string | number> = {
    Name: s => s.Name.toLowerCase(),
    GameType: s => s.GameType,
    State: s => STATE_ORDER[s.State] ?? 9,
    Players: s => s.Live?.players?.online ?? -1,
    Resources: s => s.Live?.cpu_pct ?? -1,
    Created: s => new Date(s.Created).getTime(),
};

export function sortServers(servers: TopLevelServerType[], key: SortKey, direction: 'asc' | 'desc'): TopLevelServerType[] {
    const value = SORT_VALUE[key] ?? SORT_VALUE.Created;
    const sign = direction === 'asc' ? 1 : -1;
    return [...servers].sort((a, b) => {
        const av = value(a), bv = value(b);
        if (av < bv) return -sign;
        if (av > bv) return sign;
        return a.Name.localeCompare(b.Name);
    });
}

export function formatMemory(mb: number | null | undefined): string {
    if (mb === null || mb === undefined) return '—';
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
