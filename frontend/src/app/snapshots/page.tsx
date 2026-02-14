"use client";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import AddIcon from "@mui/icons-material/Add";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSnapshotHistory } from "@/hooks/useSnapshotHistory";

export default function SnapshotsPage() {
  const { items, add, refresh } = useSnapshotHistory();
  const [instanceFilter, setInstanceFilter] = useState<string>("all");
  const [manualSnapshotId, setManualSnapshotId] = useState("");
  const [manualInstanceId, setManualInstanceId] = useState("");
  const [manualSchema, setManualSchema] = useState("CRM");

  const instancesQuery = useQuery({
    queryKey: ["instances"],
    queryFn: () => api.listInstances(),
  });

  const filtered = useMemo(
    () => items.filter((item) => instanceFilter === "all" || item.instanceId === instanceFilter),
    [items, instanceFilter],
  );

  const snapshotQueries = useQueries({
    queries: filtered.map((item) => ({
      queryKey: ["snapshot", item.snapshotId],
      queryFn: () => api.getSnapshot(item.snapshotId),
      staleTime: 2_000,
      retry: false,
    })),
  });

  const rows = filtered.map((item, idx) => ({
    history: item,
    status: snapshotQueries[idx]?.data,
    loading: snapshotQueries[idx]?.isLoading ?? false,
    error: snapshotQueries[idx]?.isError ?? false,
  }));

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">Snapshots</Typography>
        <Typography color="text.secondary">
          Snapshot status dashboard from local history and backend polling.
        </Typography>
      </Box>

      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }}>
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel id="instance-filter-label">Instance</InputLabel>
            <Select
              labelId="instance-filter-label"
              label="Instance"
              value={instanceFilter}
              onChange={(event) => setInstanceFilter(event.target.value)}
            >
              <MenuItem value="all">All instances</MenuItem>
              {(instancesQuery.data?.items ?? []).map((instance) => (
                <MenuItem key={instance.instanceId} value={instance.instanceId}>
                  {instance.name} ({instance.instanceId.slice(0, 8)})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button startIcon={<RefreshIcon />} variant="outlined" onClick={() => refresh()}>
            Reload History
          </Button>
          <Button
            startIcon={<RefreshIcon />}
            variant="outlined"
            onClick={() => snapshotQueries.forEach((query) => query.refetch())}
          >
            Refresh Statuses
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">Track Snapshot by ID</Typography>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} mt={1}>
          <TextField
            size="small"
            label="snapshotId"
            value={manualSnapshotId}
            onChange={(event) => setManualSnapshotId(event.target.value)}
            fullWidth
          />
          <TextField
            size="small"
            label="instanceId"
            value={manualInstanceId}
            onChange={(event) => setManualInstanceId(event.target.value)}
            fullWidth
          />
          <TextField
            size="small"
            label="schema"
            value={manualSchema}
            onChange={(event) => setManualSchema(event.target.value)}
            sx={{ minWidth: 150 }}
          />
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            disabled={!manualSnapshotId || !manualInstanceId}
            onClick={() => {
              add({
                snapshotId: manualSnapshotId.trim(),
                instanceId: manualInstanceId.trim(),
                schema: manualSchema.trim() || "CRM",
                createdAt: new Date().toISOString(),
              });
              setManualSnapshotId("");
            }}
          >
            Add
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 1.5, overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Snapshot ID</TableCell>
              <TableCell>Instance</TableCell>
              <TableCell>Schema</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Stats</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Alert severity="info">No snapshots in local history yet.</Alert>
                </TableCell>
              </TableRow>
            ) : null}

            {rows.map((row) => (
              <TableRow key={row.history.snapshotId} hover>
                <TableCell className="mono">{row.history.snapshotId}</TableCell>
                <TableCell className="mono">{row.history.instanceId}</TableCell>
                <TableCell>{row.history.schema}</TableCell>
                <TableCell>
                  {row.loading ? <CircularProgress size={15} /> : row.error ? "UNKNOWN" : row.status?.status ?? "UNKNOWN"}
                </TableCell>
                <TableCell>
                  {row.status?.createdAt ? new Date(row.status.createdAt).toLocaleString() : new Date(row.history.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  {row.status
                    ? `${row.status.stats.tables}T / ${row.status.stats.columns}C / ${row.status.stats.indexes}I`
                    : "--"}
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button
                      size="small"
                      variant="outlined"
                      component={Link}
                      href={`/compare/new?snapshotId=${encodeURIComponent(row.history.snapshotId)}&instanceId=${encodeURIComponent(row.history.instanceId)}`}
                    >
                      Use in Compare
                    </Button>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}
