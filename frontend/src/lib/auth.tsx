"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Role } from "./types";
import { configureTokenGetter } from "./api";

const TOKEN_KEY = "schema_compare_token";

type AuthContextValue = {
  token: string;
  roles: Role[];
  subject: string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
  hasRole: (...roles: Role[]) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const parseJwtPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const extractRoles = (payload: Record<string, unknown> | null): Role[] => {
  if (!payload) return [];
  const raw = payload.roles;
  const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const known: Role[] = ["viewer", "editor", "executor", "approver", "admin"];
  return arr.filter((item): item is Role => known.includes(item as Role));
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setTokenState] = useState("");

  useEffect(() => {
    const existing = localStorage.getItem(TOKEN_KEY) ?? "";
    setTokenState(existing);
  }, []);

  useEffect(() => {
    configureTokenGetter(() => token || null);
  }, [token]);

  const payload = useMemo(() => parseJwtPayload(token), [token]);
  const roles = useMemo(() => extractRoles(payload), [payload]);
  const subject = payload && typeof payload.sub === "string" ? payload.sub : null;

  const value: AuthContextValue = {
    token,
    roles,
    subject,
    setToken: (nextToken) => {
      localStorage.setItem(TOKEN_KEY, nextToken);
      setTokenState(nextToken);
    },
    clearToken: () => {
      localStorage.removeItem(TOKEN_KEY);
      setTokenState("");
    },
    hasRole: (...required) => required.length === 0 || required.some((role) => roles.includes(role)),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
};
