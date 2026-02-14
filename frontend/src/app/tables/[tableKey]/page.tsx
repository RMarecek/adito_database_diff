"use client";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
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
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import SaveIcon from "@mui/icons-material/Save";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api";
import type { ChangeStep, ColumnSpec, IndexSpec, TableSpec } from "@/lib/types";
import { RoleGate } from "@/components/RoleGate";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const reorder = <T,>(items: T[], from: number, to: number): T[] => {
  const arr = [...items];
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
  return arr;
};

const normalizeColumns = (columns: ColumnSpec[]): ColumnSpec[] =>
  columns.map((column, idx) => ({ ...column, ordinalPosition: idx + 1 }));

const indexDefinition = (index: IndexSpec): string =>
  [
    index.unique ? "U1" : "U0",
    index.indexType.toUpperCase(),
    ...index.columns
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((col) => `${col.name.toUpperCase()}:${col.direction}:${col.expression ?? ""}`),
    index.whereClause ?? "",
  ].join("|");

const columnChanged = (a: ColumnSpec, b: ColumnSpec): boolean =>
  a.ordinalPosition !== b.ordinalPosition ||
  a.canonicalType !== b.canonicalType ||
  a.nativeType !== b.nativeType ||
  a.length !== b.length ||
  a.precision !== b.precision ||
  a.scale !== b.scale ||
  a.nullable !== b.nullable ||
  (a.defaultRaw ?? null) !== (b.defaultRaw ?? null);

const buildChangeSteps = (original: TableSpec, edited: TableSpec): ChangeStep[] => {
  const steps: ChangeStep[] = [];
  const target = { schema: edited.schema, table: edited.name };
  const originalCols = new Map(original.columns.map((column) => [column.name.toUpperCase(), column]));
  const editedCols = new Map(edited.columns.map((column) => [column.name.toUpperCase(), column]));

  for (const column of edited.columns) {
    const prev = originalCols.get(column.name.toUpperCase());
    if (!prev) {
      steps.push({
        stepId: crypto.randomUUID(),
        action: "ADD_COLUMN",
        target,
        table: null,
        column,
        index: null,
        options: { ifNotExists: true },
      });
    } else if (columnChanged(prev, column)) {
      steps.push({
        stepId: crypto.randomUUID(),
        action: "ALTER_COLUMN",
        target,
        table: null,
        column,
        index: null,
        options: null,
      });
    }
  }

  for (const column of original.columns) {
    if (!editedCols.has(column.name.toUpperCase())) {
      steps.push({
        stepId: crypto.randomUUID(),
        action: "DROP_COLUMN",
        target,
        table: null,
        column,
        index: null,
        options: { ifExists: true },
      });
    }
  }

  const originalByName = new Map(original.indexes.map((index) => [index.name.toUpperCase(), index]));
  const editedByName = new Map(edited.indexes.map((index) => [index.name.toUpperCase(), index]));

  for (const index of edited.indexes) {
    const prev = originalByName.get(index.name.toUpperCase());
    if (!prev) {
      steps.push({
        stepId: crypto.randomUUID(),
        action: "CREATE_INDEX",
        target,
        table: null,
        column: null,
        index,
        options: { ifNotExists: true },
      });
    } else if (indexDefinition(prev) !== indexDefinition(index)) {
      steps.push({
        stepId: crypto.randomUUID(),
        action: "DROP_INDEX",
        target,
        table: null,
        column: null,
        index: prev,
        options: { ifExists: true },
      });
      steps.push({
        stepId: crypto.randomUUID(),
        action: "CREATE_INDEX",
        target,
        table: null,
        column: null,
        index,
        options: { ifNotExists: true },
      });
    }
  }

  for (const index of original.indexes) {
    if (!editedByName.has(index.name.toUpperCase())) {
      steps.push({
        stepId: crypto.randomUUID(),
        action: "DROP_INDEX",
        target,
        table: null,
        column: null,
        index,
        options: { ifExists: true },
      });
    }
  }

  return steps;
};

