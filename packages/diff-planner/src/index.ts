export type CanonicalType =
  | "STRING"
  | "INT"
  | "BIGINT"
  | "DECIMAL"
  | "FLOAT"
  | "BOOLEAN"
  | "DATE"
  | "DATETIME"
  | "TIME"
  | "BINARY"
  | "BLOB"
  | "CLOB"
  | "JSON"
  | "UUID"
  | "OTHER";

export type StepAction =
  | "CREATE_TABLE"
  | "DROP_TABLE"
  | "ADD_COLUMN"
  | "DROP_COLUMN"
  | "ALTER_COLUMN"
  | "RENAME_TABLE"
  | "RENAME_COLUMN"
  | "CREATE_INDEX"
  | "DROP_INDEX";

export interface ColumnSpec {
  name: string;
  ordinalPosition: number;
  canonicalType: CanonicalType;
  nativeType: string;
  length: number | null;
  precision: number | null;
  scale: number | null;
  nullable: boolean;
  defaultRaw: string | null;
  comment: string | null;
  charset: string | null;
  collation: string | null;
}

export interface IndexColumnSpec {
  name: string;
  position: number;
  direction: "ASC" | "DESC";
  expression: string | null;
}

export interface IndexSpec {
  name: string;
  unique: boolean;
  indexType: string;
  columns: IndexColumnSpec[];
  whereClause: string | null;
  tablespace: string | null;
}

export interface TableSpec {
  schema: string;
  name: string;
  tableKey: string;
  isView: boolean;
  comment: string | null;
  storage: {
    engine: string | null;
    tablespace: string | null;
  };
  columns: ColumnSpec[];
  indexes: IndexSpec[];
}

export interface SnapshotSpec {
  snapshotId: string;
  instanceId: string;
  tables: TableSpec[];
}

export interface ChangeStep {
  stepId: string;
  action: StepAction;
  target: {
    schema: string;
    table: string;
  };
  table: TableSpec | null;
  column: ColumnSpec | null;
  index: IndexSpec | null;
  options: {
    ifExists?: boolean;
    ifNotExists?: boolean;
    [key: string]: unknown;
  } | null;
}

export interface TablePresenceMatrixRow {
  tableKey: string;
  cells: Record<string, { present: boolean }>;
}

export interface TablePresenceMatrix {
  snapshotIds: string[];
  rows: TablePresenceMatrixRow[];
}

export interface ColumnDiff {
  columnName: string;
  inBaseline: boolean;
  inTarget: boolean;
  typeDiff: boolean;
  nullableDiff: boolean;
  defaultDiff: boolean;
  orderDiff: boolean;
}

export interface IndexDiff {
  definitionKey: string;
  baselineIndexNames: string[];
  targetIndexNames: string[];
  missingInBaseline: boolean;
  missingInTarget: boolean;
}

export interface MultiInstanceTableDiff {
  tableKey: string;
  columnDiffsBySnapshotId: Record<string, ColumnDiff[]>;
  indexDiffsBySnapshotId: Record<string, IndexDiff[]>;
}

export interface MultiInstanceDiffResult {
  baselineSnapshotId: string;
  tablePresence: TablePresenceMatrix;
  tableDiffs: MultiInstanceTableDiff[];
}

export interface SimilarityWeights {
  table: number;
  column: number;
  index: number;
}

export interface SimilarityResult {
  score: number;
  components: {
    tableJaccard: number;
    columnMatch: number;
    indexMatch: number;
  };
  weights: SimilarityWeights;
}

export interface PlannerIssue {
  severity: "warning" | "block";
  code: string;
  message: string;
  tableKey: string;
  columnName?: string;
}

export interface AlignPlannerInput {
  baseline: SnapshotSpec;
  target: SnapshotSpec;
  tableKeys?: string[];
  include: {
    tables?: boolean;
    columns: boolean;
    indexes: boolean;
  };
  allowDestructive: boolean;
  ignoreIndexName?: boolean;
}

export interface AlignPlanResult {
  steps: ChangeStep[];
  warnings: PlannerIssue[];
  blockingIssues: PlannerIssue[];
}

