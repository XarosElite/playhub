import { action, makeAutoObservable } from "mobx";
import { SystemApi, SystemInfoType } from "../Api/System";
import { createContext } from "react";
import { format } from "date-fns";

/**
 * Handles system information storage.
 */
class SystemInfoStore {
    public static SYSTEM_HISTORY_LENGTH = 60;
    public systemHistory: SystemInfoType[] = [];
    public systemIP: string = "erm";

    constructor() {
        makeAutoObservable(this, { fetchSystemInfoPoint: action });
        this.zeroizeHistory();
    }

    /**
     * Makes a call to poll system information.
     */
    public async fetchSystemInfoPoint() {
        const systemInfo = await SystemApi.getSystemInfo();
        this.pushNewInfo(systemInfo);
    }

    /**
     * Makes a call to poll system information.
     */
    public async fetchSystemIp() {
        const IpResponse = await SystemApi.getSystemIp();
        this.systemIP = IpResponse.ip;
    }

    // Computed value to get the latest item from systemHistory
    get latestSystemInfo() {
        return this.systemHistory[this.systemHistory.length - 1];
    }

    /**
     * Adds new information.
     * @param newInfo New information.
     */
    private pushNewInfo(newInfo: SystemInfoType) {
        if (this.systemHistory.length >= SystemInfoStore.SYSTEM_HISTORY_LENGTH) {
            this.systemHistory.shift();
        }

        // push new history, converting time to hh:mm:ss AM/PM
        this.systemHistory.push({
            sys_info: { ...newInfo.sys_info, time: format(newInfo.sys_info.time, 'h:mm:ss a') }
        });
    }

    /**
     * System information starts at zero for past SYSTEM_HISTORY_LENGTH
     */
    private zeroizeHistory() {
        for (let i = 0; i < SystemInfoStore.SYSTEM_HISTORY_LENGTH; i++) {
            this.systemHistory.push(
                {
                    sys_info: {
                        cpu_usage: 0,
                        time: format(new Date().toISOString(), 'h:mm:ss a'),
                        total_ram_gb: 0,
                        used_ram_gb: 0,
                        used_ram_pct: 0
                    }
                }
            )
        }
    }
}

export const systemInfoStore = new SystemInfoStore();
export const SystemInfoContext = createContext(systemInfoStore);
