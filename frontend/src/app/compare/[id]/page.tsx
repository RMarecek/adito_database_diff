"use client";

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import AddTaskIcon from "@mui/icons-material/AddTask";
import EditNoteIcon from "@mui/icons-material/EditNote";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { DataGrid, type GridColDef, type GridPaginationModel, type GridRowSelectionModel } from "@mui/x-data-grid";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api";
import { RoleGate } from "@/components/RoleGate";

const CompareRunPageContent = () => {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const compareRunId = params.id;
  const baselineSnapshotId = searchParams.get("baselineSnapshotId") ?? "";
  const baselineInstanceIdFromQuery = searchParams.get("baselineInstanceId") ?? "";
  const initialOnlyDifferences = searchParams.get("onlyDifferences") === "true";

  const [search, setSearch] = useState("");
  const [onlyDifferences, setOnlyDifferences] = useState(initialOnlyDifferences);
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 100 });
  const [selectedTableKey, setSelectedTableKey] = useState<string>("");
  const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>([]);
  const [allowDestructive, setAllowDestructive] = useState(false);
  const [changeSetTitle, setChangeSetTitle] = useState("Generated from compare");
  const [errorText, setErrorText] = useState<string | null>(null);

  const matrixQuery = useQuery({
    queryKey: ["compare-matrix", compareRunId, paginationModel.page, paginationModel.pageSize, onlyDifferences, search],
    queryFn: () =>
      api.getCompareMatrix(compareRunId, {
        level: "table",
        onlyDifferences,
        search: search || undefined,
        offset: paginationModel.page * paginationModel.pageSize,
        limit: paginationModel.pageSize,
      }),
    placeholderData: (old) => old,
  });

  const detailsQuery = useQuery({
    queryKey: ["compare-details", compareRunId, selectedTableKey],
    queryFn: () => api.getCompareDetails(compareRunId, selectedTableKey),
    enabled: Boolean(selectedTableKey),
  });

  const baselineInstanceId =
    baselineInstanceIdFromQuery || matrixQuery.data?.instances[0]?.instanceId || "";
  const targetInstanceIds = (matrixQuery.data?.instances ?? [])
    .map((instance) => instance.instanceId)
    .filter((id) => id !== baselineInstanceId);

  const createChangeSetMutation = useMutation({
    mutationFn: async () => {
      if (selectionModel.length === 0) throw new Error("Select at least one table row");
      if (!baselineInstanceId) throw new Error("Missing baseline instance");
      if (targetInstanceIds.length === 0) throw new Error("No target instances available");

      const created = await api.createChangeSet({
        title: changeSetTitle,
        description: `Auto-generated from compare run ${compareRunId}`,
        sourceCompareRunId: compareRunId,
      });

      const tableKeys = selectionModel.map((value) => String(value));
      await api.planFromCompare(created.changeSetId, {
        compareRunId,
        tableKeys,
        targets: {
          baselineInstanceId,
          targetInstanceIds,
        },
        include: { tables: true, columns: true, indexes: true },
        strategy: {
          alignToBaseline: true,
          allowDestructive,
        },
      });

      return created.changeSetId;
    },
    onSuccess: (changeSetId) => {
      router.push(`/changesets/${encodeURIComponent(changeSetId)}`);
    },
    onError: (error) => {
      if (error instanceof ApiClientError) {
        setErrorText(`${error.code}: ${error.message}`);
      } else if (error instanceof Error) {
        setErrorText(error.message);
      } else {
        setErrorText("Failed to create changeset");
      }
    },
  });

  const columns = useMemo<GridColDef[]>(() => {
    const base: GridColDef[] = [
      { field: "displayName", headerName: "Table", flex: 1.4, minWidth: 220 },
      { field: "objectKey", headerName: "Key", flex: 1.4, minWidth: 260 },
      {
        field: "columnsDifferent",
        headerName: "Col Diff",
        width: 110,
        valueGetter: (_value, row) => row.diffSummary.columnsDifferent,
      },
      {
        field: "indexesDifferent",
        headerName: "Idx Diff",
        width: 110,
        valueGetter: (_value, row) => row.diffSummary.indexesDifferent,
      },
      {
        field: "missingColumns",
        headerName: "Missing Col",
        width: 120,
        valueGetter: (_value, row) => row.diffSummary.missingColumns,
      },
      {
        field: "missingIndexes",
        headerName: "Missing Idx",
        width: 120,
        valueGetter: (_value, row) => row.diffSummary.missingIndexes,
      },
    ];

    const instanceCols =
      matrixQuery.data?.instances.map<GridColDef>((instance) => ({
        field: `instance_${instance.instanceId}`,
        headerName: instance.name,
        minWidth: 160,
        flex: 0.9,
        valueGetter: (_value, row) =>
          `${row.cells?.[instance.instanceId]?.status ?? "?"}/${row.cells?.[instance.instanceId]?.diff ?? "?"}`,
      })) ?? [];

    return [...base, ...instanceCols];
  }, [matrixQuery.data?.instances]);

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }} justifyContent="space-between">
        <Box>
          <Typography variant="h4">Compare Run {compareRunId.slice(0, 8)}</Typography>
          <Typography color="text.secondary">
            Virtualized side-by-side matrix with lazy detail loading.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            size="small"
            label="Search table"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <FormControlLabel
            control={<Switch checked={onlyDifferences} onChange={(event) => setOnlyDifferences(event.target.checked)} />}
            label="Only differences"
          />
        </Stack>
      </Stack>

      {errorText ? <Alert severity="error">{errorText}</Alert> : null}

      <Paper sx={{ p: 1.5 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }}>
          <TextField
            size="small"
            label="ChangeSet title"
            value={changeSetTitle}
            onChange={(event) => setChangeSetTitle(event.target.value)}
            sx={{ minWidth: 260 }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={allowDestructive}
                onChange={(event) => setAllowDestructive(event.target.checked)}
              />
            }
            label="Allow destructive"
          />
          <RoleGate roles={["editor", "admin"]} fallback={<Alert severity="info">Need `editor` or `admin` role to create changesets.</Alert>}>
            <Button
              variant="contained"
              startIcon={createChangeSetMutation.isPending ? <CircularProgress size={16} /> : <AddTaskIcon />}
              disabled={createChangeSetMutation.isPending || selectionModel.length === 0}
              onClick={() => createChangeSetMutation.mutate()}
            >
              Create ChangeSet from Selected ({selectionModel.length})
            </Button>
          </RoleGate>

          {selectedTableKey && baselineSnapshotId ? (
            <Button
              variant="outlined"
              startIcon={<EditNoteIcon />}
              component={Link}
              href={`/tables/${encodeURIComponent(selectedTableKey)}?snapshotId=${encodeURIComponent(baselineSnapshotId)}`}
            >
              Open Table Editor
            </Button>
          ) : null}
        </Stack>
      </Paper>

      <Paper sx={{ height: 560, p: 1 }}>
        <DataGrid
          rows={matrixQuery.data?.items ?? []}
          getRowId={(row) => row.objectKey}
          columns={columns}
          paginationMode="server"
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          rowCount={matrixQuery.data?.total ?? 0}
          checkboxSelection
          keepNonExistentRowsSelected
          rowSelectionModel={selectionModel}
          onRowSelectionModelChange={setSelectionModel}
          loading={matrixQuery.isLoading}
          onRowClick={(params) => setSelectedTableKey(String(params.row.objectKey))}
          pageSizeOptions={[50, 100, 200]}
          disableRowSelectionOnClick
        />
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Stack direction="row" spacing={1.2} alignItems="center">
          <Typography variant="h6">Details</Typography>
          {selectedTableKey ? <Chip size="small" label={selectedTableKey} /> : null}
          {selectedTableKey && baselineSnapshotId ? (
            <Button
              size="small"
              variant="text"
              startIcon={<OpenInNewIcon />}
              component={Link}
              href={`/tables/${encodeURIComponent(selectedTableKey)}?snapshotId=${encodeURIComponent(baselineSnapshotId)}`}
            >
              Edit Table
            </Button>
          ) : null}
        </Stack>
        <Divider sx={{ my: 1.2 }} />

        {!selectedTableKey ? <Alert severity="info">Click a matrix row to load column/index details.</Alert> : null}

        {detailsQuery.isLoading ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={18} />
            <span>Loading details...</span>
          </Stack>
        ) : null}

        {detailsQuery.data ? (
          <Stack spacing={1.5}>
            <Typography variant="subtitle2">Column Diffs</Typography>
            {detailsQuery.data.diff.columns.length === 0 ? (
              <Typography color="text.secondary">No column diffs.</Typography>
            ) : (
              detailsQuery.data.diff.columns.map((item) => (
                <Chip
                  key={item.columnName}
                  label={`${item.columnName} | type:${item.typeDiff} null:${item.nullableDiff} default:${item.defaultDiff}`}
                  color="warning"
                  variant="outlined"
                />
              ))
            )}

            <Typography variant="subtitle2" sx={{ mt: 1 }}>
              Index Diffs
            </Typography>
            {detailsQuery.data.diff.indexes.length === 0 ? (
              <Typography color="text.secondary">No index diffs.</Typography>
            ) : (
              detailsQuery.data.diff.indexes.map((item) => (
                <Chip
                  key={item.indexDefinitionKey}
                  label={`${item.indexDefinitionKey} missing in: ${item.missingInInstanceIds.join(", ")}`}
                  color="secondary"
                  variant="outlined"
                />
              ))
            )}
          </Stack>
        ) : null}
      </Paper>
    </Stack>
  );
};

export default function CompareRunPage() {
  return (
    <Suspense
      fallback={
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h4">Compare Run</Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={18} />
            <span>Loading compare run...</span>
          </Stack>
        </Stack>
      }
    >
      <CompareRunPageContent />
    </Suspense>
  );
}
