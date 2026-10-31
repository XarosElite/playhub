import axios, { AxiosError } from 'axios';
import { notifications } from '@mantine/notifications';

import { auth, getIdToken } from '../../Auth/firebase';

// initializing the axios instance with custom configs
const api = axios.create({
    baseURL: '/api'
});

// Attach the Firebase ID token to every request.
api.interceptors.request.use(async config => {
    const token = await getIdToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// defining a custom error handler for all APIs
const errorHandler = (error: AxiosError<{ detail?: unknown }>) => {
    const statusCode = error.response?.status

    if (statusCode === 401 || statusCode === 403) {
        // The session is invalid or the account isn't allowed: sign out, which
        // sends the user back to the login page.
        // /auth/me failures are reported by the login page itself.
        if (statusCode === 403 && auth?.currentUser && error.config?.url !== '/auth/me') {
            const detail = error.response?.data?.detail;
            notifications.show({
                id: 'auth-forbidden',
                title: 'Access denied',
                message: typeof detail === 'string' ? detail : 'This account is not allowed to access PlayHub.',
                color: 'red',
            });
        }
        auth?.signOut();
    } else {
        console.error(error)
    }

    return Promise.reject(error);
}

// registering the custom error handler to the
// "api" axios instance
api.interceptors.response.use(undefined, errorHandler);


export default api;
