import api from "./Config/AxiosConfig";
import { waitForJobExit } from "./Job";

/**
 * System information APIs
 */
export const GameServerApi = {
    /**
     * Fetches game servers
     * @param cancel cancels the request
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
     * Creates and polls for creation status of the server.
     * @param payload - The server config parameters.
     * @returns Promise<boolean> - Whether create was successful
     */
    createServer: async function (payload: CreateServerType): Promise<boolean> {
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

export function gameTypeEnumToString(type: GameType) {
    switch (type) {
        case GameType.MINECRAFT:
            return 'Minecraft';
        case GameType.PALWORLD:
            return 'Palworld';
        default:
            return 'Unknown';
    }
}

// --------TYPES------------
export enum ServerCreateStatus {
    QUEUED = 1,
    STARTED,
    FINISHED,
    FAILED
}

export enum GameType {
    MINECRAFT = 1,
    FOREST = 2,
    PALWORLD = 3,
    OTHER
}

export enum ServerActionType {
    START = 1,
    STOP,
    RESTART,
    DELETE = 100 // This is a separate action, but it's easier to track with this enum
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


// Request body types
// Get all servers entry type
export interface TopLevelServerType {
    Created: string;
    GameType: GameType;
    ID: string;
    Image: string;
    Name: string;
    State: 'created' | 'exited' | 'running';
    Ports: {
        primary_port: number;
    }
}

// TODO fill out for detailed server
export interface TopLevelServerType {
    todo: string;
}

// Create server types
interface BaseCreateServerType {
    game_type: GameType,
    name: string
}


interface ServerActionRequestType {
    Action: ServerActionType
}

export interface CreateMinecraftType extends BaseCreateServerType {
    environment: {
        EULA: boolean;
        MODE: 'survival' | 'creative' | 'adventure' | 'spectator';
        SEED: string;
        PVP: boolean;
        HARDCORE: boolean;
        ENABLE_COMMAND_BLOCK: boolean; 
        MAX_PLAYERS: number;
    },
    ports: {
        primary_port: number;
    }
}

export interface CreatePalworldType extends BaseCreateServerType {
    environment: {
        SERVER_NAME: string;
        SERVER_DESCRIPTION: string;
        SERVER_PASSWORD: string;
        ADMIN_PASSWORD: string;
        DIFFICULTY: 'Casual' | 'Normal' | 'Hard';
        EXP_RATE: number;
        PAL_SPAWN: number;
        COMMUNITY: boolean;
        PLAYERS: number;
    },
    ports: {
        primary_port: number;
    }
}

export type CreateServerType = CreateMinecraftType | CreatePalworldType;