"use client";

import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type StreamEvent = {
  type: string;
  time: string;
  payload: Record<string, unknown>;
};

const ExecutionPageContent = () => {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const executionId = params.id;
  const searchJobId = searchParams.get("jobId") ?? "";
  const { token } = useAuth();

  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const executionQuery = useQuery({
    queryKey: ["execution", executionId],
    queryFn: () => api.getExecution(executionId),
    refetchInterval: 3000,
  });

  const jobId = executionQuery.data?.jobId ?? searchJobId;

  useEffect(() => {
    if (!jobId || !token) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStreamError(null);

    const url = api.getJobEventsUrl(jobId);
    void fetchEventSource(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
      },
      onmessage(message) {
        if (!message.data) return;
        try {
          const parsed = JSON.parse(message.data) as StreamEvent;
          setStreamEvents((prev) => {
            const next = [...prev, parsed];
            return next.slice(-1000);
          });
        } catch {
          // ignore non-json payloads
        }
      },
      onerror(error) {
        setStreamError(error instanceof Error ? error.message : "SSE stream failed");
        throw error;
      },
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setStreamError(error instanceof Error ? error.message : "SSE stream disconnected");
    });

    return () => {
      controller.abort();
    };
  }, [jobId, token]);

  const mergedLogs = useMemo(() => {
    const persisted = executionQuery.data?.logs ?? [];
    const streamed = streamEvents
      .filter((event) => event.type === "job.log")
      .map((event) => ({
        time: String(event.payload.time ?? event.time ?? ""),
        level: String(event.payload.level ?? "INFO"),
        message: String(event.payload.message ?? ""),
      }));
    const all = [...persisted, ...streamed];
    all.sort((a, b) => a.time.localeCompare(b.time));
    return all;
  }, [executionQuery.data?.logs, streamEvents]);

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">Execution {executionId.slice(0, 8)}</Typography>
        <Typography color="text.secondary">Polling execution status + SSE live events.</Typography>
      </Box>

      {executionQuery.isLoading ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={18} />
          <span>Loading execution...</span>
        </Stack>
      ) : null}

      {executionQuery.data ? (
        <Paper sx={{ p: 2 }}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }}>
            <Chip color="primary" label={`status=${executionQuery.data.status}`} />
            <Chip label={`instance=${executionQuery.data.instanceId.slice(0, 8)}`} />
            <Chip label={`job=${executionQuery.data.jobId.slice(0, 8)}`} />
            <Chip label={`by=${executionQuery.data.startedBy}`} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            submitted: {new Date(executionQuery.data.submittedAt).toLocaleString()} | started:{" "}
            {executionQuery.data.startedAt ? new Date(executionQuery.data.startedAt).toLocaleString() : "--"} | ended:{" "}
            {executionQuery.data.endedAt ? new Date(executionQuery.data.endedAt).toLocaleString() : "--"}
          </Typography>
        </Paper>
      ) : null}

      {streamError ? <Alert severity="warning">SSE: {streamError}</Alert> : null}

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">Live Job Events</Typography>
        <Table size="small" sx={{ mt: 1.2 }}>
          <TableHead>
            <TableRow>
              <TableCell>Time</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Payload</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {streamEvents.slice(-50).map((event, idx) => (
              <TableRow key={`${event.time}-${idx}`}>
                <TableCell className="mono">{event.time}</TableCell>
                <TableCell>{event.type}</TableCell>
                <TableCell className="mono">{JSON.stringify(event.payload)}</TableCell>
              </TableRow>
            ))}
            {streamEvents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3}>
                  <Alert severity="info">No SSE events yet.</Alert>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">Execution Logs</Typography>
        <Table size="small" sx={{ mt: 1.2 }}>
          <TableHead>
            <TableRow>
              <TableCell>Time</TableCell>
              <TableCell>Level</TableCell>
              <TableCell>Message</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {mergedLogs.slice(-250).map((log, idx) => (
              <TableRow key={`${log.time}-${idx}`}>
                <TableCell className="mono">{log.time}</TableCell>
                <TableCell>{log.level}</TableCell>
                <TableCell>{log.message}</TableCell>
              </TableRow>
            ))}
            {mergedLogs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3}>
                  <Alert severity="info">No logs yet.</Alert>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
};

export default function ExecutionPage() {
  return (
    <Suspense
      fallback={
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h4">Execution</Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={18} />
            <span>Loading execution...</span>
          </Stack>
        </Stack>
      }
    >
      <ExecutionPageContent />
    </Suspense>
  );
}