const TableEditorPageContent = () => {
  const params = useParams<{ tableKey: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const tableKey = decodeURIComponent(params.tableKey);
  const snapshotId = searchParams.get("snapshotId") ?? "";

  const [edited, setEdited] = useState<TableSpec | null>(null);
  const [changeSetTitle, setChangeSetTitle] = useState("");
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnType, setNewColumnType] = useState("VARCHAR2(255 CHAR)");
  const [newIndexName, setNewIndexName] = useState("");
  const [newIndexCols, setNewIndexCols] = useState("");
  const [copySnapshotId, setCopySnapshotId] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);

  const tableQuery = useQuery({
    queryKey: ["table-editor", snapshotId, tableKey],
    queryFn: () => api.getSnapshotTable(snapshotId, tableKey),
    enabled: Boolean(snapshotId && tableKey),
  });

  const original = tableQuery.data?.table ?? null;

  useEffect(() => {
    if (original && !edited) {
      setEdited(clone(original));
      setChangeSetTitle(`Edit ${original.tableKey}`);
    }
  }, [original, edited]);

  const addToChangeSetMutation = useMutation({
    mutationFn: async () => {
      if (!original || !edited) throw new Error("Table not loaded");
      const steps = buildChangeSteps(original, edited);
      if (steps.length === 0) throw new Error("No changes to add");
      const created = await api.createChangeSet({
        title: changeSetTitle || `Edit ${original.tableKey}`,
        description: "Generated from table editor",
      });
      await api.addChangeSetSteps(created.changeSetId, {
        append: true,
        steps,
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
        setErrorText("Failed to add steps to changeset");
      }
    },
  });

  const copyFromSnapshotMutation = useMutation({
    mutationFn: async () => {
      const id = copySnapshotId.trim();
      if (!id) throw new Error("Source snapshotId is required");
      const source = await api.getSnapshotTable(id, tableKey);
      return source.table;
    },
    onSuccess: (sourceTable) => {
      setErrorText(null);
      setEdited((prev) =>
        prev
          ? {
              ...prev,
              columns: normalizeColumns(clone(sourceTable.columns)),
              indexes: clone(sourceTable.indexes),
            }
          : prev,
      );
    },
    onError: (error) => {
      if (error instanceof ApiClientError) {
        setErrorText(`${error.code}: ${error.message}`);
      } else if (error instanceof Error) {
        setErrorText(error.message);
      } else {
        setErrorText("Failed to copy from snapshot");
      }
    },
  });

  if (!snapshotId) {
    return <Alert severity="warning">Missing `snapshotId` query parameter.</Alert>;
  }

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">Table Editor</Typography>
        <Typography color="text.secondary">
          Table: <span className="mono">{tableKey}</span> | Snapshot: <span className="mono">{snapshotId}</span>
        </Typography>
      </Box>

      {errorText ? <Alert severity="error">{errorText}</Alert> : null}

      {tableQuery.isLoading || !edited ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={18} />
          <span>Loading table...</span>
        </Stack>
      ) : null}

      {edited ? (
        <>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6">Copy/Clone from Another Snapshot</Typography>
            <Typography color="text.secondary" variant="body2">
              Use a source snapshot (instance X) and clone columns/indexes into this editor context.
            </Typography>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} mt={1.2}>
              <TextField
                size="small"
                label="Source snapshotId"
                value={copySnapshotId}
                onChange={(event) => setCopySnapshotId(event.target.value)}
                fullWidth
              />
              <Button
                variant="outlined"
                startIcon={copyFromSnapshotMutation.isPending ? <CircularProgress size={16} /> : <AddIcon />}
                disabled={copyFromSnapshotMutation.isPending || !copySnapshotId.trim()}
                onClick={() => copyFromSnapshotMutation.mutate()}
              >
                Copy Columns + Indexes
              </Button>
            </Stack>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="h6">Columns</Typography>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} mt={1.2}>
              <TextField
                size="small"
                label="Column Name"
                value={newColumnName}
                onChange={(event) => setNewColumnName(event.target.value)}
              />
              <TextField
                size="small"
                label="Native Type"
                value={newColumnType}
                onChange={(event) => setNewColumnType(event.target.value)}
                sx={{ minWidth: 220 }}
              />
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                disabled={!newColumnName}
                onClick={() => {
                  const next: ColumnSpec = {
                    name: newColumnName.trim().toUpperCase(),
                    ordinalPosition: edited.columns.length + 1,
                    canonicalType: "STRING",
                    nativeType: newColumnType.trim(),
                    length: 255,
                    precision: null,
                    scale: null,
                    nullable: true,
                    defaultRaw: null,
                    comment: null,
                    charset: null,
                    collation: null,
                  };
                  setEdited((prev) =>
                    prev
                      ? {
                          ...prev,
                          columns: normalizeColumns([...prev.columns, next]),
                        }
                      : prev,
                  );
                  setNewColumnName("");
                }}
              >
                Add Column
              </Button>
            </Stack>

            <Table size="small" sx={{ mt: 1.2 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Pos</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Nullable</TableCell>
                  <TableCell>Default</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {edited.columns.map((column, index) => (
                  <TableRow key={column.name}>
                    <TableCell>{column.ordinalPosition}</TableCell>
                    <TableCell>{column.name}</TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={column.nativeType}
                        onChange={(event) =>
                          setEdited((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  columns: prev.columns.map((item, i) =>
                                    i === index ? { ...item, nativeType: event.target.value } : item,
                                  ),
                                }
                              : prev,
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        variant={column.nullable ? "contained" : "outlined"}
                        onClick={() =>
                          setEdited((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  columns: prev.columns.map((item, i) =>
                                    i === index ? { ...item, nullable: !item.nullable } : item,
                                  ),
                                }
                              : prev,
                          )
                        }
                      >
                        {String(column.nullable)}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={column.defaultRaw ?? ""}
                        onChange={(event) =>
                          setEdited((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  columns: prev.columns.map((item, i) =>
                                    i === index ? { ...item, defaultRaw: event.target.value || null } : item,
                                  ),
                                }
                              : prev,
                          )
                        }
                      />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        onClick={() =>
                          setEdited((prev) =>
                            prev && index > 0
                              ? {
                                  ...prev,
                                  columns: normalizeColumns(reorder(prev.columns, index, index - 1)),
                                }
                              : prev,
                          )
                        }
                      >
                        <ArrowUpwardIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() =>
                          setEdited((prev) =>
                            prev && index < prev.columns.length - 1
                              ? {
                                  ...prev,
                                  columns: normalizeColumns(reorder(prev.columns, index, index + 1)),
                                }
                              : prev,
                          )
                        }
                      >
                        <ArrowDownwardIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() =>
                          setEdited((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  columns: normalizeColumns(
                                    prev.columns.filter((_, i) => i !== index),
                                  ),
                                }
                              : prev,
                          )
                        }
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="h6">Indexes</Typography>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} mt={1.2}>
              <TextField
                size="small"
                label="Index Name"
                value={newIndexName}
                onChange={(event) => setNewIndexName(event.target.value)}
              />
              <TextField
                size="small"
                label="Columns (comma-separated)"
                value={newIndexCols}
                onChange={(event) => setNewIndexCols(event.target.value)}
                sx={{ minWidth: 260 }}
              />
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                disabled={!newIndexName || !newIndexCols}
                onClick={() => {
                  const columns = newIndexCols
                    .split(",")
                    .map((name) => name.trim().toUpperCase())
                    .filter(Boolean)
                    .map((name, idx) => ({
                      name,
                      position: idx + 1,
                      direction: "ASC" as const,
                      expression: null,
                    }));
                  const next: IndexSpec = {
                    name: newIndexName.trim().toUpperCase(),
                    unique: false,
                    indexType: "BTREE",
                    columns,
                    whereClause: null,
                    tablespace: null,
                  };
                  setEdited((prev) =>
                    prev
                      ? {
                          ...prev,
                          indexes: [...prev.indexes, next].sort((a, b) => a.name.localeCompare(b.name)),
                        }
                      : prev,
                  );
                  setNewIndexName("");
                  setNewIndexCols("");
                }}
              >
                Add Index
              </Button>
            </Stack>

            <Table size="small" sx={{ mt: 1.2 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Unique</TableCell>
                  <TableCell>Columns</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {edited.indexes.map((index, indexPos) => (
                  <TableRow key={index.name}>
                    <TableCell>{index.name}</TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        variant={index.unique ? "contained" : "outlined"}
                        onClick={() =>
                          setEdited((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  indexes: prev.indexes.map((item, i) =>
                                    i === indexPos ? { ...item, unique: !item.unique } : item,
                                  ),
                                }
                              : prev,
                          )
                        }
                      >
                        {String(index.unique)}
                      </Button>
                    </TableCell>
                    <TableCell>{index.columns.map((col) => col.name).join(", ")}</TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() =>
                          setEdited((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  indexes: prev.indexes.filter((_, i) => i !== indexPos),
                                }
                              : prev,
                          )
                        }
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }}>
              <TextField
                size="small"
                label="ChangeSet title"
                value={changeSetTitle}
                onChange={(event) => setChangeSetTitle(event.target.value)}
                sx={{ minWidth: 280 }}
              />

              <RoleGate roles={["editor", "admin"]}>
                <Button
                  variant="contained"
                  startIcon={addToChangeSetMutation.isPending ? <CircularProgress size={16} /> : <SaveIcon />}
                  disabled={addToChangeSetMutation.isPending}
                  onClick={() => addToChangeSetMutation.mutate()}
                >
                  Add to ChangeSet
                </Button>
              </RoleGate>
            </Stack>
            <Divider sx={{ my: 1.5 }} />
            <Typography color="text.secondary" variant="body2">
              Generates step actions by diffing the edited table against the snapshot baseline.
            </Typography>
          </Paper>
        </>
      ) : null}
    </Stack>
  );
};

export default function TableEditorPage() {
  return (
    <Suspense
      fallback={
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h4">Table Editor</Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={18} />
            <span>Loading table editor...</span>
          </Stack>
        </Stack>
      }
    >
      <TableEditorPageContent />
    </Suspense>
  );
}
