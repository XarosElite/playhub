import api from "./Config/AxiosConfig";
import { waitForJobExit } from "./Job";

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
    createServer: async function (payload: CreateServerPayloadType): Promise<boolean> {
        // Create the server and retrieve the job ID.
        const response = await api.request({
            url: `/servers/create`,
            method: "POST",
            data: payload,
        });
        const data: CreateJobResType = response.data;
        const jobId: string = data.msg.job_id;

        const jobCompletionStatus = await waitForJobExit(jobId);
        return jobCompletionStatus;
    },
    deleteServer: async function (serverId: string): Promise<void> {
        await api.request({
            url: `/servers/${encodeURIComponent(serverId)}`,
            method: "DELETE"
        });
    },
    makeServerAction: async function (serverId: string, action: ServerActionType): Promise<boolean> {
        const payload: ServerActionRequestType = {
            Action: action
        }
        const response = await api.request({
            url: `/servers/${encodeURIComponent(serverId)}`,
            method: 'POST',
            data: payload
        });
        const data: CreateJobResType = response.data;
        const jobId: string = data.msg.job_id;

        const jobCompletionStatus = await waitForJobExit(jobId);
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

// Server entry type (display in tables/modals)
export interface TopLevelServerType {
    Created: string;
    GameType: string;
    ID: string;
    Image: string;
    Name: string;
    State: 'created' | 'exited' | 'running';
    Ports: {
        primary_port: number;
    }
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
