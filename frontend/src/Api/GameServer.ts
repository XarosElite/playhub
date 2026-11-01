import api from "./Config/AxiosConfig";
import { waitForJobExit } from "./Job";
import { UserSummaryType } from "./Users";

/**
 * System information APIs
 */
export const GameServerApi = {
    /**
     * Fetches game servers
     * @returns Promise<GetAllServerResType>
     */
    getServers: async function (): Promise<GetAllServerResType> {
        const response = await api.request({
            url: `/servers/`,
            method: "GET",
        });

        return response.data;
    },
    /**
     * Fetches the list of supported game types with their configuration
     * (environment schema split into common and game-specific fields).
     * @returns Promise<GameCatalogType[]>
     */
    getGames: async function (): Promise<GameCatalogType[]> {
        const response = await api.request({
            url: `/servers/games`,
            method: "GET",
        });

        return response.data.msg;
    },
    /**
     * Creates and polls for creation status of the server.
     * @param payload - The server config parameters (game_type, name, environment dict).
     * @returns Promise<boolean> - Whether create was successful
     */
    createServer: async function (payload: CreateServerPayloadType, onQueued?: () => void): Promise<boolean> {
        // Create the server and retrieve the job ID.
        const response = await api.request({
            url: `/servers/create`,
            method: "POST",
            data: payload,
        });
        const data: CreateJobResType = response.data;
        onQueued?.();

        const jobCompletionStatus = await waitForJobExit(data.msg.job_id);
        return jobCompletionStatus;
    },
    deleteServer: async function (serverId: string): Promise<void> {
        await api.request({
            url: `/servers/${encodeURIComponent(serverId)}`,
            method: "DELETE"
        });
    },
    /**
     * Lists the users a server is shared with. Owner only.
     */
    getShares: async function (serverId: string): Promise<UserSummaryType[]> {
        const response = await api.request({
            url: `/servers/${encodeURIComponent(serverId)}/shares`,
            method: "GET",
        });

        return response.data.msg;
    },
    /**
     * Replaces the set of users a server is shared with. Owner only.
     * @returns the users it is now shared with
     */
    setShares: async function (serverId: string, userIds: string[]): Promise<UserSummaryType[]> {
        const response = await api.request({
            url: `/servers/${encodeURIComponent(serverId)}/shares`,
            method: "PUT",
            data: { user_ids: userIds },
        });

        return response.data.msg;
    },
    /**
     * The server's current settings keyed by field name.
     */
    getSettings: async function (serverId: string): Promise<ServerSettingsType> {
        const response = await api.request({
            url: `/servers/${encodeURIComponent(serverId)}/settings`,
            method: "GET",
        });

        return response.data.msg;
    },
    /**
     * Saves new settings and recreates the container (world data is kept).
     * Resolves with the labels of the settings that changed – empty if nothing did.
     */
    updateSettings: async function (serverId: string, environment: Record<string, EnvironmentValue>): Promise<UpdateSettingsResType> {
        const response = await api.request({
            url: `/servers/${encodeURIComponent(serverId)}/settings`,
            method: "PUT",
            data: { environment },
        });

        return response.data.msg;
    },
    /**
     * Recent activity for a server, newest first.
     */
    getActivity: async function (serverId: string): Promise<ServerEventType[]> {
        const response = await api.request({
            url: `/servers/${encodeURIComponent(serverId)}/activity`,
            method: "GET",
        });

        return response.data.msg;
    },
    /**
     * Runs an action and waits for its job to finish.
     * @param onQueued called once the API has accepted the action (the server is now in a transitional state)
     */
    makeServerAction: async function (serverId: string, action: ServerActionType, onQueued?: () => void): Promise<boolean> {
        const payload: ServerActionRequestType = {
            Action: action
        }
        const response = await api.request({
            url: `/servers/${encodeURIComponent(serverId)}`,
            method: 'POST',
            data: payload
        });
        const data: CreateJobResType = response.data;
        onQueued?.();

        const jobCompletionStatus = await waitForJobExit(data.msg.job_id);
        return jobCompletionStatus;
    }
}

