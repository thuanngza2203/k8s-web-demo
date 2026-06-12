'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children, apiBaseUrl }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('cloud-web-token');
    const storedUser = localStorage.getItem('cloud-web-user');
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      } catch {
        localStorage.removeItem('cloud-web-token');
        localStorage.removeItem('cloud-web-user');
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Login failed');

    setToken(data.data.token);
    setUser(data.data.user);
    localStorage.setItem('cloud-web-token', data.data.token);
    localStorage.setItem('cloud-web-user', JSON.stringify(data.data.user));
    return data.data;
  }, [apiBaseUrl]);

  const register = useCallback(async (username, email, password, fullName) => {
    const res = await fetch(`${apiBaseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, full_name: fullName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Registration failed');

    setToken(data.data.token);
    setUser(data.data.user);
    localStorage.setItem('cloud-web-token', data.data.token);
    localStorage.setItem('cloud-web-user', JSON.stringify(data.data.user));
    return data.data;
  }, [apiBaseUrl]);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('cloud-web-token');
    localStorage.removeItem('cloud-web-user');
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
