"use client";

import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import AddTaskIcon from "@mui/icons-material/AddTask";
import EditNoteIcon from "@mui/icons-material/EditNote";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
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

/* ── helpers (unchanged logic) ── */

const rowSummaryStatus = (row: {
  diffSummary: {
    columnsDifferent: number;
    indexesDifferent: number;
    missingColumns: number;
    missingIndexes: number;
  };
  cells: Record<string, { status: "PRESENT" | "MISSING"; diff: "NONE" | "DIFFERENT" | "MISSING" }>;
}): DetailStatus => {
  if (Object.values(row.cells).some((cell) => cell.status === "MISSING" || cell.diff === "MISSING")) return "missing";
  const summary = row.diffSummary;
  if (summary.missingColumns > 0 || summary.missingIndexes > 0) return "missing";
  if (summary.columnsDifferent > 0 || summary.indexesDifferent > 0) return "modified";
  return "match";
};

const normalizeNative = (value: string): string => value.trim().toUpperCase();
const normalizeDefault = (value: string | null): string => (value ?? "").trim();

const equalColumnType = (a: ColumnSpec, b: ColumnSpec, compareNativeType: boolean): boolean => {
  if (a.canonicalType !== b.canonicalType) return false;
  if (a.length !== b.length) return false;
  if (a.precision !== b.precision) return false;
  if (a.scale !== b.scale) return false;
  if (compareNativeType && normalizeNative(a.nativeType) !== normalizeNative(b.nativeType)) return false;
  return true;
};

const normalizeIndexType = (value: string): string => {
  const upper = value.trim().toUpperCase();
  if (upper === "NORMAL" || upper === "BTREE") return "BTREE";
  return upper;
};

const normalizeWhereClause = (value: string | null): string =>
  (value ?? "").replace(/\s+/g, " ").trim().toUpperCase();

