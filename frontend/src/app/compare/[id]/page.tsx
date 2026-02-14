"use client";

import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import AddTaskIcon from "@mui/icons-material/AddTask";
import EditNoteIcon from "@mui/icons-material/EditNote";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/api";
import type { ColumnSpec, IndexSpec, TableSpec } from "@/lib/types";
import { RoleGate } from "@/components/RoleGate";

type DetailStatus = "match" | "modified" | "missing";
type DetailFilter = "all" | "diffs" | "modified" | "missing";
type DetailTab = "columns" | "indexes";

type ColumnRow = {
  name: string;
  status: DetailStatus;
  cells: Record<string, ColumnSpec | null>;
  diff: {
    type: boolean;
    nativeType: boolean;
    nullable: boolean;
    default: boolean;
    order: boolean;
  };
};

type IndexRow = {
  key: string;
  name: string;
  status: DetailStatus;
  cells: Record<string, IndexSpec | null>;
};

const statusMeta: Record<DetailStatus, { label: string; color: string; bg: string; border: string }> = {
  match: { label: "MATCH", color: "#94a3b8", bg: "rgba(71,85,105,0.16)", border: "#334155" },
  modified: { label: "MODIFIED", color: "#fbbf24", bg: "rgba(245,158,11,0.16)", border: "#92400e" },
  missing: { label: "ABSENT", color: "#d8b4fe", bg: "rgba(192,132,252,0.16)", border: "#6b21a8" },
};

const badge = (status: DetailStatus) => (
  <Box
    sx={{
      display: "inline-block",
      px: 0.8,
      py: 0.2,
      borderRadius: 0.8,
      border: "1px solid",
      borderColor: statusMeta[status].border,
      bgcolor: statusMeta[status].bg,
      color: statusMeta[status].color,
      fontSize: 9,
      fontWeight: 800,
      letterSpacing: "0.08em",
    }}
  >
    {statusMeta[status].label}
  </Box>
);

const rowSummaryStatus = (row: {
  diffSummary: {
    columnsDifferent: number;
    indexesDifferent: number;
    missingColumns: number;
    missingIndexes: number;
  };
  cells: Record<
    string,
    {
      status: "PRESENT" | "MISSING";
      diff: "NONE" | "DIFFERENT" | "MISSING";
    }
  >;
}): DetailStatus => {
  if (Object.values(row.cells).some((cell) => cell.status === "MISSING" || cell.diff === "MISSING")) return "missing";
  const summary = row.diffSummary;
  if (summary.missingColumns > 0 || summary.missingIndexes > 0) return "missing";
  if (summary.columnsDifferent > 0 || summary.indexesDifferent > 0) return "modified";
  return "match";
};

const normalizeNative = (value: string): string => value.trim().toUpperCase();
const normalizeDefault = (value: string | null): string => (value ?? "").trim();

const equalColumnType = (
  a: ColumnSpec,
  b: ColumnSpec,
  compareNativeType: boolean,
): boolean => {
  if (a.canonicalType !== b.canonicalType) return false;
  if (a.length !== b.length) return false;
  if (a.precision !== b.precision) return false;
  if (a.scale !== b.scale) return false;
  if (compareNativeType && normalizeNative(a.nativeType) !== normalizeNative(b.nativeType)) return false;
  return true;
};

const idxSig = (index: IndexSpec): string => {
  const cols = [...index.columns]
    .sort((a, b) => a.position - b.position)
    .map((col) => `${col.name}:${col.direction}:${col.expression ?? ""}`)
    .join(",");
  return [String(index.unique), index.indexType.toUpperCase(), cols, index.whereClause ?? "", index.tablespace ?? ""].join("|");
};

const summarizeCells = <T,>(
  cells: Record<string, T | null>,
  instanceIds: string[],
  signature: (item: T) => string,
): DetailStatus => {
  const present = instanceIds.map((id) => cells[id]).filter((item): item is T => item !== null);
  if (present.length === 0) return "missing";
  if (present.length < instanceIds.length) return "missing";
  return new Set(present.map(signature)).size > 1 ? "modified" : "match";
};

