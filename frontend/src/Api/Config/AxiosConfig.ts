import axios, { AxiosError } from 'axios';

// initializing the axios instance with custom configs
const api = axios.create({
    withCredentials: false, // TODO change to yes, if we support auth
    // adding a custom language header   
    baseURL: '/api'
});

// defining a custom error handler for all APIs
const errorHandler = (error: AxiosError) => {
    const statusCode = error.response?.status

    // logging only errors that are not 401
    if (statusCode && statusCode !== 401) {
        console.error(error)
    }

    return Promise.reject(error);
}

// registering the custom error handler to the
// "api" axios instance
api.interceptors.response.use(undefined, (error: AxiosError) => {
    return errorHandler(error)
});


export default api;
