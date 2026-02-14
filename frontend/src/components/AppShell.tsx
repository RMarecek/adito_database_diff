"use client";

import {
  AppBar,
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Toolbar,
  Typography,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";

const navItems = [
  { href: "/instances", label: "Instances" },
  { href: "/snapshots", label: "Snapshots" },
  { href: "/compare/new", label: "Compare New" },
  { href: "/changesets", label: "ChangeSets" },
  { href: "/audit", label: "Audit" },
];

export const AppShell = ({ children }: { children: ReactNode }) => {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { token, setToken, clearToken, roles, subject } = useAuth();
  const [draftToken, setDraftToken] = useState(token);

  const roleLabel = useMemo(() => (roles.length > 0 ? roles.join(", ") : "none"), [roles]);

  useEffect(() => {
    setDraftToken(token);
  }, [token]);

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background:
          "radial-gradient(80rem 30rem at -10% -20%, rgba(194,65,12,0.16), transparent), radial-gradient(75rem 35rem at 105% 0%, rgba(15,118,110,0.2), transparent), linear-gradient(180deg, #f5f5ef 0%, #ece9dd 100%)",
      }}
    >
      <AppBar position="sticky" elevation={0} sx={{ backdropFilter: "blur(10px)", background: "rgba(15, 20, 18, 0.82)" }}>
        <Toolbar sx={{ gap: 2, alignItems: "center", minHeight: { xs: 76, md: 68 } }}>
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setDrawerOpen(true)}
            sx={{ display: { md: "none" } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" sx={{ color: "#f6f4ea", minWidth: 170 }}>
            Schema Compare
          </Typography>

          <Stack direction="row" spacing={1} sx={{ display: { xs: "none", md: "flex" }, flexGrow: 1 }}>
            {navItems.map((item) => (
              <Button
                key={item.href}
                component={Link}
                href={item.href}
                variant={pathname?.startsWith(item.href) ? "contained" : "text"}
                color={pathname?.startsWith(item.href) ? "secondary" : "inherit"}
                sx={{ color: pathname?.startsWith(item.href) ? undefined : "#d2d9d5" }}
              >
                {item.label}
              </Button>
            ))}
          </Stack>

          <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: { md: 560 }, width: { xs: "100%", md: "auto" } }}>
            <TextField
              size="small"
              value={draftToken}
              onChange={(event) => setDraftToken(event.target.value)}
              placeholder="Paste JWT token"
              fullWidth
              sx={{
                "& .MuiOutlinedInput-root": {
                  backgroundColor: "rgba(255,255,255,0.95)",
                },
              }}
            />
            <Button
              variant="contained"
              color="primary"
              onClick={() => setToken(draftToken)}
              sx={{ whiteSpace: "nowrap" }}
            >
              Set Token
            </Button>
            <Button
              variant="outlined"
              color="inherit"
              onClick={() => {
                clearToken();
                setDraftToken("");
              }}
            >
              Clear
            </Button>
          </Stack>
        </Toolbar>
        <Toolbar sx={{ minHeight: "42px !important", gap: 1, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
          <Chip size="small" label={`User: ${subject ?? "anonymous"}`} />
          <Chip size="small" color="primary" label={`Roles: ${roleLabel}`} />
        </Toolbar>
      </AppBar>

      <Drawer anchor="left" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 260, p: 1 }}>
          <List>
            {navItems.map((item) => (
              <ListItemButton
                key={item.href}
                component={Link}
                href={item.href}
                selected={pathname?.startsWith(item.href)}
                onClick={() => setDrawerOpen(false)}
              >
                <ListItemText primary={item.label} />
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Drawer>

      <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 2, md: 3 } }}>{children}</Box>
    </Box>
  );
};
