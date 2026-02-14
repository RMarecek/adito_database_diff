import { createTheme } from "@mui/material/styles";
import type {} from "@mui/x-data-grid/themeAugmentation";

export const appTheme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#0f766e",
      light: "#42b7ad",
      dark: "#0b4d49",
      contrastText: "#f9faf7",
    },
    secondary: {
      main: "#c2410c",
      light: "#f07f43",
      dark: "#7b2507",
      contrastText: "#fff8f2",
    },
    background: {
      default: "#f5f5ef",
      paper: "#fbfaf3",
    },
    text: {
      primary: "#1c2520",
      secondary: "#405146",
    },
    success: {
      main: "#166534",
    },
    warning: {
      main: "#b45309",
    },
    error: {
      main: "#b91c1c",
    },
  },
  typography: {
    fontFamily: "'Space Grotesk', 'Avenir Next', 'Segoe UI', sans-serif",
    h1: { fontWeight: 700, letterSpacing: "-0.02em" },
    h2: { fontWeight: 700, letterSpacing: "-0.02em" },
    h3: { fontWeight: 700, letterSpacing: "-0.015em" },
    h4: { fontWeight: 650, letterSpacing: "-0.01em" },
    h5: { fontWeight: 650 },
    h6: { fontWeight: 650 },
    button: { fontWeight: 650, textTransform: "none" },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          border: "1px solid rgba(16, 58, 54, 0.10)",
          boxShadow: "0 12px 26px rgba(16, 58, 54, 0.08)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
        },
      },
    },
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