const normalizeId = (value: string): string => value.trim().toUpperCase();
const normalizeDefault = (value: string | null): string => (value ?? "").trim();
const toNumber = (value: number | null): number => (value ?? 0);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const stableSort = <T>(values: T[], compare: (a: T, b: T) => number): T[] => [...values].sort(compare);

const byName = <T extends { name: string }>(a: T, b: T): number => normalizeId(a.name).localeCompare(normalizeId(b.name));

const byPositionThenName = <T extends { position?: number; ordinalPosition?: number; name: string }>(a: T, b: T): number => {
  const posA = a.position ?? a.ordinalPosition ?? 0;
  const posB = b.position ?? b.ordinalPosition ?? 0;
  if (posA !== posB) return posA - posB;
  return normalizeId(a.name).localeCompare(normalizeId(b.name));
};

const normalizeColumn = (column: ColumnSpec): ColumnSpec => ({
  ...clone(column),
  name: normalizeId(column.name),
});

const normalizeIndex = (index: IndexSpec): IndexSpec => ({
  ...clone(index),
  name: normalizeId(index.name),
  indexType: normalizeId(index.indexType),
  columns: stableSort(
    index.columns.map((col) => ({
      ...clone(col),
      name: normalizeId(col.name),
      direction: normalizeId(col.direction) === "DESC" ? "DESC" : "ASC",
    })),
    byPositionThenName,
  ),
});

const normalizeTable = (table: TableSpec): TableSpec => {
  const schema = normalizeId(table.schema);
  const name = normalizeId(table.name);
  const normalizedColumns = stableSort(table.columns.map(normalizeColumn), byPositionThenName);
  const normalizedIndexes = stableSort(table.indexes.map(normalizeIndex), byName);
  return {
    ...clone(table),
    schema,
    name,
    tableKey: tableKey(schema, name),
    columns: normalizedColumns,
    indexes: normalizedIndexes,
  };
};

const snapshotToTableMap = (snapshot: SnapshotSpec): Map<string, TableSpec> => {
  const map = new Map<string, TableSpec>();
  for (const table of snapshot.tables.map(normalizeTable)) {
    map.set(table.tableKey, table);
  }
  return map;
};

const mapByColumnName = (table: TableSpec): Map<string, ColumnSpec> =>
  new Map(table.columns.map((column) => [normalizeId(column.name), column]));

const indexDefinition = (index: IndexSpec, ignoreName: boolean): string => {
  const cols = stableSort(index.columns, byPositionThenName)
    .map((c) => `${normalizeId(c.name)}:${c.direction}:${c.expression ?? ""}`)
    .join("|");
  const base = ignoreName ? "IGN" : normalizeId(index.name);
  return [
    base,
    index.unique ? "U1" : "U0",
    normalizeId(index.indexType),
    cols,
    index.whereClause ?? "",
  ].join(";");
};

const mapByIndexDefinition = (table: TableSpec, ignoreName: boolean): Map<string, IndexSpec[]> => {
  const map = new Map<string, IndexSpec[]>();
  for (const index of table.indexes) {
    const key = indexDefinition(index, ignoreName);
    const list = map.get(key) ?? [];
    list.push(index);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort(byName);
  }
  return map;
};

const equalsType = (a: ColumnSpec, b: ColumnSpec): boolean =>
  normalizeId(a.canonicalType) === normalizeId(b.canonicalType) &&
  normalizeId(a.nativeType) === normalizeId(b.nativeType) &&
  a.length === b.length &&
  a.precision === b.precision &&
  a.scale === b.scale;

const isStringLike = (type: CanonicalType): boolean => type === "STRING" || type === "CLOB";

const isNumericLike = (type: CanonicalType): boolean =>
  type === "INT" || type === "BIGINT" || type === "DECIMAL" || type === "FLOAT";