// --------TYPES------------

export enum ServerCreateStatus {
    QUEUED = 1,
    STARTED,
    FINISHED,
    FAILED
}

export type EnvironmentFieldType = 'string' | 'password' | 'boolean' | 'integer' | 'number';
export type EnvironmentValue = string | number | boolean;

// A single configurable setting, as defined in api/games.yaml.
export interface EnvironmentFieldSchema {
    type: EnvironmentFieldType;
    label: string;
    required: boolean;
    default: EnvironmentValue | null;
    description?: string;
    placeholder?: string;
    enum?: (string | number)[];
    min?: number;
    max?: number;
}

// Game catalog types returned by GET /servers/games
export interface GameCatalogType {
    game_type: string;
    image: string;
    internal_port: number;
    protocol: 'tcp' | 'udp';
    // Whether live player counts are available for this game.
    supports_players: boolean;
    common_fields: Record<string, EnvironmentFieldSchema>;
    fields: Record<string, EnvironmentFieldSchema>;
}

// Create server payload – the backend validates `environment` against the game's schema.
// Empty values ('') fall back to the field's default.
export interface CreateServerPayloadType {
    game_type: string;
    name: string;
    environment: Record<string, EnvironmentValue>;
}

// 422 body returned by POST /servers/create when settings fail validation.
export interface CreateServerValidationError {
    msg: string;
    fields: Record<string, string>;
}

// Response types
interface CreateJobResType {
    msg: {
        job_id: string;
    }
}

interface GetAllServerResType {
    msg: TopLevelServerType[];
}

/**
 * Server lifecycle. Transitional states are set while a job runs; the worker
 * settles the server in running / exited / failed.
 */
export type ServerState = 'starting' | 'stopping' | 'restarting' | 'updating' | 'running' | 'exited' | 'failed' | 'created';

export const TRANSITIONAL_STATES: ReadonlySet<ServerState> = new Set(['starting', 'stopping', 'restarting', 'updating']);

export interface LiveSampleType {
    time: string;
    cpu_pct: number | null;
    mem_used_mb: number | null;
}

// Live stats for a running server, collected by the API every few seconds.
export interface ServerLiveType {
    cpu_pct: number | null;
    mem_used_mb: number | null;
    mem_limit_mb: number | null;
    players: { online: number; max: number; version: string | null } | null;
    started_at: string | null;
    updated: string;
    history?: LiveSampleType[];
}

// Server entry type (display in tables/modals)
export interface TopLevelServerType {
    Created: string;
    GameType: string;
    ID: string;
    Image: string;
    Name: string;
    State: ServerState;
    // Why the server is in its current state, e.g. the error when it failed.
    StatusMessage: string | null;
    Ports: {
        primary_port: number;
    };
    Protocol: 'tcp' | 'udp';
    SupportsPlayers: boolean;
    // Present only while the server is running.
    Live: ServerLiveType | null;
    // Whether the signed-in user created this server (otherwise it was shared with them).
    IsOwner: boolean;
    Owner: UserSummaryType;
    // Users the server is shared with; only provided to the owner.
    SharedWith: UserSummaryType[] | null;
}

export interface BaseCreateServerType {
    game_type: string;
    name: string
}

export enum ServerActionType {
    START = 1,
    STOP,
    RESTART,
    DELETE = 100
}

interface ServerActionRequestType {
    Action: ServerActionType
}

export interface ServerSettingsType {
    game_type: string;
    environment: Record<string, EnvironmentValue>;
}

interface UpdateSettingsResType {
    job_id: string | null;
    changed: string[];
}

export type ServerEventAction =
    'created' | 'started' | 'stopped' | 'restarted' | 'settings_updated' |
    'shared' | 'unshared' | 'deleted' | 'failed' | 'crashed' | 'missing';

export interface ServerEventType {
    id: number;
    action: ServerEventAction;
    detail: string | null;
    created: string;
    // null for system events, e.g. a crash
    actor: UserSummaryType | null;
}
