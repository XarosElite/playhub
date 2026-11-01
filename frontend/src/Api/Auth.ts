import api from "./Config/AxiosConfig";

/**
 * Auth APIs
 */
export const AuthApi = {
    /**
     * Returns the signed-in user as the backend sees them. Fails with 403 if the
     * account isn't allowed to use this PlayHub instance.
     */
    getMe: async function (): Promise<AuthUserType> {
        const response = await api.request({
            url: `/auth/me`,
            method: "GET",
        });

        return response.data.msg;
    }
}

// --------TYPES------------

export interface AuthUserType {
    uid: string;
    email: string | null;
    name: string | null;
    picture: string | null;
}
