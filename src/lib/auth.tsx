"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, clearCache, getToken, setToken } from "./api";

export interface SessionUser {
  id: string;
  username: string;
  role: "admin" | "user";
  created_at: string;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>(null as unknown as AuthContextValue);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api<{ user: SessionUser }>("/api/auth/me");
      setUser(data.user);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api<{ token: string; user: SessionUser }>("/api/auth", {
      method: "POST",
      body: { action: "login", username, password },
    });
    clearCache();
    setToken(data.token);
    setUser(data.user);
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const data = await api<{ token: string; user: SessionUser }>("/api/auth", {
      method: "POST",
      body: { action: "register", username, password },
    });
    clearCache();
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    clearCache();
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
