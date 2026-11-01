import api from "./Config/AxiosConfig";

/**
 * User directory APIs
 */
export const UsersApi = {
    /**
     * Lists everyone who has signed in to PlayHub, except the current user.
     */
    list: async function (): Promise<UserSummaryType[]> {
        const response = await api.request({
            url: `/users/`,
            method: "GET",
        });

        return response.data.msg;
    }
}

// --------TYPES------------

export interface UserSummaryType {
    uid: string;
    name: string | null;
    email: string | null;
    picture: string | null;
}

/** Best human-readable name for a user. */
export function displayUserName(user: UserSummaryType | null | undefined): string {
    return user?.name || user?.email || 'Unknown user';
}
