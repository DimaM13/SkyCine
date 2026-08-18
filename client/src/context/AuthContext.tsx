import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (data: any) => Promise<void>;
  register: (data: any) => Promise<void>;
  logout: () => void;
  updateProfile: (data: any) => Promise<void>;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('myplex_token'));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchMe = async () => {
      if (!token) {
        setIsLoading(false);
        return;
      }
      try {
        const res = await apiClient.get('/auth/me');
        if (res.data?.user) {
          setUser(res.data.user);
          localStorage.setItem('myplex_user', JSON.stringify(res.data.user));
        }
      } catch (err: any) {
        // Only log out if the backend explicitly tells us the token is invalid/expired (HTTP 401)
        if (err?.response?.status === 401) {
          logout();
        } else {
          // If network error / timeout, restore user from local storage
          const cachedUser = localStorage.getItem('myplex_user');
          if (cachedUser) {
            try {
              setUser(JSON.parse(cachedUser));
            } catch (e) {}
          }
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchMe();
  }, [token]);

  const login = async (formData: any) => {
    const res = await apiClient.post('/auth/login', formData);
    const { token: receivedToken, user: receivedUser } = res.data;
    localStorage.setItem('myplex_token', receivedToken);
    localStorage.setItem('myplex_user', JSON.stringify(receivedUser));
    setToken(receivedToken);
    setUser(receivedUser);
  };

  const register = async (formData: any) => {
    const res = await apiClient.post('/auth/register', formData);
    const { token: receivedToken, user: receivedUser } = res.data;
    localStorage.setItem('myplex_token', receivedToken);
    localStorage.setItem('myplex_user', JSON.stringify(receivedUser));
    setToken(receivedToken);
    setUser(receivedUser);
  };

  const logout = () => {
    localStorage.removeItem('myplex_token');
    localStorage.removeItem('myplex_user');
    setToken(null);
    setUser(null);
  };

  const updateProfile = async (formData: any) => {
    const res = await apiClient.put('/auth/profile', formData);
    setUser(res.data.user);
  };

  const isAdmin = user?.role === 'ADMIN';

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout, updateProfile, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