const idxSig = (index: IndexSpec): string => {
  const cols = [...index.columns]
    .sort((a, b) => a.position - b.position)
    .map((col) => `${col.name}:${col.direction}:${col.expression ?? ""}`)
    .join(",");
  return [String(index.unique), normalizeIndexType(index.indexType), cols, normalizeWhereClause(index.whereClause)].join("|");
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
    const diff = { type: false, nativeType: false, nullable: false, default: false, order: false };

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
      if (diff.type || diff.nullable || diff.default || (!options.ignoreColumnOrder && diff.order)) {
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
      if (!cells[instanceId]) cells[instanceId] = index;

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

/* ── Main component ── */

const CompareRunPageContent = () => {
  const theme = useTheme();
  const cmp = theme.compare;
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
        { anchorInstanceId, sortAnchorInstanceId, ignoreColumnOrder: compareOptions.ignoreColumnOrder },
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

  /* ── Themed sx factories ── */
  const statusMeta: Record<DetailStatus, { label: string; color: string; bg: string; border: string }> = {
    match: { label: "MATCH", ...cmp.statusMatch },
    modified: { label: "MODIFIED", ...cmp.statusModified },
    missing: { label: "ABSENT", ...cmp.statusMissing },
  };

  const badge = (status: DetailStatus) => (
    <Chip
      size="small"
      label={statusMeta[status].label}
      sx={{
        height: 20,
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.06em",
        color: statusMeta[status].color,
        bgcolor: statusMeta[status].bg,
        border: `1px solid ${statusMeta[status].border}`,
        borderRadius: 1,
      }}
    />
  );

  const thSx = {
    px: 1.2,
    py: 0.8,
    borderBottom: `1px solid ${cmp.tableBorder}`,
    textAlign: "left" as const,
    color: cmp.tableHeaderColor,
    fontWeight: 800,
    fontSize: 10,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    whiteSpace: "nowrap" as const,
  };

  const tdSx = {
    px: 1.2,
    py: 0.8,
    borderBottom: `1px solid ${cmp.tableBorder}`,
    color: cmp.tableCellColor,
    verticalAlign: "top" as const,
    fontSize: 12,
  };

  return (
    <Stack spacing={2}>
      {/* ── Header bar ── */}
      <Paper sx={{ p: 1.5 }}>
        <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ fontWeight: 800 }}>Compare Run</Typography>
            <Chip size="small" label={compareRunId.slice(0, 8)} variant="outlined" sx={{ fontSize: 11 }} />
            <Chip size="small" label={`${total} tables`} color="primary" variant="outlined" sx={{ fontSize: 11 }} />
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              size="small"
              placeholder="Filter tables..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              sx={{ minWidth: 180, "& .MuiOutlinedInput-root": { bgcolor: cmp.inputBg } }}
            />
            <FormControlLabel
              sx={{ m: 0 }}
              control={<Switch size="small" checked={onlyDifferences} onChange={(event) => setOnlyDifferences(event.target.checked)} />}
              label={<Typography sx={{ fontSize: 12, color: "text.secondary" }}>Only diffs</Typography>}
            />
          </Stack>
        </Stack>
      </Paper>

      {errorText ? <Alert severity="error">{errorText}</Alert> : null}

      {/* ── Actions + Pagination bar ── */}
      <Paper sx={{ p: 1.2 }}>
        <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
            <TextField
              size="small"
              label="ChangeSet title"
              value={changeSetTitle}
              onChange={(event) => setChangeSetTitle(event.target.value)}
              sx={{ minWidth: 250, "& .MuiOutlinedInput-root": { bgcolor: cmp.inputBg } }}
            />
            <FormControlLabel
              sx={{ m: 0 }}
              control={<Switch size="small" checked={allowDestructive} onChange={(event) => setAllowDestructive(event.target.checked)} />}
              label={<Typography sx={{ fontSize: 12, color: "error.main" }}>Destructive</Typography>}
            />
            <RoleGate roles={["editor", "admin"]}>
              <Button
                variant="contained"
                color="warning"
                size="small"
                startIcon={createChangeSetMutation.isPending ? <CircularProgress size={14} /> : <AddTaskIcon />}
                disabled={createChangeSetMutation.isPending || selectedTableKeys.length === 0}
                onClick={() => createChangeSetMutation.mutate()}
              >
                Create ChangeSet ({selectedTableKeys.length})
              </Button>
            </RoleGate>
            {baselineExpandedTableKey && baselineSnapshotId ? (
              <Button
                variant="outlined"
                size="small"
                startIcon={<EditNoteIcon />}
                component={Link}
                href={`/tables/${encodeURIComponent(baselineExpandedTableKey)}?snapshotId=${encodeURIComponent(baselineSnapshotId)}`}
              >
                Table Editor
              </Button>
            ) : null}
          </Stack>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Tooltip title="Previous page">
              <span>
                <IconButton size="small" disabled={!canPrev} onClick={() => setOffset((v) => Math.max(0, v - limit))}>
                  <NavigateBeforeIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Typography sx={{ fontSize: 11, color: "text.secondary", minWidth: 80, textAlign: "center" }}>
              {Math.min(offset + 1, total)}–{Math.min(offset + rows.length, total)} / {total}
            </Typography>
            <Tooltip title="Next page">
              <span>
                <IconButton size="small" disabled={!canNext} onClick={() => setOffset((v) => v + limit)}>
                  <NavigateNextIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
      </Paper>

      {/* ── Matrix table ── */}
      <Paper sx={{ overflow: "hidden" }}>
        <Box sx={{ overflowX: "auto" }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
            <Box component="thead">
              <Box component="tr" sx={{ bgcolor: cmp.tableHeaderBg }}>
                <Box component="th" sx={{ ...thSx, width: 36 }} />
                <Box component="th" sx={thSx}>Table</Box>
                <Box component="th" sx={thSx}>Col Diff</Box>
                <Box component="th" sx={thSx}>Idx Diff</Box>
                <Box component="th" sx={thSx}>Missing Col</Box>
                <Box component="th" sx={thSx}>Missing Idx</Box>
                {instances.map((instance) => (
                  <Box key={instance.instanceId} component="th" sx={thSx}>
                    <Typography sx={{ fontSize: 11, fontWeight: 700, color: instance.instanceId === baselineInstanceId ? cmp.baselineAccent : cmp.targetAccent }}>
                      {instance.name}
                    </Typography>
                  </Box>
                ))}
                <Box component="th" sx={thSx}>Status</Box>
              </Box>
            </Box>
            <Box component="tbody">
              {matrixQuery.isLoading ? (
                <Box component="tr">
                  <Box component="td" colSpan={7 + instances.length} sx={{ ...tdSx, textAlign: "center", py: 3 }}>
                    <CircularProgress size={20} />
                  </Box>
                </Box>
              ) : null}
              {rows.map((row) => {
                const expanded = expandedTableKey === row.objectKey;
                const summaryStatus = rowSummaryStatus(row);
                return (
                  <Fragment key={row.objectKey}>
                    <Box
                      component="tr"
                      sx={{
                        bgcolor: expanded ? cmp.tableExpandedBg : "transparent",
                        "&:hover": { bgcolor: cmp.tableHoverBg },
                        cursor: "pointer",
                        transition: "background 0.12s",
                      }}
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
                      <Box component="td" sx={{ ...tdSx, fontWeight: 700, color: "text.primary" }}>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <ChevronRightIcon
                            sx={{
                              fontSize: 16,
                              color: "text.secondary",
                              transform: expanded ? "rotate(90deg)" : "none",
                              transition: "transform 0.2s",
                            }}
                          />
                          <span>{row.displayName}</span>
                        </Stack>
                      </Box>
                      <Box component="td" sx={{ ...tdSx, fontVariantNumeric: "tabular-nums" }}>{row.diffSummary.columnsDifferent ?? 0}</Box>
                      <Box component="td" sx={{ ...tdSx, fontVariantNumeric: "tabular-nums" }}>{row.diffSummary.indexesDifferent ?? 0}</Box>
                      <Box component="td" sx={{ ...tdSx, fontVariantNumeric: "tabular-nums" }}>{row.diffSummary.missingColumns ?? 0}</Box>
                      <Box component="td" sx={{ ...tdSx, fontVariantNumeric: "tabular-nums" }}>{row.diffSummary.missingIndexes ?? 0}</Box>
                      {instances.map((instance) => {
                        const cell = row.cells[instance.instanceId];
                        const text = !cell || cell.status === "MISSING" ? "ABSENT" : cell.diff === "DIFFERENT" ? "DIFF" : "MATCH";
                        const color =
                          text === "ABSENT"
                            ? cmp.statusMissing.color
                            : text === "DIFF"
                              ? cmp.statusModified.color
                              : cmp.statusMatch.color;
                        return (
                          <Box key={instance.instanceId} component="td" sx={{ ...tdSx, color, fontWeight: 600, fontSize: 11 }}>
                            {text}
                          </Box>
                        );
                      })}
                      <Box component="td" sx={{ ...tdSx, textAlign: "center" }}>{badge(summaryStatus)}</Box>
                    </Box>

                    {/* ── Expanded detail panel ── */}
                    {expanded ? (
                      <Box component="tr">
                        <Box component="td" colSpan={7 + instances.length} sx={{ p: 0, borderBottom: `1px solid ${cmp.tableBorder}` }}>
                          <Box
                            sx={{
                              borderLeft: `3px solid ${cmp.baselineAccent}`,
                              bgcolor: cmp.tableExpandedBg,
                              p: 1.5,
                              transition: "all 0.2s",
                            }}
                          >
                            {/* Instance overview mini-table */}
                            {detailsQuery.data && detailsQuery.data.tableKey === row.objectKey ? (
                              <Box sx={{ mb: 1.5, border: `1px solid ${cmp.tableBorder}`, borderRadius: 1, overflow: "hidden" }}>
                                <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
                                  <Box component="thead">
                                    <Box component="tr" sx={{ bgcolor: cmp.tableHeaderBg }}>
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
                                          <Box component="td" sx={{ ...tdSx, fontWeight: 700, color: "text.primary" }}>
                                            {instance.name}
                                          </Box>
                                          <Box component="td" className="mono" sx={tdSx}>
                                            {table?.schema ?? "-"}
                                          </Box>
                                          <Box component="td" sx={tdSx}>{tableType}</Box>
                                          <Box component="td" sx={{ ...tdSx, textAlign: "center" }}>{badge(status)}</Box>
                                        </Box>
                                      );
                                    })}
                                  </Box>
                                </Box>
                              </Box>
                            ) : null}

                            {/* Tab + Filter controls */}
                            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} sx={{ mb: 1.2 }}>
                              <ToggleButtonGroup
                                size="small"
                                exclusive
                                value={detailTab}
                                onChange={(_, v) => { if (v) setDetailTab(v); }}
                              >
                                <ToggleButton value="columns" sx={{ fontSize: 12, px: 1.5 }}>Columns</ToggleButton>
                                <ToggleButton value="indexes" sx={{ fontSize: 12, px: 1.5 }}>Indexes</ToggleButton>
                              </ToggleButtonGroup>

                              <ToggleButtonGroup
                                size="small"
                                exclusive
                                value={detailFilter}
                                onChange={(_, v) => { if (v) setDetailFilter(v); }}
                              >
                                {(["all", "diffs", "modified", "missing"] as DetailFilter[]).map((mode) => (
                                  <ToggleButton key={mode} value={mode} sx={{ fontSize: 11, px: 1.2, textTransform: "capitalize" }}>
                                    {mode}
                                  </ToggleButton>
                                ))}
                              </ToggleButtonGroup>
                            </Stack>

                            {/* Legend (columns tab only) */}
                            {detailTab === "columns" ? (
                              <Stack
                                direction={{ xs: "column", md: "row" }}
                                spacing={0.8}
                                sx={{
                                  mb: 1.2,
                                  p: 0.8,
                                  border: `1px solid ${cmp.tableBorder}`,
                                  borderRadius: 1,
                                  bgcolor: cmp.tableHeaderBg,
                                }}
                              >
                                <Typography sx={{ px: 0.7, py: 0.2, fontSize: 10, color: cmp.diffSemantic, border: `1px solid ${cmp.tableBorder}`, borderRadius: 0.8 }}>
                                  yellow: semantic diff (type / nullable / default / order)
                                </Typography>
                                <Typography className="mono" sx={{ px: 0.7, py: 0.2, fontSize: 10, color: cmp.diffNative, border: `1px solid ${cmp.tableBorder}`, borderRadius: 0.8 }}>
                                  purple: native type text differs
                                </Typography>
                                <Typography sx={{ px: 0.7, py: 0.2, fontSize: 10, color: cmp.diffMuted, border: `1px solid ${cmp.tableBorder}`, borderRadius: 0.8 }}>
                                  cross-DB compare uses canonical type + size/precision
                                </Typography>
                              </Stack>
                            ) : null}

                            {detailsQuery.isLoading ? <CircularProgress size={18} /> : null}
                            {detailsQuery.error ? <Alert severity="error">Failed to load details</Alert> : null}

                            {/* Detail data table */}
                            {detailsQuery.data && detailsQuery.data.tableKey === row.objectKey ? (
                              <Box sx={{ border: `1px solid ${cmp.tableBorder}`, borderRadius: 1, overflow: "hidden" }}>
                                <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
                                  <Box component="thead">
                                    <Box component="tr" sx={{ bgcolor: cmp.tableHeaderBg }}>
                                      <Box component="th" sx={thSx}>{detailTab === "columns" ? "Column" : "Index"}</Box>
                                      {instances.map((instance) => (
                                        <Box key={instance.instanceId} component="th" sx={thSx}>
                                          <Typography sx={{ fontSize: 10, fontWeight: 700, color: instance.instanceId === baselineInstanceId ? cmp.baselineAccent : cmp.targetAccent }}>
                                            {instance.name}
                                          </Typography>
                                        </Box>
                                      ))}
                                      <Box component="th" sx={thSx}>Status</Box>
                                    </Box>
                                  </Box>
                                  <Box component="tbody">
                                    {detailTab === "columns"
                                      ? visibleColumns.map((item) => (
                                          <Box key={item.name} component="tr" sx={{ bgcolor: statusMeta[item.status].bg, "&:hover": { bgcolor: cmp.tableHoverBg }, transition: "background 0.12s" }}>
                                            <Box component="td" sx={{ ...tdSx, fontWeight: 700 }}>{item.name}</Box>
                                            {instances.map((instance) => {
                                              const col = item.cells[instance.instanceId];
                                              return (
                                                <Box key={instance.instanceId} component="td" sx={tdSx}>
                                                  {!col ? (
                                                    <Typography sx={{ fontSize: 11, fontStyle: "italic", color: "text.secondary" }}>absent</Typography>
                                                  ) : (
                                                    <Stack spacing={0.3}>
                                                      <Typography sx={{ fontSize: 11, fontWeight: 700, color: item.diff.type ? cmp.diffSemantic : "text.primary" }}>
                                                        {col.canonicalType}{columnTypeSuffix(col)}
                                                      </Typography>
                                                      <Typography className="mono" sx={{ fontSize: 10, color: item.diff.nativeType ? cmp.diffNative : cmp.diffMuted }}>
                                                        {col.nativeType}
                                                      </Typography>
                                                      <Typography sx={{ fontSize: 10, color: item.diff.nullable ? cmp.diffSemantic : "text.secondary" }}>
                                                        {col.nullable ? "NULL" : "NOT NULL"}
                                                      </Typography>
                                                      <Typography className="mono" sx={{ fontSize: 10, color: item.diff.default ? cmp.diffSemantic : cmp.diffMuted }}>
                                                        default: {col.defaultRaw ?? "-"}
                                                      </Typography>
                                                      <Typography sx={{ fontSize: 10, color: item.diff.order ? cmp.diffSemantic : cmp.diffMuted }}>
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
                                          <Box key={item.key} component="tr" sx={{ bgcolor: statusMeta[item.status].bg, "&:hover": { bgcolor: cmp.tableHoverBg }, transition: "background 0.12s" }}>
                                            <Box component="td" sx={{ ...tdSx, fontWeight: 700 }}>{item.name}</Box>
                                            {instances.map((instance) => {
                                              const idx = item.cells[instance.instanceId];
                                              return (
                                                <Box key={instance.instanceId} component="td" sx={tdSx}>
                                                  {!idx ? (
                                                    <Typography sx={{ fontSize: 11, fontStyle: "italic", color: "text.secondary" }}>absent</Typography>
                                                  ) : (
                                                    <Stack spacing={0.2}>
                                                      <Typography sx={{ fontSize: 11, fontWeight: 600 }}>{idx.name}</Typography>
                                                      <Typography sx={{ fontSize: 10, color: "text.secondary" }}>
                                                        {idx.unique ? "UNIQUE" : "NONUNIQUE"} {idx.indexType}
                                                      </Typography>
                                                      <Typography className="mono" sx={{ fontSize: 10, color: cmp.diffMuted }}>
                                                        ({idx.columns.map((c) => c.name).join(", ")})
                                                      </Typography>
                                                    </Stack>
                                                  )}
                                                </Box>
                                              );
                                            })}
                                            <Box component="td" sx={{ ...tdSx, textAlign: "center" }}>{badge(item.status)}</Box>
                                          </Box>
                                        ))}
                                    {(detailTab === "columns" ? visibleColumns : visibleIndexes).length === 0 ? (
                                      <Box component="tr">
                                        <Box component="td" colSpan={2 + instances.length} sx={{ ...tdSx, textAlign: "center", py: 2, color: "text.secondary" }}>
                                          No {detailTab} match the current filter.
                                        </Box>
                                      </Box>
                                    ) : null}
                                  </Box>
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
                <Box component="tr">
                  <Box component="td" colSpan={7 + instances.length} sx={{ ...tdSx, textAlign: "center", py: 4, color: "text.secondary" }}>
                    No tables found.
                  </Box>
                </Box>
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
