import axios from 'axios';

export const API_BASE_URL = '/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('myplex_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Only clear stored token if the authentication check itself (/auth/me) explicitly fails
    if (error.config?.url?.includes('/auth/me') && error.response?.status === 401) {
      localStorage.removeItem('myplex_token');
      localStorage.removeItem('myplex_user');
    }
    return Promise.reject(error);
  }
);
