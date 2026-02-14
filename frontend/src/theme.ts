import { createTheme, type Theme } from "@mui/material/styles";
import type {} from "@mui/x-data-grid/themeAugmentation";

/* ── Semantic tokens used by Compare pages ── */
export interface CompareTokens {
  statusMatch: { color: string; bg: string; border: string };
  statusModified: { color: string; bg: string; border: string };
  statusMissing: { color: string; bg: string; border: string };
  diffSemantic: string;   // yellow — type/nullable/default/order
  diffNative: string;     // purple — native type text
  diffMuted: string;      // subtle info
  tableHeaderBg: string;
  tableHeaderColor: string;
  tableBorder: string;
  tableCellColor: string;
  tableHoverBg: string;
  tableExpandedBg: string;
  inputBg: string;
  surfaceOverlay: string;
  baselineAccent: string;
  targetAccent: string;
}

declare module "@mui/material/styles" {
  interface Theme {
    compare: CompareTokens;
  }
  interface ThemeOptions {
    compare?: CompareTokens;
  }
}

/* ── Shared values ── */
const typography = {
  fontFamily: "'Space Grotesk', 'Avenir Next', 'Segoe UI', sans-serif",
  h1: { fontWeight: 700, letterSpacing: "-0.02em" },
  h2: { fontWeight: 700, letterSpacing: "-0.02em" },
  h3: { fontWeight: 700, letterSpacing: "-0.015em" },
  h4: { fontWeight: 650, letterSpacing: "-0.01em" },
  h5: { fontWeight: 650 },
  h6: { fontWeight: 650 },
  button: { fontWeight: 650, textTransform: "none" as const },
};

const shape = { borderRadius: 12 };

/* ── Light theme ── */
const lightCompare: CompareTokens = {
  statusMatch:    { color: "#166534", bg: "rgba(22,101,52,0.08)",  border: "#86efac" },
  statusModified: { color: "#92400e", bg: "rgba(245,158,11,0.10)", border: "#fbbf24" },
  statusMissing:  { color: "#6b21a8", bg: "rgba(192,132,252,0.10)", border: "#c084fc" },
  diffSemantic: "#b45309",
  diffNative: "#7c3aed",
  diffMuted: "#64748b",
  tableHeaderBg: "#f1f0e8",
  tableHeaderColor: "#405146",
  tableBorder: "rgba(16,58,54,0.12)",
  tableCellColor: "#1c2520",
  tableHoverBg: "rgba(15,118,110,0.04)",
  tableExpandedBg: "rgba(15,118,110,0.06)",
  inputBg: "#ffffff",
  surfaceOverlay: "rgba(255,255,255,0.7)",
  baselineAccent: "#0f766e",
  targetAccent: "#6366f1",
};

const lightTheme = createTheme({
  palette: {
    mode: "light",
    primary:    { main: "#0f766e", light: "#42b7ad", dark: "#0b4d49", contrastText: "#f9faf7" },
    secondary:  { main: "#c2410c", light: "#f07f43", dark: "#7b2507", contrastText: "#fff8f2" },
    background: { default: "#f5f5ef", paper: "#fbfaf3" },
    text:       { primary: "#1c2520", secondary: "#405146" },
    success:    { main: "#166534" },
    warning:    { main: "#b45309" },
    error:      { main: "#b91c1c" },
  },
  typography,
  shape,
  compare: lightCompare,
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          border: "1px solid rgba(16, 58, 54, 0.10)",
          boxShadow: "0 12px 26px rgba(16, 58, 54, 0.08)",
        },
      },
    },
    MuiButton: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiDataGrid: {
      styleOverrides: {
        root: {
          border: "1px solid rgba(16, 58, 54, 0.16)",
          background: "linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(247,246,236,0.9) 100%)",
        },
      },
    },
  },
});

/* ── Dark theme ── */
const darkCompare: CompareTokens = {
  statusMatch:    { color: "#94a3b8", bg: "rgba(71,85,105,0.16)",   border: "#334155" },
  statusModified: { color: "#fbbf24", bg: "rgba(245,158,11,0.16)",  border: "#92400e" },
  statusMissing:  { color: "#d8b4fe", bg: "rgba(192,132,252,0.16)", border: "#6b21a8" },
  diffSemantic: "#fbbf24",
  diffNative: "#c084fc",
  diffMuted: "#64748b",
  tableHeaderBg: "#0a101b",
  tableHeaderColor: "#64748b",
  tableBorder: "#1f2937",
  tableCellColor: "#94a3b8",
  tableHoverBg: "#0b1321",
  tableExpandedBg: "#0b1321",
  inputBg: "#0b1220",
  surfaceOverlay: "rgba(7,13,24,0.7)",
  baselineAccent: "#60a5fa",
  targetAccent: "#a5b4fc",
};

const darkTheme = createTheme({
  palette: {
    mode: "dark",
    primary:    { main: "#2dd4bf", light: "#5eead4", dark: "#0f766e", contrastText: "#042f2e" },
    secondary:  { main: "#fb923c", light: "#fdba74", dark: "#c2410c", contrastText: "#431407" },
    background: { default: "#060a12", paper: "#070d18" },
    text:       { primary: "#e2e8f0", secondary: "#94a3b8" },
    success:    { main: "#4ade80" },
    warning:    { main: "#fbbf24" },
    error:      { main: "#f87171" },
  },
  typography,
  shape,
  compare: darkCompare,
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          border: "1px solid #1f2937",
          boxShadow: "0 12px 26px rgba(0,0,0,0.3)",
        },
      },
    },
    MuiButton: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiDataGrid: {
      styleOverrides: {
        root: {
          border: "1px solid #1f2937",
          background: "linear-gradient(180deg, #0b1220 0%, #070d18 100%)",
        },
      },
    },
  },
});

export function getTheme(mode: "light" | "dark"): Theme {
  return mode === "dark" ? darkTheme : lightTheme;
}

/** @deprecated Use getTheme() — kept for backwards compat during migration */
export const appTheme = lightTheme;
