"use client";

import {
  Alert,
  Box,
  Button,
  Chip,
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
import AddIcon from "@mui/icons-material/Add";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiClientError } from "@/lib/api";
import { RoleGate } from "@/components/RoleGate";

export default function ChangeSetsPage() {
  const [title, setTitle] = useState("Manual ChangeSet");
  const [errorText, setErrorText] = useState<string | null>(null);

  const changeSetsQuery = useQuery({
    queryKey: ["changesets"],
    queryFn: () => api.listChangeSets(),
  });

  const createMutation = useMutation({
    mutationFn: () => api.createChangeSet({ title, description: "Created from UI" }),
    onSuccess: () => {
      setErrorText(null);
      changeSetsQuery.refetch();
    },
    onError: (error) => {
      if (error instanceof ApiClientError) setErrorText(`${error.code}: ${error.message}`);
      else setErrorText("Failed to create changeset");
    },
  });

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">ChangeSets</Typography>
        <Typography color="text.secondary">
          Draft, validate, and execute grouped DDL steps.
        </Typography>
      </Box>

      {errorText ? <Alert severity="error">{errorText}</Alert> : null}

      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }}>
          <TextField
            size="small"
            label="New ChangeSet title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            sx={{ minWidth: 280 }}
          />
          <RoleGate roles={["editor", "admin"]}>
            <Button
              variant="contained"
              startIcon={createMutation.isPending ? <CircularProgress size={16} /> : <AddIcon />}
              disabled={createMutation.isPending || !title.trim()}
              onClick={() => createMutation.mutate()}
            >
              Create
            </Button>
          </RoleGate>
        </Stack>
      </Paper>

      <Paper sx={{ p: 1.5, overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Source Compare</TableCell>
              <TableCell>Updated</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {changeSetsQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <CircularProgress size={16} />
                    <span>Loading changesets...</span>
                  </Stack>
                </TableCell>
              </TableRow>
            ) : null}

            {!changeSetsQuery.isLoading && (changeSetsQuery.data?.items.length ?? 0) === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Alert severity="info">No changesets available.</Alert>
                </TableCell>
              </TableRow>
            ) : null}

            {(changeSetsQuery.data?.items ?? []).map((item) => (
              <TableRow key={item.changeSetId} hover>
                <TableCell className="mono">{item.changeSetId}</TableCell>
                <TableCell>{item.title}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    color={item.status === "VALIDATED" ? "success" : item.status === "EXECUTED" ? "warning" : "default"}
                    label={item.status}
                  />
                </TableCell>
                <TableCell className="mono">{item.sourceCompareRunId ?? "--"}</TableCell>
                <TableCell>{new Date(item.updatedAt).toLocaleString()}</TableCell>
                <TableCell align="right">
                  <Button size="small" component={Link} href={`/changesets/${encodeURIComponent(item.changeSetId)}`} variant="outlined">
                    Open
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}
