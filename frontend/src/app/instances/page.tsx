"use client";

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Paper,
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
import RefreshIcon from "@mui/icons-material/Refresh";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { InstanceItem } from "@/lib/types";
import { useSnapshotHistory } from "@/hooks/useSnapshotHistory";

type FormMode = "create" | "edit";

type InstanceFormState = {
  name: string;
  environment: string;
  crmBaseUrl: string;
  dbType: "oracle" | "mariadb";
  defaultSchema: string;
  capabilitiesRead: boolean;
  capabilitiesWrite: boolean;
  authRef: string;
  updateAuthRef: boolean;
};

const buildCreateForm = (): InstanceFormState => ({
  name: "",
  environment: "dev",
  crmBaseUrl: "",
  dbType: "oracle",
  defaultSchema: "CRM",
  capabilitiesRead: true,
  capabilitiesWrite: true,
  authRef: "",
  updateAuthRef: true,
});

const buildEditForm = (instance: InstanceItem): InstanceFormState => ({
  name: instance.name,
  environment: instance.environment,
  crmBaseUrl: instance.crmBaseUrl,
  dbType: instance.dbType,
  defaultSchema: instance.defaultSchema,
  capabilitiesRead: instance.capabilities.read,
  capabilitiesWrite: instance.capabilities.write,
  authRef: "",
  updateAuthRef: false,
});

