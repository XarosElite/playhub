import api from "./Config/AxiosConfig";

/**
 * Job APIs
 */
export const JobApi = {
    /**
     * Polls a job status.
     * @param jobId - The job ID.
     * @returns Promise<JobStatusResType>
     */
    getStatus: async function (jobId: string): Promise<JobStatusResType> {
        const response = await api.request({
            url: `/job/${jobId}`,
            method: "GET",
        });

        return response.data;
    }
}

// Poll create status every 3 seconds with job ID.
export async function waitForJobExit(jobId: string): Promise<boolean> {
    while (true) {
        await sleep(3000);
        const jobRes = await JobApi.getStatus(jobId);
        const status = jobRes.msg.status;

        if (status === JobStatus.FAILED) {
            return false;
        } else if (status === JobStatus.FINISHED) {
            return true;
        }
    }
}

/**
 * Async sleep operation. Non-blocking.
 * @param ms ms time to sleep
 * @returns Promise<void>
 */
function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

interface JobStatusResType {
    msg: {
        status: JobStatus
    }
}

// --------TYPES------------
export enum JobStatus {
    QUEUED = 1,
    STARTED,
    FINISHED,
    FAILED
}
