"use client";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  FormControlLabel,
  IconButton,
  Paper,
  Radio,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import TuneIcon from "@mui/icons-material/Tune";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
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

const StatusIcon = ({ status }: { status: ProgressRow["status"] }) => {
  switch (status) {
    case "SNAPSHOT_READY":
      return <CheckCircleOutlineIcon sx={{ fontSize: 18, color: "success.main" }} />;
    case "FAILED":
      return <ErrorOutlineIcon sx={{ fontSize: 18, color: "error.main" }} />;
    case "SNAPSHOT_QUEUED":
    case "SNAPSHOT_RUNNING":
      return <CircularProgress size={16} />;
    default:
      return <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: "text.secondary" }} />;
  }
};

const CompareNewPageContent = () => {
  const theme = useTheme();
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
  const [optionsOpen, setOptionsOpen] = useState(false);
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

  const isRunning = createRunMutation.isPending;

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">Start New Compare</Typography>
        <Typography color="text.secondary">
          Select baseline + target instances, create or attach snapshots, and generate a compare run.
        </Typography>
      </Box>

      {errorText ? <Alert severity="error">{errorText}</Alert> : null}

      {/* ── Options panel ── */}
      <Paper sx={{ overflow: "hidden" }}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          onClick={() => setOptionsOpen((v) => !v)}
          sx={{
            px: 2,
            py: 1.2,
            cursor: "pointer",
            "&:hover": { bgcolor: theme.compare.tableHoverBg },
            transition: "background 0.15s",
          }}
        >
          <TuneIcon sx={{ fontSize: 20, color: "primary.main" }} />
          <Typography sx={{ fontWeight: 650, flexGrow: 1 }}>Compare Options</Typography>
          <Chip size="small" label={`${Object.values(options).filter(Boolean).length} active`} color="primary" variant="outlined" />
          <IconButton size="small">
            <ExpandMoreIcon sx={{ transform: optionsOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
          </IconButton>
        </Stack>
        <Collapse in={optionsOpen}>
          <Stack spacing={1} sx={{ px: 2, pb: 2, pt: 0.5, borderTop: `1px solid ${theme.compare.tableBorder}` }}>
            <FormControlLabel
              control={
                <Switch
                  checked={options.matchIndexByDefinition}
                  onChange={(event) =>
                    setOptions((prev) => ({ ...prev, matchIndexByDefinition: event.target.checked }))
                  }
                />
              }
              label={<Typography variant="body2">Match index by definition</Typography>}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={options.ignoreIndexName}
                  onChange={(event) => setOptions((prev) => ({ ...prev, ignoreIndexName: event.target.checked }))}
                />
              }
              label={<Typography variant="body2">Ignore index name</Typography>}
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
              label={<Typography variant="body2">Ignore column order</Typography>}
            />
            <FormControlLabel
              control={<Switch checked={onlyDifferences} onChange={(event) => setOnlyDifferences(event.target.checked)} />}
              label={<Typography variant="body2">Open with only differences</Typography>}
            />
          </Stack>
        </Collapse>
      </Paper>

      {/* ── Instances table ── */}
      <Paper sx={{ overflow: "hidden" }}>
        <Box sx={{ px: 2, py: 1.2, borderBottom: `1px solid ${theme.compare.tableBorder}` }}>
          <Typography sx={{ fontWeight: 650 }}>Select Instances</Typography>
        </Box>
        <Box sx={{ overflowX: "auto" }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
            <Box component="thead">
              <Box component="tr" sx={{ bgcolor: theme.compare.tableHeaderBg }}>
                {["", "", "Name", "Environment", "Schema", "Existing Snapshot ID", "Status"].map((label, i) => (
                  <Box
                    key={i}
                    component="th"
                    sx={{
                      px: 1.5,
                      py: 1,
                      textAlign: "left",
                      color: theme.compare.tableHeaderColor,
                      fontWeight: 800,
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      borderBottom: `1px solid ${theme.compare.tableBorder}`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </Box>
                ))}
              </Box>
            </Box>
            <Box component="tbody">
              {instanceRows.map((instance) => {
                const isSelected = selected.includes(instance.instanceId);
                const progressRow = progress[instance.instanceId];
                return (
                  <Box
                    key={instance.instanceId}
                    component="tr"
                    sx={{
                      bgcolor: isSelected ? theme.compare.tableExpandedBg : "transparent",
                      "&:hover": { bgcolor: theme.compare.tableHoverBg },
                      transition: "background 0.15s",
                    }}
                  >
                    <Box component="td" sx={{ px: 1.5, py: 0.8, borderBottom: `1px solid ${theme.compare.tableBorder}` }}>
                      <Checkbox
                        size="small"
                        checked={isSelected}
                        onChange={(event) => toggleSelect(instance.instanceId, event.target.checked)}
                      />
                    </Box>
                    <Box component="td" sx={{ px: 1, py: 0.8, borderBottom: `1px solid ${theme.compare.tableBorder}` }}>
                      <Tooltip title="Set as baseline">
                        <Radio
                          size="small"
                          checked={effectiveBaseline === instance.instanceId}
                          onChange={() => setBaselineInstanceId(instance.instanceId)}
                          disabled={!isSelected}
                        />
                      </Tooltip>
                    </Box>
                    <Box component="td" sx={{ px: 1.5, py: 0.8, borderBottom: `1px solid ${theme.compare.tableBorder}` }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography sx={{ fontWeight: 700 }}>{instance.name}</Typography>
                        <Chip
                          size="small"
                          label={instance.instanceId.slice(0, 8)}
                          variant="outlined"
                          sx={{ fontSize: 10, height: 20 }}
                        />
                        {effectiveBaseline === instance.instanceId && isSelected ? (
                          <Chip size="small" label="BASELINE" color="primary" sx={{ fontSize: 10, height: 20, fontWeight: 800 }} />
                        ) : null}
                      </Stack>
                    </Box>
                    <Box component="td" sx={{ px: 1.5, py: 0.8, borderBottom: `1px solid ${theme.compare.tableBorder}`, color: "text.secondary" }}>
                      {instance.environment}
                    </Box>
                    <Box component="td" sx={{ px: 1.5, py: 0.8, borderBottom: `1px solid ${theme.compare.tableBorder}` }}>
                      <TextField
                        size="small"
                        value={schemaByInstance[instance.instanceId] ?? instance.defaultSchema}
                        onChange={(event) =>
                          setSchemaByInstance((prev) => ({
                            ...prev,
                            [instance.instanceId]: event.target.value,
                          }))
                        }
                        sx={{ minWidth: 120 }}
                        slotProps={{ input: { sx: { fontSize: 13 } } }}
                      />
                    </Box>
                    <Box component="td" sx={{ px: 1.5, py: 0.8, borderBottom: `1px solid ${theme.compare.tableBorder}` }}>
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
                        slotProps={{ input: { sx: { fontSize: 13 } } }}
                      />
                    </Box>
                    <Box component="td" sx={{ px: 1.5, py: 0.8, borderBottom: `1px solid ${theme.compare.tableBorder}` }}>
                      {progressRow ? (
                        <Stack direction="row" spacing={0.7} alignItems="center">
                          <StatusIcon status={progressRow.status} />
                          <Typography sx={{ fontSize: 12 }}>{progressRow.message}</Typography>
                        </Stack>
                      ) : (
                        <Typography sx={{ fontSize: 12, color: "text.secondary" }}>--</Typography>
                      )}
                    </Box>
                  </Box>
                );
              })}
              {instanceRows.length === 0 && !instancesQuery.isLoading ? (
                <Box component="tr">
                  <Box component="td" colSpan={7} sx={{ px: 2, py: 4, textAlign: "center", color: "text.secondary" }}>
                    No instances found. Create instances first.
                  </Box>
                </Box>
              ) : null}
              {instancesQuery.isLoading ? (
                <Box component="tr">
                  <Box component="td" colSpan={7} sx={{ px: 2, py: 3, textAlign: "center" }}>
                    <CircularProgress size={20} />
                  </Box>
                </Box>
              ) : null}
            </Box>
          </Box>
        </Box>
      </Paper>

      {/* ── Action bar ── */}
      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
          <Button
            variant="contained"
            size="large"
            startIcon={isRunning ? <CircularProgress size={16} /> : <PlayArrowIcon />}
            disabled={isRunning || selected.length < 2}
            onClick={() => createRunMutation.mutate()}
            sx={{ minWidth: 200 }}
          >
            Create Compare Run
          </Button>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              label={`${selected.length} selected`}
              color={selected.length >= 2 ? "primary" : "default"}
              variant="outlined"
            />
            {selected.length < 2 ? (
              <Typography variant="body2" color="text.secondary">
                Select at least 2 instances
              </Typography>
            ) : null}
          </Stack>
        </Stack>
      </Paper>
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
