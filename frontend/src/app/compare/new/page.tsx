"use client";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Radio,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api";
import { waitForSnapshotReady } from "@/lib/snapshot-jobs";
import { useSnapshotHistory } from "@/hooks/useSnapshotHistory";

type ProgressRow = {
  instanceId: string;
  status: "IDLE" | "SNAPSHOT_QUEUED" | "SNAPSHOT_RUNNING" | "SNAPSHOT_READY" | "FAILED";
  snapshotId: string | null;
  message: string;
};

const CompareNewPageContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const baselineQueryInstance = searchParams.get("baselineInstanceId");
  const presetSnapshotId = searchParams.get("snapshotId");
  const presetSnapshotInstance = searchParams.get("instanceId");
  const { add: addHistory } = useSnapshotHistory();

  const [selected, setSelected] = useState<string[]>([]);
  const [baselineInstanceId, setBaselineInstanceId] = useState<string>("");
  const [schemaByInstance, setSchemaByInstance] = useState<Record<string, string>>({});
  const [existingSnapshotByInstance, setExistingSnapshotByInstance] = useState<Record<string, string>>(
    presetSnapshotId && presetSnapshotInstance ? { [presetSnapshotInstance]: presetSnapshotId } : {},
  );
  const [onlyDifferences, setOnlyDifferences] = useState(true);
  const [progress, setProgress] = useState<Record<string, ProgressRow>>({});
  const [errorText, setErrorText] = useState<string | null>(null);
  const [options, setOptions] = useState({
    matchIndexByDefinition: true,
    ignoreIndexName: true,
    ignoreColumnOrder: false,
  });

  const instancesQuery = useQuery({
    queryKey: ["instances"],
    queryFn: () => api.listInstances(),
  });

  const instanceRows = instancesQuery.data?.items ?? [];

  const effectiveBaseline = useMemo(() => {
    if (baselineInstanceId) return baselineInstanceId;
    if (baselineQueryInstance) return baselineQueryInstance;
    return selected[0] ?? "";
  }, [baselineInstanceId, baselineQueryInstance, selected]);

  const toggleSelect = (instanceId: string, checked: boolean): void => {
    setSelected((prev) => {
      const next = checked ? [...new Set([...prev, instanceId])] : prev.filter((id) => id !== instanceId);
      if (!next.includes(baselineInstanceId)) {
        setBaselineInstanceId(next[0] ?? "");
      }
      return next;
    });
    if (!baselineInstanceId) setBaselineInstanceId(instanceId);
  };

  const createRunMutation = useMutation({
    mutationFn: async () => {
      setErrorText(null);
      if (selected.length < 2) throw new Error("Pick at least 2 instances");
      if (!effectiveBaseline) throw new Error("Pick a baseline instance");
      if (!selected.includes(effectiveBaseline)) throw new Error("Baseline must be one of selected instances");

      const snapshotIdsByInstance = new Map<string, string>();
      const progressMap: Record<string, ProgressRow> = {};
      for (const instanceId of selected) {
        progressMap[instanceId] = {
          instanceId,
          status: "IDLE",
          snapshotId: null,
          message: "Waiting",
        };
      }
      setProgress(progressMap);

      for (const instanceId of selected) {
        const instance = instanceRows.find((row) => row.instanceId === instanceId);
        if (!instance) throw new Error(`Instance missing: ${instanceId}`);
        const schema = schemaByInstance[instanceId] ?? instance.defaultSchema;
        const existingSnapshot = existingSnapshotByInstance[instanceId]?.trim();

        if (existingSnapshot) {
          snapshotIdsByInstance.set(instanceId, existingSnapshot);
          progressMap[instanceId] = {
            instanceId,
            status: "SNAPSHOT_READY",
            snapshotId: existingSnapshot,
            message: "Using provided snapshot",
          };
          setProgress({ ...progressMap });
          continue;
        }

        const queued = await api.createSnapshot(instanceId, {
          schema,
          filters: { tableNameLike: null, includeViews: false },
        });
        progressMap[instanceId] = {
          instanceId,
          status: "SNAPSHOT_QUEUED",
          snapshotId: queued.snapshotId,
          message: "Queued",
        };
        setProgress({ ...progressMap });

        const ready = await waitForSnapshotReady(queued.snapshotId, {
          onUpdate: (snapshot) => {
            progressMap[instanceId] = {
              instanceId,
              status: snapshot.status === "READY" ? "SNAPSHOT_READY" : "SNAPSHOT_RUNNING",
              snapshotId: queued.snapshotId,
              message: snapshot.status,
            };
            setProgress({ ...progressMap });
          },
        });
        snapshotIdsByInstance.set(instanceId, ready.snapshotId);
        addHistory({
          snapshotId: ready.snapshotId,
          instanceId,
          schema,
          createdAt: ready.createdAt,
        });
      }

      const baselineSnapshotId = snapshotIdsByInstance.get(effectiveBaseline);
      if (!baselineSnapshotId) throw new Error("Missing baseline snapshot");
      const snapshotIds = selected
        .map((instanceId) => snapshotIdsByInstance.get(instanceId))
        .filter((id): id is string => Boolean(id));

      const compareRun = await api.createCompareRun({
        baselineSnapshotId,
        snapshotIds,
        options,
      });

      return {
        compareRunId: compareRun.compareRunId,
        baselineSnapshotId,
        baselineInstanceId: effectiveBaseline,
      };
    },
    onSuccess: (result) => {
      router.push(
        `/compare/${encodeURIComponent(result.compareRunId)}?baselineSnapshotId=${encodeURIComponent(result.baselineSnapshotId)}&baselineInstanceId=${encodeURIComponent(result.baselineInstanceId)}&onlyDifferences=${String(onlyDifferences)}`,
      );
    },
    onError: (error) => {
      if (error instanceof ApiClientError) {
        setErrorText(`${error.code}: ${error.message}`);
      } else if (error instanceof Error) {
        setErrorText(error.message);
      } else {
        setErrorText("Failed to create compare run");
      }
    },
  });

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">Start New Compare</Typography>
        <Typography color="text.secondary">
          Select baseline + target instances, create/attach snapshots, and generate compare run.
        </Typography>
      </Box>

      {errorText ? <Alert severity="error">{errorText}</Alert> : null}

      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <FormControlLabel
            control={
              <Switch
                checked={options.matchIndexByDefinition}
                onChange={(event) =>
                  setOptions((prev) => ({ ...prev, matchIndexByDefinition: event.target.checked }))
                }
              />
            }
            label="Match index by definition"
          />
          <FormControlLabel
            control={
              <Switch
                checked={options.ignoreIndexName}
                onChange={(event) => setOptions((prev) => ({ ...prev, ignoreIndexName: event.target.checked }))}
              />
            }
            label="Ignore index name"
          />
          <FormControlLabel
            control={
              <Switch
                checked={options.ignoreColumnOrder}
                onChange={(event) =>
                  setOptions((prev) => ({ ...prev, ignoreColumnOrder: event.target.checked }))
                }
              />
            }
            label="Ignore column order"
          />
          <FormControlLabel
            control={<Switch checked={onlyDifferences} onChange={(event) => setOnlyDifferences(event.target.checked)} />}
            label="Open with only differences"
          />
        </Stack>
      </Paper>

      <Paper sx={{ p: 1.5, overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Pick</TableCell>
              <TableCell>Baseline</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Environment</TableCell>
              <TableCell>Schema</TableCell>
              <TableCell>Use Existing Snapshot ID (optional)</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(instancesQuery.data?.items ?? []).map((instance) => {
              const selectedNow = selected.includes(instance.instanceId);
              const progressRow = progress[instance.instanceId];
              return (
                <TableRow key={instance.instanceId} hover>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={selectedNow}
                      onChange={(event) => toggleSelect(instance.instanceId, event.target.checked)}
                    />
                  </TableCell>
                  <TableCell padding="checkbox">
                    <Radio
                      checked={effectiveBaseline === instance.instanceId}
                      onChange={() => setBaselineInstanceId(instance.instanceId)}
                      disabled={!selectedNow}
                    />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <strong>{instance.name}</strong>
                      <Chip size="small" label={instance.instanceId.slice(0, 8)} />
                    </Stack>
                  </TableCell>
                  <TableCell>{instance.environment}</TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      value={schemaByInstance[instance.instanceId] ?? instance.defaultSchema}
                      onChange={(event) =>
                        setSchemaByInstance((prev) => ({
                          ...prev,
                          [instance.instanceId]: event.target.value,
                        }))
                      }
                      sx={{ minWidth: 130 }}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      placeholder="snapshot UUID"
                      value={existingSnapshotByInstance[instance.instanceId] ?? ""}
                      onChange={(event) =>
                        setExistingSnapshotByInstance((prev) => ({
                          ...prev,
                          [instance.instanceId]: event.target.value,
                        }))
                      }
                      fullWidth
                    />
                  </TableCell>
                  <TableCell>
                    {progressRow ? (
                      <Chip
                        size="small"
                        color={
                          progressRow.status === "FAILED"
                            ? "error"
                            : progressRow.status === "SNAPSHOT_READY"
                              ? "success"
                              : "default"
                        }
                        label={progressRow.message}
                      />
                    ) : (
                      "--"
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      <Stack direction="row" spacing={1.5}>
        <Button
          variant="contained"
          size="large"
          startIcon={createRunMutation.isPending ? <CircularProgress size={16} /> : <PlayArrowIcon />}
          disabled={createRunMutation.isPending || selected.length < 2}
          onClick={() => createRunMutation.mutate()}
        >
          Create Compare Run
        </Button>
        <Typography color="text.secondary" sx={{ alignSelf: "center" }}>
          Selected: {selected.length} instance(s)
        </Typography>
      </Stack>
    </Stack>
  );
};

export default function CompareNewPage() {
  return (
    <Suspense
      fallback={
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h4">Start New Compare</Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={18} />
            <span>Loading compare setup...</span>
          </Stack>
        </Stack>
      }
    >
      <CompareNewPageContent />
    </Suspense>
  );
}