const isSafeTypeWiden = (target: ColumnSpec, baseline: ColumnSpec): boolean => {
  if (equalsType(target, baseline)) return true;

  if (isStringLike(target.canonicalType) && isStringLike(baseline.canonicalType)) {
    if (baseline.length === null) return true;
    if (target.length === null) return false;
    return baseline.length >= target.length;
  }

  if (target.canonicalType === "INT" && baseline.canonicalType === "BIGINT") return true;
  if (isNumericLike(target.canonicalType) && isNumericLike(baseline.canonicalType)) {
    if (baseline.canonicalType === "FLOAT" && target.canonicalType !== "FLOAT") return true;
    if (baseline.canonicalType === "DECIMAL" && target.canonicalType === "INT") return true;
    if (baseline.canonicalType === "DECIMAL" && target.canonicalType === "BIGINT") return true;
    if (baseline.canonicalType === "DECIMAL" && target.canonicalType === "DECIMAL") {
      return toNumber(baseline.precision) >= toNumber(target.precision) && toNumber(baseline.scale) >= toNumber(target.scale);
    }
  }

  return false;
};

const isSafeNullableAlignment = (target: ColumnSpec, baseline: ColumnSpec): boolean => {
  if (target.nullable === baseline.nullable) return true;
  // Making target more permissive is safe, making stricter is destructive.
  return baseline.nullable && !target.nullable;
};

const actionableColumnDiff = (baseline: ColumnSpec, target: ColumnSpec): boolean =>
  !equalsType(baseline, target) ||
  baseline.nullable !== target.nullable ||
  normalizeDefault(baseline.defaultRaw) !== normalizeDefault(target.defaultRaw) ||
  baseline.ordinalPosition !== target.ordinalPosition;

const makeStepId = (index: number): string => `step-${String(index).padStart(4, "0")}`;

const sortTableKeys = (keys: Iterable<string>): string[] => stableSort([...keys], (a, b) => a.localeCompare(b));

export const tableKey = (schema: string, tableName: string): string =>
  `${normalizeId(schema)}.${normalizeId(tableName)}`;

export const columnKey = (schema: string, tableName: string, columnName: string): string =>
  `${normalizeId(schema)}.${normalizeId(tableName)}.${normalizeId(columnName)}`;

export const indexKey = (schema: string, tableName: string, indexName: string): string =>
  `${normalizeId(schema)}.${normalizeId(tableName)}.${normalizeId(indexName)}`;

export const tablePresenceMatrix = (snapshots: SnapshotSpec[]): TablePresenceMatrix => {
  const snapshotIds = snapshots.map((snapshot) => snapshot.snapshotId);
  const maps = snapshots.map(snapshotToTableMap);
  const allKeys = new Set<string>();
  for (const map of maps) {
    for (const key of map.keys()) allKeys.add(key);
  }

  const rows: TablePresenceMatrixRow[] = sortTableKeys(allKeys).map((key) => {
    const cells: Record<string, { present: boolean }> = {};
    for (let i = 0; i < snapshots.length; i += 1) {
      cells[snapshots[i].snapshotId] = { present: maps[i].has(key) };
    }
    return { tableKey: key, cells };
  });

  return { snapshotIds, rows };
};

export const columnDiffs = (baseline: TableSpec | null, target: TableSpec | null): ColumnDiff[] => {
  if (!baseline && !target) return [];
  if (!baseline && target) {
    return stableSort(target.columns, byPositionThenName).map((column) => ({
      columnName: normalizeId(column.name),
      inBaseline: false,
      inTarget: true,
      typeDiff: false,
      nullableDiff: false,
      defaultDiff: false,
      orderDiff: false,
    }));
  }
  if (baseline && !target) {
    return stableSort(baseline.columns, byPositionThenName).map((column) => ({
      columnName: normalizeId(column.name),
      inBaseline: true,
      inTarget: false,
      typeDiff: false,
      nullableDiff: false,
      defaultDiff: false,
      orderDiff: false,
    }));
  }

  const baselineMap = mapByColumnName(baseline!);
  const targetMap = mapByColumnName(target!);
  const names = sortTableKeys(new Set([...baselineMap.keys(), ...targetMap.keys()]));

  return names.map((name) => {
    const base = baselineMap.get(name);
    const targ = targetMap.get(name);
    if (!base) {
      return {
        columnName: name,
        inBaseline: false,
        inTarget: true,
        typeDiff: false,
        nullableDiff: false,
        defaultDiff: false,
        orderDiff: false,
      };
    }
    if (!targ) {
      return {
        columnName: name,
        inBaseline: true,
        inTarget: false,
        typeDiff: false,
        nullableDiff: false,
        defaultDiff: false,
        orderDiff: false,
      };
    }
    return {
      columnName: name,
      inBaseline: true,
      inTarget: true,
      typeDiff: !equalsType(base, targ),
      nullableDiff: base.nullable !== targ.nullable,
      defaultDiff: normalizeDefault(base.defaultRaw) !== normalizeDefault(targ.defaultRaw),
      orderDiff: base.ordinalPosition !== targ.ordinalPosition,
    };
  });
};

