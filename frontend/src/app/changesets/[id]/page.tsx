"use client";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RuleIcon from "@mui/icons-material/Rule";
import SaveIcon from "@mui/icons-material/Save";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { api, ApiClientError } from "@/lib/api";
import type { ChangeStep } from "@/lib/types";
import { RoleGate } from "@/components/RoleGate";

const reorder = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};

export default function ChangeSetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const changeSetId = params.id;

  const [localSteps, setLocalSteps] = useState<ChangeStep[]>([]);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [validationResult, setValidationResult] = useState<{
    overallValid: boolean;
    perTarget: Record<string, { valid: boolean; results: unknown[] }>;
  } | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [strict, setStrict] = useState(true);
  const [stopOnError, setStopOnError] = useState(true);
  const [jsonDraft, setJsonDraft] = useState("");

  const changeSetQuery = useQuery({
    queryKey: ["changeset", changeSetId],
    queryFn: () => api.getChangeSet(changeSetId),
  });

  const instancesQuery = useQuery({
    queryKey: ["instances"],
    queryFn: () => api.listInstances(),
  });

  useEffect(() => {
    if (changeSetQuery.data) {
      setLocalSteps(changeSetQuery.data.steps);
      setJsonDraft(JSON.stringify(changeSetQuery.data.steps, null, 2));
    }
  }, [changeSetQuery.data]);

  const saveReorderedMutation = useMutation({
    mutationFn: () =>
      api.addChangeSetSteps(changeSetId, {
        append: false,
        steps: localSteps,
      }),
    onSuccess: () => {
      setErrorText(null);
      changeSetQuery.refetch();
    },
    onError: (error) => {
      if (error instanceof ApiClientError) setErrorText(`${error.code}: ${error.message}`);
      else setErrorText("Failed to save step order");
    },
  });

  const updateStepsFromJsonMutation = useMutation({
    mutationFn: () => {
      const parsed = JSON.parse(jsonDraft) as ChangeStep[];
      return api.addChangeSetSteps(changeSetId, {
        append: false,
        steps: parsed,
      });
    },
    onSuccess: () => {
      setErrorText(null);
      changeSetQuery.refetch();
    },
    onError: (error) => {
      if (error instanceof ApiClientError) setErrorText(`${error.code}: ${error.message}`);
      else if (error instanceof Error) setErrorText(error.message);
      else setErrorText("Failed to update steps");
    },
  });

  const validateMutation = useMutation({
    mutationFn: () =>
      api.validateChangeSet(changeSetId, {
        targetInstanceIds: selectedTargetIds,
        options: {
          returnSqlPreview: true,
          strict,
        },
      }),
    onSuccess: (result) => {
      setErrorText(null);
      setValidationResult(result);
      changeSetQuery.refetch();
    },
    onError: (error) => {
      if (error instanceof ApiClientError) setErrorText(`${error.code}: ${error.message}`);
      else setErrorText("Validation failed");
    },
  });

  const executeMutation = useMutation({
    mutationFn: () =>
      api.executeChangeSet(changeSetId, {
        targetInstanceIds: selectedTargetIds,
        options: { stopOnError },
      }),
    onSuccess: (result) => {
      setErrorText(null);
      const first = result.executionIds[0];
      if (first) router.push(`/executions/${encodeURIComponent(first.executionId)}?jobId=${encodeURIComponent(first.jobId)}`);
    },
    onError: (error) => {
      if (error instanceof ApiClientError) setErrorText(`${error.code}: ${error.message}`);
      else setErrorText("Execution failed");
    },
  });

  const instanceRows = useMemo(() => instancesQuery.data?.items ?? [], [instancesQuery.data]);

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">ChangeSet {changeSetId.slice(0, 8)}</Typography>
        <Typography color="text.secondary">
          Reorder steps (drag-drop), validate targets, execute async.
        </Typography>
      </Box>

      {errorText ? <Alert severity="error">{errorText}</Alert> : null}

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">Step Order (Drag and Drop)</Typography>
        {changeSetQuery.isLoading ? (
          <Stack direction="row" spacing={1} alignItems="center" mt={1}>
            <CircularProgress size={16} />
            <span>Loading steps...</span>
          </Stack>
        ) : null}

        <List sx={{ mt: 1 }}>
          {localSteps.map((step, index) => (
            <ListItem
              key={step.stepId}
              draggable
              onDragStart={() => setDragFrom(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragFrom === null || dragFrom === index) return;
                setLocalSteps((prev) => reorder(prev, dragFrom, index));
                setDragFrom(null);
              }}
              sx={{
                border: "1px solid rgba(0,0,0,0.08)",
                borderRadius: 1.5,
                mb: 1,
                background: "rgba(255,255,255,0.78)",
              }}
              secondaryAction={
                <Chip
                  size="small"
                  label={step.stepId}
                  className="mono"
                  sx={{ maxWidth: 130 }}
                />
              }
            >
              <DragIndicatorIcon fontSize="small" sx={{ mr: 1.2, color: "text.secondary" }} />
              <ListItemText
                primary={`${index + 1}. ${step.action} ${step.target.schema}.${step.target.table}`}
                secondary={[
                  step.column ? `column=${step.column.name}` : null,
                  step.index ? `index=${step.index.name}` : null,
                ]
                  .filter(Boolean)
                  .join(" | ")}
              />
            </ListItem>
          ))}
        </List>
        <Stack direction="row" spacing={1.2}>
          <RoleGate roles={["editor", "admin"]}>
            <Button
              variant="contained"
              startIcon={saveReorderedMutation.isPending ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={() => saveReorderedMutation.mutate()}
              disabled={saveReorderedMutation.isPending}
            >
              Save Order
            </Button>
          </RoleGate>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">JSON Step Editor</Typography>
        <Typography color="text.secondary" variant="body2">
          Paste/edit raw `ChangeStep[]` and save.
        </Typography>
        <TextField
          value={jsonDraft}
          onChange={(event) => setJsonDraft(event.target.value)}
          multiline
          minRows={8}
          fullWidth
          sx={{ mt: 1.2 }}
          InputProps={{ className: "mono" }}
        />
        <Stack direction="row" spacing={1.2} mt={1.2}>
          <RoleGate roles={["editor", "admin"]}>
            <Button
              variant="outlined"
              startIcon={updateStepsFromJsonMutation.isPending ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={() => updateStepsFromJsonMutation.mutate()}
            >
              Save JSON
            </Button>
          </RoleGate>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">Targets</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mt={1}>
          {instanceRows.map((instance) => (
            <FormControlLabel
              key={instance.instanceId}
              control={
                <Checkbox
                  checked={selectedTargetIds.includes(instance.instanceId)}
                  onChange={(event) =>
                    setSelectedTargetIds((prev) =>
                      event.target.checked
                        ? [...new Set([...prev, instance.instanceId])]
                        : prev.filter((id) => id !== instance.instanceId),
                    )
                  }
                />
              }
              label={`${instance.name} (${instance.instanceId.slice(0, 8)})`}
            />
          ))}
        </Stack>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} alignItems={{ md: "center" }}>
          <FormControlLabel
            control={<Checkbox checked={strict} onChange={(event) => setStrict(event.target.checked)} />}
            label="Strict validation"
          />
          <RoleGate roles={["editor", "executor", "admin"]}>
            <Button
              variant="contained"
              startIcon={validateMutation.isPending ? <CircularProgress size={16} /> : <RuleIcon />}
              disabled={validateMutation.isPending || selectedTargetIds.length === 0}
              onClick={() => validateMutation.mutate()}
            >
              Validate
            </Button>
          </RoleGate>

          <Divider orientation="vertical" flexItem sx={{ display: { xs: "none", md: "block" }, mx: 0.5 }} />

          <FormControlLabel
            control={<Checkbox checked={stopOnError} onChange={(event) => setStopOnError(event.target.checked)} />}
            label="Stop on error"
          />
          <RoleGate roles={["executor", "approver", "admin"]}>
            <Button
              variant="contained"
              color="secondary"
              startIcon={executeMutation.isPending ? <CircularProgress size={16} /> : <PlayArrowIcon />}
              disabled={executeMutation.isPending || selectedTargetIds.length === 0}
              onClick={() => executeMutation.mutate()}
            >
              Execute
            </Button>
          </RoleGate>
        </Stack>
      </Paper>

      {validationResult ? (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6">Validation Result</Typography>
          <Alert severity={validationResult.overallValid ? "success" : "warning"} sx={{ mt: 1 }}>
            overallValid={String(validationResult.overallValid)}
          </Alert>
          <Stack spacing={1.2} mt={1.2}>
            {Object.entries(validationResult.perTarget).map(([instanceId, target]) => (
              <Paper key={instanceId} sx={{ p: 1.5 }}>
                <Typography variant="subtitle2">
                  Target <span className="mono">{instanceId}</span> | valid={String(target.valid)}
                </Typography>
                <Typography variant="body2" className="mono" sx={{ whiteSpace: "pre-wrap", mt: 0.8 }}>
                  {JSON.stringify(target.results, null, 2)}
                </Typography>
              </Paper>
            ))}
          </Stack>
        </Paper>
      ) : null}

      {executeMutation.data?.executionIds ? (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6">Execution Jobs</Typography>
          <Stack spacing={1.2} mt={1.2}>
            {executeMutation.data.executionIds.map((exec) => (
              <Button
                key={exec.executionId}
                component={Link}
                href={`/executions/${encodeURIComponent(exec.executionId)}?jobId=${encodeURIComponent(exec.jobId)}`}
                variant="outlined"
              >
                Open execution {exec.executionId}
              </Button>
            ))}
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  );
}