export default function InstancesPage() {
  const { hasRole } = useAuth();
  const canManageInstances = hasRole("admin");
  const { add: addHistory } = useSnapshotHistory();
  const [schemaOverrides, setSchemaOverrides] = useState<Record<string, string>>({});
  const [errorText, setErrorText] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [editingInstanceId, setEditingInstanceId] = useState<string | null>(null);
  const [formState, setFormState] = useState<InstanceFormState>(buildCreateForm());

  const instancesQuery = useQuery({
    queryKey: ["instances"],
    queryFn: () => api.listInstances(),
  });

  const snapshotMutation = useMutation({
    mutationFn: async (input: { instanceId: string; schema: string }) =>
      api.createSnapshot(input.instanceId, {
        schema: input.schema,
        filters: { tableNameLike: null, includeViews: false },
      }),
    onSuccess: (result, variables) => {
      setErrorText(null);
      addHistory({
        snapshotId: result.snapshotId,
        instanceId: variables.instanceId,
        schema: variables.schema,
        createdAt: new Date().toISOString(),
      });
    },
    onError: (error) => {
      if (error instanceof ApiClientError) {
        setErrorText(`${error.code}: ${error.message}`);
      } else {
        setErrorText("Failed to start snapshot job");
      }
    },
  });

  const createInstanceMutation = useMutation({
    mutationFn: (input: {
      name: string;
      environment: string;
      crmBaseUrl: string;
      dbType: "oracle" | "mariadb";
      defaultSchema: string;
      capabilities: { read: boolean; write: boolean };
      authRef: string | null;
    }) => api.createInstance(input),
    onSuccess: async () => {
      setErrorText(null);
      setDialogOpen(false);
      setEditingInstanceId(null);
      setFormState(buildCreateForm());
      await instancesQuery.refetch();
    },
    onError: (error) => {
      if (error instanceof ApiClientError) {
        setErrorText(`${error.code}: ${error.message}`);
      } else {
        setErrorText("Failed to create instance");
      }
    },
  });

  const updateInstanceMutation = useMutation({
    mutationFn: (input: {
      instanceId: string;
      body: Partial<{
        name: string;
        environment: string;
        crmBaseUrl: string;
        dbType: "oracle" | "mariadb";
        defaultSchema: string;
        capabilities: { read: boolean; write: boolean };
        authRef: string | null;
      }>;
    }) => api.updateInstance(input.instanceId, input.body),
    onSuccess: async () => {
      setErrorText(null);
      setDialogOpen(false);
      setEditingInstanceId(null);
      setFormState(buildCreateForm());
      await instancesQuery.refetch();
    },
    onError: (error) => {
      if (error instanceof ApiClientError) {
        setErrorText(`${error.code}: ${error.message}`);
      } else {
        setErrorText("Failed to update instance");
      }
    },
  });

  const openCreateDialog = () => {
    setFormMode("create");
    setEditingInstanceId(null);
    setFormState(buildCreateForm());
    setDialogOpen(true);
  };

  const openEditDialog = (instance: InstanceItem) => {
    setFormMode("edit");
    setEditingInstanceId(instance.instanceId);
    setFormState(buildEditForm(instance));
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
  };

  const submitInstanceForm = () => {
    const payload = {
      name: formState.name.trim(),
      environment: formState.environment.trim(),
      crmBaseUrl: formState.crmBaseUrl.trim(),
      dbType: formState.dbType,
      defaultSchema: formState.defaultSchema.trim(),
      capabilities: {
        read: formState.capabilitiesRead,
        write: formState.capabilitiesWrite,
      },
    };

    if (!payload.name || !payload.environment || !payload.crmBaseUrl || !payload.defaultSchema) {
      setErrorText("Please fill all required fields");
      return;
    }

    if (formMode === "create") {
      createInstanceMutation.mutate({
        ...payload,
        authRef: formState.authRef.trim() ? formState.authRef.trim() : null,
      });
      return;
    }

    if (!editingInstanceId) return;
    const updateBody: {
      name: string;
      environment: string;
      crmBaseUrl: string;
      dbType: "oracle" | "mariadb";
      defaultSchema: string;
      capabilities: { read: boolean; write: boolean };
      authRef?: string | null;
    } = {
      ...payload,
      capabilities: payload.capabilities,
    };
    if (formState.updateAuthRef) {
      updateBody.authRef = formState.authRef.trim() ? formState.authRef.trim() : null;
    }
    updateInstanceMutation.mutate({
      instanceId: editingInstanceId,
      body: updateBody,
    });
  };

  const rows = useMemo(() => instancesQuery.data?.items ?? [], [instancesQuery.data]);
  const isSavingInstance = createInstanceMutation.isPending || updateInstanceMutation.isPending;

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Box>
          <Typography variant="h4">Instances</Typography>
          <Typography color="text.secondary">
            Trigger snapshots and jump into compare flows without direct DB credentials.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => instancesQuery.refetch()}
          disabled={instancesQuery.isFetching}
        >
          Refresh
        </Button>
      </Stack>

      {canManageInstances ? (
        <Stack direction="row" justifyContent="flex-end">
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateDialog}>
            New instance
          </Button>
        </Stack>
      ) : null}

      {errorText ? <Alert severity="error">{errorText}</Alert> : null}

      <Paper sx={{ p: 1.5, overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Environment</TableCell>
              <TableCell>DB</TableCell>
              <TableCell>Default Schema</TableCell>
              <TableCell>Capabilities</TableCell>
              <TableCell>Last Snapshot</TableCell>
              <TableCell sx={{ minWidth: 220 }}>Snapshot Schema</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {instancesQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <CircularProgress size={18} /> <span>Loading instances...</span>
                  </Stack>
                </TableCell>
              </TableRow>
            ) : null}

            {!instancesQuery.isLoading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <Alert severity="info">No instances available.</Alert>
                </TableCell>
              </TableRow>
            ) : null}

            {rows.map((instance) => {
              const schema = schemaOverrides[instance.instanceId] ?? instance.defaultSchema;
              const isPending =
                snapshotMutation.isPending &&
                snapshotMutation.variables?.instanceId === instance.instanceId;

              return (
                <TableRow key={instance.instanceId} hover>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <strong>{instance.name}</strong>
                      <Chip size="small" label={instance.instanceId.slice(0, 8)} />
                    </Stack>
                  </TableCell>
                  <TableCell>{instance.environment}</TableCell>
                  <TableCell>{instance.dbType}</TableCell>
                  <TableCell>{instance.defaultSchema}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1}>
                      <Chip size="small" color={instance.capabilities.read ? "success" : "default"} label={`read:${instance.capabilities.read}`} />
                      <Chip size="small" color={instance.capabilities.write ? "warning" : "default"} label={`write:${instance.capabilities.write}`} />
                    </Stack>
                  </TableCell>
                  <TableCell>{instance.lastSnapshotAt ? new Date(instance.lastSnapshotAt).toLocaleString() : "Never"}</TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      fullWidth
                      value={schema}
                      onChange={(event) =>
                        setSchemaOverrides((prev) => ({
                          ...prev,
                          [instance.instanceId]: event.target.value,
                        }))
                      }
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      {canManageInstances ? (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<EditIcon />}
                          onClick={() => openEditDialog(instance)}
                        >
                          Edit
                        </Button>
                      ) : null}
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={isPending ? <CircularProgress size={14} /> : <CameraAltIcon />}
                        disabled={isPending || !schema}
                        onClick={() => snapshotMutation.mutate({ instanceId: instance.instanceId, schema })}
                      >
                        Snapshot now
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        component={Link}
                        href={`/compare/new?baselineInstanceId=${encodeURIComponent(instance.instanceId)}`}
                        startIcon={<CompareArrowsIcon />}
                      >
                        Compare
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>{formMode === "create" ? "Create instance" : "Edit instance"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Name"
              value={formState.name}
              onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
              required
              fullWidth
            />
            <TextField
              label="Environment"
              value={formState.environment}
              onChange={(event) => setFormState((prev) => ({ ...prev, environment: event.target.value }))}
              required
              fullWidth
            />
            <TextField
              label="CRM Base URL"
              value={formState.crmBaseUrl}
              onChange={(event) => setFormState((prev) => ({ ...prev, crmBaseUrl: event.target.value }))}
              required
              fullWidth
              placeholder="http://localhost:8087/services/rest"
            />
            <TextField
              label="DB Type"
              select
              value={formState.dbType}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  dbType: event.target.value as "oracle" | "mariadb",
                }))
              }
              fullWidth
            >
              <MenuItem value="oracle">oracle</MenuItem>
              <MenuItem value="mariadb">mariadb</MenuItem>
            </TextField>
            <TextField
              label="Default Schema"
              value={formState.defaultSchema}
              onChange={(event) => setFormState((prev) => ({ ...prev, defaultSchema: event.target.value }))}
              required
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formState.capabilitiesRead}
                  onChange={(_, checked) =>
                    setFormState((prev) => ({ ...prev, capabilitiesRead: checked }))
                  }
                />
              }
              label="Read capability"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formState.capabilitiesWrite}
                  onChange={(_, checked) =>
                    setFormState((prev) => ({ ...prev, capabilitiesWrite: checked }))
                  }
                />
              }
              label="Write capability"
            />
            {formMode === "edit" ? (
              <FormControlLabel
                control={
                  <Switch
                    checked={formState.updateAuthRef}
                    onChange={(_, checked) =>
                      setFormState((prev) => ({ ...prev, updateAuthRef: checked }))
                    }
                  />
                }
                label="Update authRef"
              />
            ) : null}
            {formMode === "create" || formState.updateAuthRef ? (
              <TextField
                label="authRef (optional)"
                value={formState.authRef}
                onChange={(event) => setFormState((prev) => ({ ...prev, authRef: event.target.value }))}
                fullWidth
                placeholder="secret://crm/dev-1"
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" onClick={submitInstanceForm} disabled={isSavingInstance}>
            {isSavingInstance ? <CircularProgress size={16} /> : formMode === "create" ? "Create" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
