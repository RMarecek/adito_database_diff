"use client";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiClientError } from "@/lib/api";
import { RoleGate } from "@/components/RoleGate";

export default function AuditPage() {
  const [tableKey, setTableKey] = useState("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);

  const searchMutation = useMutation({
    mutationFn: () =>
      api.searchAudit({
        tableKey: tableKey || undefined,
        user: userId || undefined,
        from: from || undefined,
        to: to || undefined,
        offset: 0,
        limit: 300,
      }),
    onError: (error) => {
      if (error instanceof ApiClientError) setErrorText(`${error.code}: ${error.message}`);
      else setErrorText("Audit search failed");
    },
    onSuccess: () => setErrorText(null),
  });

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">Audit</Typography>
        <Typography color="text.secondary">Search by table key, user, and time range.</Typography>
      </Box>

      {errorText ? <Alert severity="error">{errorText}</Alert> : null}

      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.2}>
          <TextField size="small" label="tableKey" value={tableKey} onChange={(e) => setTableKey(e.target.value)} />
          <TextField size="small" label="user" value={userId} onChange={(e) => setUserId(e.target.value)} />
          <TextField
            size="small"
            type="datetime-local"
            label="from"
            value={from}
            InputLabelProps={{ shrink: true }}
            onChange={(e) => setFrom(e.target.value)}
          />
          <TextField
            size="small"
            type="datetime-local"
            label="to"
            value={to}
            InputLabelProps={{ shrink: true }}
            onChange={(e) => setTo(e.target.value)}
          />
          <RoleGate roles={["admin", "approver"]}>
            <Button
              variant="contained"
              startIcon={searchMutation.isPending ? <CircularProgress size={16} /> : <SearchIcon />}
              onClick={() => searchMutation.mutate()}
            >
              Search
            </Button>
          </RoleGate>
        </Stack>
      </Paper>

      <Paper sx={{ p: 1.5, overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Time</TableCell>
              <TableCell>User</TableCell>
              <TableCell>Action</TableCell>
              <TableCell>Table Key</TableCell>
              <TableCell>Correlation</TableCell>
              <TableCell>Payload</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(searchMutation.data?.items ?? []).map((item) => (
              <TableRow key={item.id}>
                <TableCell>{new Date(item.time).toLocaleString()}</TableCell>
                <TableCell>{item.userId}</TableCell>
                <TableCell>{item.action}</TableCell>
                <TableCell className="mono">{item.tableKey ?? "--"}</TableCell>
                <TableCell className="mono">{item.correlationId}</TableCell>
                <TableCell className="mono">{JSON.stringify(item.payload)}</TableCell>
              </TableRow>
            ))}
            {!searchMutation.isPending && (searchMutation.data?.items.length ?? 0) === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Alert severity="info">No rows.</Alert>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}