export const indexDiffs = (
  baseline: TableSpec | null,
  target: TableSpec | null,
  options: { ignoreIndexName?: boolean } = {},
): IndexDiff[] => {
  const ignoreIndexName = options.ignoreIndexName ?? true;
  const baselineMap = baseline ? mapByIndexDefinition(baseline, ignoreIndexName) : new Map<string, IndexSpec[]>();
  const targetMap = target ? mapByIndexDefinition(target, ignoreIndexName) : new Map<string, IndexSpec[]>();
  const keys = sortTableKeys(new Set([...baselineMap.keys(), ...targetMap.keys()]));

  return keys.map((key) => ({
    definitionKey: key,
    baselineIndexNames: stableSort(
      (baselineMap.get(key) ?? []).map((item) => normalizeId(item.name)),
      (a, b) => a.localeCompare(b),
    ),
    targetIndexNames: stableSort(
      (targetMap.get(key) ?? []).map((item) => normalizeId(item.name)),
      (a, b) => a.localeCompare(b),
    ),
    missingInBaseline: !baselineMap.has(key),
    missingInTarget: !targetMap.has(key),
  }));
};

export const multiInstanceDiff = (
  snapshots: SnapshotSpec[],
  options: { baselineSnapshotId?: string; ignoreIndexName?: boolean } = {},
): MultiInstanceDiffResult => {
  if (snapshots.length === 0) {
    return {
      baselineSnapshotId: "",
      tablePresence: { snapshotIds: [], rows: [] },
      tableDiffs: [],
    };
  }

  const baselineSnapshotId = options.baselineSnapshotId ?? snapshots[0].snapshotId;
  const baselineSnapshot =
    snapshots.find((snapshot) => snapshot.snapshotId === baselineSnapshotId) ?? snapshots[0];
  const matrix = tablePresenceMatrix(snapshots);
  const maps = new Map(snapshots.map((snapshot) => [snapshot.snapshotId, snapshotToTableMap(snapshot)]));
  const baselineMap = maps.get(baselineSnapshot.snapshotId) ?? new Map<string, TableSpec>();

  const tableDiffs: MultiInstanceTableDiff[] = matrix.rows.map((row) => {
    const baseTable = baselineMap.get(row.tableKey) ?? null;
    const columnBySnapshot: Record<string, ColumnDiff[]> = {};
    const indexBySnapshot: Record<string, IndexDiff[]> = {};

    for (const snapshot of snapshots) {
      if (snapshot.snapshotId === baselineSnapshot.snapshotId) continue;
      const targetTable = maps.get(snapshot.snapshotId)?.get(row.tableKey) ?? null;
      columnBySnapshot[snapshot.snapshotId] = columnDiffs(baseTable, targetTable);
      indexBySnapshot[snapshot.snapshotId] = indexDiffs(baseTable, targetTable, {
        ignoreIndexName: options.ignoreIndexName ?? true,
      });
    }

    return {
      tableKey: row.tableKey,
      columnDiffsBySnapshotId: columnBySnapshot,
      indexDiffsBySnapshotId: indexBySnapshot,
    };
  });

  return {
    baselineSnapshotId: baselineSnapshot.snapshotId,
    tablePresence: matrix,
    tableDiffs,
  };
};

const jaccard = <T>(a: Set<T>, b: Set<T>): number => {
  if (a.size === 0 && b.size === 0) return 1;
  const union = new Set<T>([...a, ...b]);
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return union.size === 0 ? 1 : intersection / union.size;
};

