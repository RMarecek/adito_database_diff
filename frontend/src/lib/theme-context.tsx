"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

type ThemeMode = "light" | "dark";

interface ThemeModeCtx {
  mode: ThemeMode;
  toggle: () => void;
}

const Ctx = createContext<ThemeModeCtx>({ mode: "dark", toggle: () => {} });

const STORAGE_KEY = "adit-theme-mode";

export const ThemeModeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<ThemeMode>("dark");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") setMode(stored);
  }, []);

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return <Ctx.Provider value={{ mode, toggle }}>{children}</Ctx.Provider>;
};

export const useThemeMode = () => useContext(Ctx);