const buildColumnRows = (
  perInstance: Record<string, { table: TableSpec | null }>,
  instances: Array<{ instanceId: string; dbType: "oracle" | "mariadb" }>,
  options: { anchorInstanceId: string; sortAnchorInstanceId: string; ignoreColumnOrder: boolean },
): ColumnRow[] => {
  const instanceIds = instances.map((instance) => instance.instanceId);
  const dbTypeByInstance = new Map(instances.map((instance) => [instance.instanceId, instance.dbType]));
  const allNames = new Set<string>();
  for (const instanceId of instanceIds) {
    for (const column of perInstance[instanceId]?.table?.columns ?? []) {
      allNames.add(column.name.toUpperCase());
    }
  }

  const sortAnchorColumns = perInstance[options.sortAnchorInstanceId]?.table?.columns ?? [];
  const orderedFromAnchor = sortAnchorColumns
    .slice()
    .sort((a, b) => a.ordinalPosition - b.ordinalPosition)
    .map((column) => column.name.toUpperCase())
    .filter((name) => allNames.has(name));
  const remaining = [...allNames].filter((name) => !orderedFromAnchor.includes(name)).sort();
  const orderedNames = [...orderedFromAnchor, ...remaining];

  return orderedNames.map((name) => {
    const cells: Record<string, ColumnSpec | null> = {};
    for (const instanceId of instanceIds) {
      cells[instanceId] =
        perInstance[instanceId]?.table?.columns.find((column) => column.name.toUpperCase() === name) ?? null;
    }

    const anchor = cells[options.anchorInstanceId] ?? null;
    const diff = {
      type: false,
      nativeType: false,
      nullable: false,
      default: false,
      order: false,
    };

    let status: DetailStatus = "match";
    const presentCount = instanceIds.filter((instanceId) => cells[instanceId] !== null).length;
    if (presentCount === 0 || presentCount < instanceIds.length) {
      status = "missing";
    } else if (!anchor) {
      status = "modified";
    } else {
      for (const instanceId of instanceIds) {
        const candidate = cells[instanceId];
        if (!candidate) continue;
        const compareNativeType = dbTypeByInstance.get(instanceId) === dbTypeByInstance.get(options.anchorInstanceId);
        if (!equalColumnType(anchor, candidate, compareNativeType)) diff.type = true;
        if (normalizeNative(anchor.nativeType) !== normalizeNative(candidate.nativeType)) diff.nativeType = true;
        if (anchor.nullable !== candidate.nullable) diff.nullable = true;
        if (normalizeDefault(anchor.defaultRaw) !== normalizeDefault(candidate.defaultRaw)) diff.default = true;
        if (anchor.ordinalPosition !== candidate.ordinalPosition) diff.order = true;
      }
      if (
        diff.type ||
        diff.nullable ||
        diff.default ||
        (!options.ignoreColumnOrder && diff.order)
      ) {
        status = "modified";
      }
    }

    return { name, cells, status, diff };
  });
};

const buildIndexRows = (
  perInstance: Record<string, { table: TableSpec | null }>,
  instanceIds: string[],
  sortAnchorInstanceId: string,
): IndexRow[] => {
  const cellsByKey = new Map<string, Record<string, IndexSpec | null>>();
  const namesByKey = new Map<string, Set<string>>();

  for (const instanceId of instanceIds) {
    for (const index of perInstance[instanceId]?.table?.indexes ?? []) {
      const key = idxSig(index);
      if (!cellsByKey.has(key)) {
        const cells: Record<string, IndexSpec | null> = {};
        for (const id of instanceIds) cells[id] = null;
        cellsByKey.set(key, cells);
      }
      const cells = cellsByKey.get(key)!;
      if (!cells[instanceId]) {
        cells[instanceId] = index;
      }

      const names = namesByKey.get(key) ?? new Set<string>();
      names.add(index.name.toUpperCase());
      namesByKey.set(key, names);
    }
  }

  const anchorIndexes = perInstance[sortAnchorInstanceId]?.table?.indexes ?? [];
  const orderedFromAnchor = anchorIndexes
    .map((index) => idxSig(index))
    .filter((key, idx, array) => array.indexOf(key) === idx && cellsByKey.has(key));
  const remaining = [...cellsByKey.keys()].filter((key) => !orderedFromAnchor.includes(key)).sort();
  const orderedKeys = [...orderedFromAnchor, ...remaining];

  return orderedKeys.map((key) => {
    const cells = cellsByKey.get(key)!;
    const present = instanceIds.filter((instanceId) => cells[instanceId] !== null).length;
    const status: DetailStatus = present < instanceIds.length ? "missing" : "match";

    const names = [...(namesByKey.get(key) ?? new Set<string>())].sort();
    const anchorName = cells[sortAnchorInstanceId]?.name.toUpperCase() ?? names[0] ?? "INDEX";
    const aliases = names.filter((name) => name !== anchorName);
    const label = aliases.length > 0 ? `${anchorName} (${aliases.join(", ")})` : anchorName;

    return { key, name: label, cells, status };
  });
};

