import api from "./Config/AxiosConfig";

/**
 * System information APIs
 */
export const SystemApi = {
    /**
     * Fetches the system information.
     * @param cancel cancels the request
     * @returns Promise<SystemInfoType>
     */
    getSystemInfo: async function (): Promise<SystemInfoType> {
        const response = await api.request({
            url: `/sys/info`,
            method: "GET"
        })

        return response.data.msg;
    },
    getSystemIp: async function (): Promise<SystemIpType> {
        const response = await api.request({
            url: `/sys/ip`,
            method: "GET"
        })

        return response.data.msg;
    },

    getPortOpen: async function (portNumber: number): Promise<boolean> {
        const response = await api.request<PortOpenResponseType>({
            url: `/sys/?open_port=${portNumber}`,
            method: "GET",
        });

        return response.data.msg.open_status;
    }
}

/**
 * TYPES
 */

/**
 * Interface for defining the response body of the /sys/info call
 */
export interface SystemInfoType {
    sys_info: {
        cpu_usage: number,
        total_ram_gb: number,
        used_ram_gb: number,
        used_ram_pct: number,
        time: string
    }
}

/**
 * Interface for defining the response body of the /sys/info call
 */
export interface SystemIpType {
    ip: string,
}

export interface PortOpenResponseType {
    msg: {
        open_status: boolean;
    }
}