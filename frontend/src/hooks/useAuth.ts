import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { User } from '../types';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      try {
        setUser(JSON.parse(userData));
        // Verify the cookie-based session is still valid
        api.validateToken().catch(() => {
          localStorage.removeItem('user');
          setUser(null);
        }).finally(() => {
          setLoading(false);
        });
      } catch (error) {
        localStorage.removeItem('user');
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username: string, password: string) => {
    const response = await api.login(username, password);
    // Store only non-sensitive display data; token is in HttpOnly cookie
    localStorage.setItem('user', JSON.stringify(response.user));
    setUser(response.user);
    return response;
  };

  const logout = async () => {
    await api.logout().catch(() => {});
    localStorage.removeItem('user');
    setUser(null);
  };

  return { user, loading, login, logout, isAuthenticated: !!user };
}