const filterRows = <T extends { status: DetailStatus }>(rows: T[], filter: DetailFilter): T[] => {
  if (filter === "all") return rows;
  if (filter === "diffs") return rows.filter((row) => row.status !== "match");
  return rows.filter((row) => row.status === filter);
};

const columnTypeSuffix = (column: ColumnSpec): string => {
  if (column.precision !== null) {
    if (column.scale !== null) return `(${column.precision},${column.scale})`;
    return `(${column.precision})`;
  }
  if (column.length !== null) return `(${column.length})`;
  return "";
};

const thSx = {
  px: 1,
  py: 0.7,
  borderBottom: "1px solid #1f2937",
  textAlign: "left",
  color: "#64748b",
  fontWeight: 800,
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  whiteSpace: "nowrap",
};

const tdSx = {
  px: 1,
  py: 0.7,
  borderBottom: "1px solid #0f172a",
  color: "#94a3b8",
  verticalAlign: "top",
  fontSize: 11,
};

const legendItemSx = {
  px: 0.7,
  py: 0.2,
  border: "1px solid #334155",
  borderRadius: 0.8,
  fontSize: 10,
  lineHeight: 1.2,
};

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
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(100);
  const [expandedTableKey, setExpandedTableKey] = useState("");
  const [selectedTableKeys, setSelectedTableKeys] = useState<string[]>([]);
  const [changeSetTitle, setChangeSetTitle] = useState("Generated from compare");
  const [allowDestructive, setAllowDestructive] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("columns");
  const [detailFilter, setDetailFilter] = useState<DetailFilter>("all");
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    setOffset(0);
  }, [search, onlyDifferences, limit]);

  const matrixQuery = useQuery({
    queryKey: ["compare-matrix", compareRunId, onlyDifferences, search, offset, limit],
    queryFn: () =>
      api.getCompareMatrix(compareRunId, {
        level: "table",
        onlyDifferences,
        search: search || undefined,
        offset,
        limit,
      }),
    placeholderData: (old) => old,
  });

  const detailsQuery = useQuery({
    queryKey: ["compare-details", compareRunId, expandedTableKey],
    queryFn: () => api.getCompareDetails(compareRunId, expandedTableKey),
    enabled: Boolean(expandedTableKey),
  });

  const instances = matrixQuery.data?.instances ?? [];
  const rows = matrixQuery.data?.items ?? [];
  const total = matrixQuery.data?.total ?? 0;
  const compareOptions = matrixQuery.data?.options ?? {
    matchIndexByDefinition: true,
    ignoreIndexName: true,
    ignoreColumnOrder: false,
  };
  const baselineInstanceId = baselineInstanceIdFromQuery || instances[0]?.instanceId || "";
  const targetInstanceIds = instances.map((instance) => instance.instanceId).filter((id) => id !== baselineInstanceId);

  const detailsRows = useMemo(() => {
    if (!detailsQuery.data) return { columns: [] as ColumnRow[], indexes: [] as IndexRow[] };
    const instanceIds = instances.map((instance) => instance.instanceId);
    const anchorInstanceId = baselineInstanceId || instances[0]?.instanceId || "";
    const sortAnchorInstanceId = instances[0]?.instanceId || anchorInstanceId;
    return {
      columns: buildColumnRows(
        detailsQuery.data.perInstance,
        instances.map((instance) => ({ instanceId: instance.instanceId, dbType: instance.dbType })),
        {
          anchorInstanceId,
          sortAnchorInstanceId,
          ignoreColumnOrder: compareOptions.ignoreColumnOrder,
        },
      ),
      indexes: buildIndexRows(detailsQuery.data.perInstance, instanceIds, sortAnchorInstanceId),
    };
  }, [baselineInstanceId, compareOptions.ignoreColumnOrder, detailsQuery.data, instances]);

  const visibleColumns = useMemo(() => filterRows(detailsRows.columns, detailFilter), [detailsRows.columns, detailFilter]);
  const visibleIndexes = useMemo(() => filterRows(detailsRows.indexes, detailFilter), [detailsRows.indexes, detailFilter]);
  const baselineExpandedTableKey = useMemo(() => {
    if (!expandedTableKey || !baselineInstanceId) return "";
    if (!detailsQuery.data || detailsQuery.data.tableKey !== expandedTableKey) return "";
    return detailsQuery.data.perInstance[baselineInstanceId]?.table?.tableKey ?? "";
  }, [expandedTableKey, baselineInstanceId, detailsQuery.data]);

  const toggleSelected = (tableKey: string, checked: boolean) => {
    setSelectedTableKeys((prev) => (checked ? [...new Set([...prev, tableKey])] : prev.filter((item) => item !== tableKey)));
  };

  const createChangeSetMutation = useMutation({
    mutationFn: async () => {
      setErrorText(null);
      if (selectedTableKeys.length === 0) throw new Error("Select at least one table");
      if (!baselineInstanceId) throw new Error("Missing baseline instance");
      if (targetInstanceIds.length === 0) throw new Error("No target instances available");

      const created = await api.createChangeSet({
        title: changeSetTitle,
        description: `Auto-generated from compare run ${compareRunId}`,
        sourceCompareRunId: compareRunId,
      });
      await api.planFromCompare(created.changeSetId, {
        compareRunId,
        tableKeys: selectedTableKeys,
        targets: { baselineInstanceId, targetInstanceIds },
        include: { tables: true, columns: true, indexes: true },
        strategy: { alignToBaseline: true, allowDestructive },
      });
      return created.changeSetId;
    },
    onSuccess: (changeSetId) => {
      router.push(`/changesets/${encodeURIComponent(changeSetId)}`);
    },
    onError: (error) => {
      if (error instanceof ApiClientError) setErrorText(`${error.code}: ${error.message}`);
      else if (error instanceof Error) setErrorText(error.message);
      else setErrorText("Failed to create changeset");
    },
  });

  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 1.5, border: "1px solid #1f2937", bgcolor: "#070d18", color: "#cbd5e1" }}>
        <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ fontWeight: 800 }}>Compare Run {compareRunId.slice(0, 8)}</Typography>
            <Chip size="small" label={`rows ${rows.length}`} sx={{ bgcolor: "#111827", color: "#9ca3af" }} />
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              size="small"
              placeholder="Filter table..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              sx={{ minWidth: 180, "& .MuiOutlinedInput-root": { bgcolor: "#0b1220", color: "#cbd5e1" } }}
            />
            <FormControlLabel
              sx={{ m: 0 }}
              control={<Switch checked={onlyDifferences} onChange={(event) => setOnlyDifferences(event.target.checked)} />}
              label={<Typography sx={{ fontSize: 12, color: "#94a3b8" }}>Only differences</Typography>}
            />
          </Stack>
        </Stack>
      </Paper>

      {errorText ? <Alert severity="error">{errorText}</Alert> : null}

      <Paper sx={{ p: 1.2, border: "1px solid #1f2937", bgcolor: "#060a12", color: "#cbd5e1", overflow: "auto" }}>
        <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1} sx={{ pb: 1 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
            <TextField
              size="small"
              label="ChangeSet title"
              value={changeSetTitle}
              onChange={(event) => setChangeSetTitle(event.target.value)}
              sx={{ minWidth: 250, "& .MuiOutlinedInput-root": { bgcolor: "#0b1220", color: "#cbd5e1" } }}
            />
            <FormControlLabel
              sx={{ m: 0 }}
              control={<Switch checked={allowDestructive} onChange={(event) => setAllowDestructive(event.target.checked)} />}
              label={<Typography sx={{ fontSize: 12, color: "#fca5a5" }}>Allow destructive</Typography>}
            />
            <RoleGate roles={["editor", "admin"]}>
              <Button
                variant="contained"
                color="warning"
                startIcon={createChangeSetMutation.isPending ? <CircularProgress size={15} /> : <AddTaskIcon />}
                disabled={createChangeSetMutation.isPending || selectedTableKeys.length === 0}
                onClick={() => createChangeSetMutation.mutate()}
              >
                Create ChangeSet ({selectedTableKeys.length})
              </Button>
            </RoleGate>
            {baselineExpandedTableKey && baselineSnapshotId ? (
              <Button
                variant="outlined"
                startIcon={<EditNoteIcon />}
                component={Link}
                href={`/tables/${encodeURIComponent(baselineExpandedTableKey)}?snapshotId=${encodeURIComponent(baselineSnapshotId)}`}
              >
                Open Table Editor
              </Button>
            ) : null}
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button size="small" variant="outlined" disabled={!canPrev} onClick={() => setOffset((v) => Math.max(0, v - limit))}>Prev</Button>
            <Typography sx={{ fontSize: 11, color: "#94a3b8" }}>{Math.min(offset + 1, total)}-{Math.min(offset + rows.length, total)} / {total}</Typography>
            <Button size="small" variant="outlined" disabled={!canNext} onClick={() => setOffset((v) => v + limit)}>Next</Button>
          </Stack>
        </Stack>

        <Box sx={{ overflowX: "auto" }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
            <Box component="thead">
              <Box component="tr" sx={{ bgcolor: "#0a101b" }}>
                <Box component="th" sx={thSx} />
                <Box component="th" sx={thSx}>Table</Box>
                <Box component="th" sx={thSx}>Col Diff</Box>
                <Box component="th" sx={thSx}>Idx Diff</Box>
                <Box component="th" sx={thSx}>Missing Col</Box>
                <Box component="th" sx={thSx}>Missing Idx</Box>
                {instances.map((instance) => (
                  <Box key={instance.instanceId} component="th" sx={thSx}>
                    <Box sx={{ color: instance.instanceId === baselineInstanceId ? "#60a5fa" : "#a5b4fc" }}>{instance.name}</Box>
                  </Box>
                ))}
                <Box component="th" sx={thSx}>Status</Box>
              </Box>
            </Box>
            <Box component="tbody">
              {matrixQuery.isLoading ? (
                <Box component="tr"><Box component="td" colSpan={7 + instances.length} sx={{ ...tdSx, textAlign: "center" }}><CircularProgress size={16} /></Box></Box>
              ) : null}
              {rows.map((row) => {
                const expanded = expandedTableKey === row.objectKey;
                return (
                  <Fragment key={row.objectKey}>
                    <Box
                      component="tr"
                      sx={{ bgcolor: expanded ? "#0b1321" : "transparent", "&:hover": { bgcolor: "#0b1321" }, cursor: "pointer" }}
                      onClick={() => setExpandedTableKey((current) => (current === row.objectKey ? "" : row.objectKey))}
                    >
                      <Box component="td" sx={tdSx}>
                        <input
                          type="checkbox"
                          checked={selectedTableKeys.includes(row.objectKey)}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => toggleSelected(row.objectKey, event.target.checked)}
                        />
                      </Box>
                      <Box component="td" sx={{ ...tdSx, fontWeight: 700, color: "#e2e8f0" }}>
                        <Stack direction="row" spacing={0.3} alignItems="center">
                          <ChevronRightIcon sx={{ fontSize: 14, color: "#64748b", transform: expanded ? "rotate(90deg)" : "none" }} />
                          <span>{row.displayName}</span>
                        </Stack>
                      </Box>
                      <Box component="td" sx={tdSx}>{row.diffSummary.columnsDifferent ?? 0}</Box>
                      <Box component="td" sx={tdSx}>{row.diffSummary.indexesDifferent ?? 0}</Box>
                      <Box component="td" sx={tdSx}>{row.diffSummary.missingColumns ?? 0}</Box>
                      <Box component="td" sx={tdSx}>{row.diffSummary.missingIndexes ?? 0}</Box>
                      {instances.map((instance) => {
                        const cell = row.cells[instance.instanceId];
                        const text = !cell || cell.status === "MISSING" ? "ABSENT" : cell.diff === "DIFFERENT" ? "DIFF" : "MATCH";
                        return <Box key={instance.instanceId} component="td" sx={tdSx}>{text}</Box>;
                      })}
                      <Box component="td" sx={{ ...tdSx, textAlign: "center" }}>{badge(rowSummaryStatus(row))}</Box>
                    </Box>
                    {expanded ? (
                      <Box component="tr">
                        <Box component="td" colSpan={7 + instances.length} sx={{ p: 0, borderBottom: "1px solid #0f172a" }}>
                          <Box sx={{ borderTop: "1px solid #1e3a8a", borderBottom: "1px solid #1e3a8a", bgcolor: "#070d18", p: 1.2 }}>
                            {detailsQuery.data && detailsQuery.data.tableKey === row.objectKey ? (
                              <Box
                                sx={{
                                  mb: 1.2,
                                  border: "1px solid #1f2937",
                                  borderRadius: 1,
                                  overflow: "hidden",
                                }}
                              >
                                <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
                                  <Box component="thead">
                                    <Box component="tr" sx={{ bgcolor: "#0a101b" }}>
                                      <Box component="th" sx={thSx}>Environment</Box>
                                      <Box component="th" sx={thSx}>Schema</Box>
                                      <Box component="th" sx={thSx}>Table Type</Box>
                                      <Box component="th" sx={thSx}>Status</Box>
                                    </Box>
                                  </Box>
                                  <Box component="tbody">
                                    {instances.map((instance) => {
                                      const table = detailsQuery.data?.perInstance[instance.instanceId]?.table ?? null;
                                      const cell = row.cells[instance.instanceId];
                                      const status: DetailStatus =
                                        !table || !cell || cell.status === "MISSING"
                                          ? "missing"
                                          : cell.diff === "DIFFERENT"
                                            ? "modified"
                                            : "match";
                                      const tableType = !table ? "ABSENT" : table.isView ? "VIEW" : "TABLE";

                                      return (
                                        <Box key={instance.instanceId} component="tr" sx={{ bgcolor: statusMeta[status].bg }}>
                                          <Box component="td" sx={{ ...tdSx, fontWeight: 700, color: "#e2e8f0" }}>
                                            {instance.name}
                                          </Box>
                                          <Box component="td" className="mono" sx={tdSx}>
                                            {table?.schema ?? "-"}
                                          </Box>
                                          <Box component="td" sx={tdSx}>
                                            {tableType}
                                          </Box>
                                          <Box component="td" sx={{ ...tdSx, textAlign: "center" }}>
                                            {badge(status)}
                                          </Box>
                                        </Box>
                                      );
                                    })}
                                  </Box>
                                </Box>
                              </Box>
                            ) : null}
                            <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                              <Button size="small" variant={detailTab === "columns" ? "contained" : "outlined"} onClick={() => setDetailTab("columns")}>Columns</Button>
                              <Button size="small" variant={detailTab === "indexes" ? "contained" : "outlined"} onClick={() => setDetailTab("indexes")}>Indexes</Button>
                              {(["all", "diffs", "modified", "missing"] as DetailFilter[]).map((mode) => (
                                <Button key={mode} size="small" variant={detailFilter === mode ? "contained" : "outlined"} onClick={() => setDetailFilter(mode)}>
                                  {mode}
                                </Button>
                              ))}
                            </Stack>
                            {detailTab === "columns" ? (
                              <Stack
                                direction={{ xs: "column", md: "row" }}
                                spacing={0.7}
                                sx={{ mb: 1, p: 0.8, border: "1px solid #1f2937", borderRadius: 1, bgcolor: "#0a101b" }}
                              >
                                <Typography sx={{ ...legendItemSx, color: "#fbbf24" }}>yellow: semantic type/nullable/default/order diff</Typography>
                                <Typography className="mono" sx={{ ...legendItemSx, color: "#c084fc" }}>purple: native type text differs</Typography>
                                <Typography sx={{ ...legendItemSx, color: "#94a3b8" }}>cross-DB compare uses canonical type + size/precision</Typography>
                                <Typography sx={{ ...legendItemSx, color: "#64748b" }}>column order ignored if option is enabled</Typography>
                              </Stack>
                            ) : null}
                            {detailsQuery.isLoading ? <CircularProgress size={16} /> : null}
                            {detailsQuery.error ? <Alert severity="error">Failed to load details</Alert> : null}
                            {detailsQuery.data && detailsQuery.data.tableKey === row.objectKey ? (
                              <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
                                <Box component="thead">
                                  <Box component="tr" sx={{ bgcolor: "#0a101b" }}>
                                    <Box component="th" sx={thSx}>{detailTab === "columns" ? "Column" : "Index"}</Box>
                                    {instances.map((instance) => (
                                      <Box key={instance.instanceId} component="th" sx={thSx}>{instance.name}</Box>
                                    ))}
                                    <Box component="th" sx={thSx}>Status</Box>
                                  </Box>
                                </Box>
                                <Box component="tbody">
                                    {detailTab === "columns"
                                      ? visibleColumns.map((item) => (
                                        <Box key={item.name} component="tr" sx={{ bgcolor: statusMeta[item.status].bg }}>
                                          <Box component="td" sx={{ ...tdSx, fontWeight: 700 }}>{item.name}</Box>
                                          {instances.map((instance) => {
                                            const col = item.cells[instance.instanceId];
                                            return (
                                              <Box key={instance.instanceId} component="td" sx={tdSx}>
                                                {!col ? (
                                                  "absent"
                                                ) : (
                                                  <Stack spacing={0.2}>
                                                    <Typography
                                                      sx={{
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                        color: item.diff.type ? "#fbbf24" : "#e2e8f0",
                                                      }}
                                                    >
                                                      {col.canonicalType}
                                                      {columnTypeSuffix(col)}
                                                    </Typography>
                                                    <Typography
                                                      className="mono"
                                                      sx={{ fontSize: 10, color: item.diff.nativeType ? "#c084fc" : "#64748b" }}
                                                    >
                                                      {col.nativeType}
                                                    </Typography>
                                                    <Typography sx={{ fontSize: 10, color: item.diff.nullable ? "#fbbf24" : "#94a3b8" }}>
                                                      {col.nullable ? "NULL" : "NOT NULL"}
                                                    </Typography>
                                                    <Typography className="mono" sx={{ fontSize: 10, color: item.diff.default ? "#fbbf24" : "#64748b" }}>
                                                      default: {col.defaultRaw ?? "-"}
                                                    </Typography>
                                                    <Typography sx={{ fontSize: 10, color: item.diff.order ? "#fbbf24" : "#64748b" }}>
                                                      ord: {col.ordinalPosition}
                                                      {compareOptions.ignoreColumnOrder ? " (ignored)" : ""}
                                                    </Typography>
                                                  </Stack>
                                                )}
                                              </Box>
                                            );
                                          })}
                                          <Box component="td" sx={{ ...tdSx, textAlign: "center" }}>{badge(item.status)}</Box>
                                        </Box>
                                      ))
                                      : visibleIndexes.map((item) => (
                                        <Box key={item.key} component="tr" sx={{ bgcolor: statusMeta[item.status].bg }}>
                                          <Box component="td" sx={{ ...tdSx, fontWeight: 700 }}>{item.name}</Box>
                                          {instances.map((instance) => {
                                            const idx = item.cells[instance.instanceId];
                                            return (
                                              <Box key={instance.instanceId} component="td" sx={tdSx}>
                                                {!idx ? "absent" : `${idx.name} | ${idx.unique ? "UNIQUE" : "NONUNIQUE"} ${idx.indexType} (${idx.columns.map((c) => c.name).join(",")})`}
                                              </Box>
                                            );
                                          })}
                                          <Box component="td" sx={{ ...tdSx, textAlign: "center" }}>{badge(item.status)}</Box>
                                        </Box>
                                      ))}
                                </Box>
                              </Box>
                            ) : null}
                          </Box>
                        </Box>
                      </Box>
                    ) : null}
                  </Fragment>
                );
              })}
              {!matrixQuery.isLoading && rows.length === 0 ? (
                <Box component="tr"><Box component="td" colSpan={7 + instances.length} sx={{ ...tdSx, textAlign: "center", py: 3, color: "#64748b" }}>No tables found.</Box></Box>
              ) : null}
            </Box>
          </Box>
        </Box>
      </Paper>
    </Stack>
  );
};

export default function CompareRunPage() {
  return (
    <Suspense
      fallback={
        <Stack spacing={2.5}>
          <Box><Typography variant="h4">Compare Run</Typography></Box>
          <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><span>Loading compare run...</span></Stack>
        </Stack>
      }
    >
      <CompareRunPageContent />
    </Suspense>
  );
}