const columnSetForTable = (table: TableSpec): Set<string> =>
  new Set(
    table.columns.map((column) =>
      [
        normalizeId(column.name),
        normalizeId(column.canonicalType),
        normalizeId(column.nativeType),
        column.length ?? "",
        column.precision ?? "",
        column.scale ?? "",
        String(column.nullable),
        normalizeDefault(column.defaultRaw),
        column.ordinalPosition,
      ].join(";"),
    ),
  );

const indexSetForTable = (table: TableSpec, ignoreIndexName: boolean): Set<string> =>
  new Set(table.indexes.map((index) => indexDefinition(index, ignoreIndexName)));

const weightedAverage = (items: Array<{ score: number; weight: number }>): number => {
  const totalWeight = items.reduce((acc, item) => acc + item.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = items.reduce((acc, item) => acc + item.score * item.weight, 0);
  return weighted / totalWeight;
};

export const similarityScore = (
  a: SnapshotSpec,
  b: SnapshotSpec,
  options: { weights?: Partial<SimilarityWeights>; ignoreIndexName?: boolean } = {},
): SimilarityResult => {
  const weights: SimilarityWeights = {
    table: options.weights?.table ?? 0.4,
    column: options.weights?.column ?? 0.35,
    index: options.weights?.index ?? 0.25,
  };

  const mapA = snapshotToTableMap(a);
  const mapB = snapshotToTableMap(b);
  const tableSetA = new Set(mapA.keys());
  const tableSetB = new Set(mapB.keys());
  const tableJaccard = jaccard(tableSetA, tableSetB);

  const allTableKeys = sortTableKeys(new Set([...tableSetA, ...tableSetB]));
  const columnScores: number[] = [];
  const indexScores: number[] = [];
  for (const key of allTableKeys) {
    const tableA = mapA.get(key);
    const tableB = mapB.get(key);
    if (!tableA || !tableB) {
      columnScores.push(0);
      indexScores.push(0);
      continue;
    }
    columnScores.push(jaccard(columnSetForTable(tableA), columnSetForTable(tableB)));
    indexScores.push(
      jaccard(
        indexSetForTable(tableA, options.ignoreIndexName ?? true),
        indexSetForTable(tableB, options.ignoreIndexName ?? true),
      ),
    );
  }

  const columnMatch = columnScores.length === 0 ? 1 : columnScores.reduce((acc, v) => acc + v, 0) / columnScores.length;
  const indexMatch = indexScores.length === 0 ? 1 : indexScores.reduce((acc, v) => acc + v, 0) / indexScores.length;
  const score = weightedAverage([
    { score: tableJaccard, weight: weights.table },
    { score: columnMatch, weight: weights.column },
    { score: indexMatch, weight: weights.index },
  ]);

  return {
    score,
    components: {
      tableJaccard,
      columnMatch,
      indexMatch,
    },
    weights,
  };
};

const createStep = (
  action: StepAction,
  target: { schema: string; table: string },
  payload: {
    table?: TableSpec | null;
    column?: ColumnSpec | null;
    index?: IndexSpec | null;
    options?: ChangeStep["options"];
  },
): ChangeStep => ({
  stepId: "",
  action,
  target,
  table: payload.table ?? null,
  column: payload.column ?? null,
  index: payload.index ?? null,
  options: payload.options ?? null,
});

const withStepIds = (steps: ChangeStep[]): ChangeStep[] =>
  steps.map((step, idx) => ({ ...step, stepId: makeStepId(idx + 1) }));

export const alignToBaselinePlan = (input: AlignPlannerInput): AlignPlanResult => {
  const baselineMap = snapshotToTableMap(input.baseline);
  const targetMap = snapshotToTableMap(input.target);
  const includeTables = input.include.tables ?? true;
  const ignoreIndexName = input.ignoreIndexName ?? true;

  const requestedKeys = input.tableKeys
    ? sortTableKeys(new Set(input.tableKeys.map((key) => normalizeId(key))))
    : sortTableKeys(baselineMap.keys());

  const steps: ChangeStep[] = [];
  const warnings: PlannerIssue[] = [];
  const blockingIssues: PlannerIssue[] = [];

  for (const key of requestedKeys) {
    const baselineTable = baselineMap.get(key);
    if (!baselineTable) continue;
    const targetTable = targetMap.get(key) ?? null;
    const targetRef = {
      schema: baselineTable.schema,
      table: baselineTable.name,
    };

    if (!targetTable) {
      if (includeTables) {
        const tablePayload: TableSpec = {
          ...clone(baselineTable),
          columns: input.include.columns ? clone(baselineTable.columns) : [],
          indexes: input.include.indexes ? clone(baselineTable.indexes) : [],
        };
        steps.push(
          createStep("CREATE_TABLE", targetRef, {
            table: tablePayload,
            options: { ifNotExists: true },
          }),
        );
      } else {
        blockingIssues.push({
          severity: "block",
          code: "MISSING_TABLE",
          tableKey: key,
          message: "Target table is missing and table creation is disabled.",
        });
      }
      continue;
    }

    if (input.include.columns) {
      const baseColumns = stableSort(baselineTable.columns, byPositionThenName);
      const targetColumns = mapByColumnName(targetTable);
      const baselineNames = new Set(baseColumns.map((column) => normalizeId(column.name)));

      for (const baseColumn of baseColumns) {
        const targetColumn = targetColumns.get(normalizeId(baseColumn.name));
        if (!targetColumn) {
          steps.push(
            createStep("ADD_COLUMN", targetRef, {
              column: clone(baseColumn),
              options: { ifNotExists: true },
            }),
          );
          continue;
        }
        if (!actionableColumnDiff(baseColumn, targetColumn)) continue;

        const safeType = isSafeTypeWiden(targetColumn, baseColumn);
        const safeNullable = isSafeNullableAlignment(targetColumn, baseColumn);
        const safe = safeType && safeNullable;

        if (safe || input.allowDestructive) {
          steps.push(
            createStep("ALTER_COLUMN", targetRef, {
              column: clone(baseColumn),
              options: null,
            }),
          );
          if (!safe) {
            warnings.push({
              severity: "warning",
              code: "UNSAFE_ALTER_ALLOWED",
              tableKey: key,
              columnName: baseColumn.name,
              message: "Potentially destructive column alter was included because allowDestructive=true.",
            });
          }
        } else {
          blockingIssues.push({
            severity: "block",
            code: "UNSAFE_ALTER_BLOCKED",
            tableKey: key,
            columnName: baseColumn.name,
            message: "Column alter is not a safe widening and allowDestructive=false.",
          });
        }
      }

      if (input.allowDestructive) {
        const extras = stableSort(
          targetTable.columns.filter((column) => !baselineNames.has(normalizeId(column.name))),
          byName,
        );
        for (const extra of extras) {
          steps.push(
            createStep("DROP_COLUMN", targetRef, {
              column: clone(extra),
              options: { ifExists: true },
            }),
          );
        }
      }
    }

    if (input.include.indexes) {
      const baselineByDef = mapByIndexDefinition(baselineTable, ignoreIndexName);
      const targetByDef = mapByIndexDefinition(targetTable, ignoreIndexName);

      const baselineDefs = sortTableKeys(baselineByDef.keys());
      for (const def of baselineDefs) {
        if (!targetByDef.has(def)) {
          const baselineIndex = baselineByDef.get(def)![0];
          steps.push(
            createStep("CREATE_INDEX", targetRef, {
              index: clone(baselineIndex),
              options: { ifNotExists: true },
            }),
          );
        }
      }

      if (input.allowDestructive) {
        const targetDefs = sortTableKeys(targetByDef.keys());
        for (const def of targetDefs) {
          if (!baselineByDef.has(def)) {
            const targetIndex = targetByDef.get(def)![0];
            steps.push(
              createStep("DROP_INDEX", targetRef, {
                index: clone(targetIndex),
                options: { ifExists: true },
              }),
            );
          }
        }
      }
    }
  }

  return {
    steps: withStepIds(steps),
    warnings,
    blockingIssues,
  };
};
