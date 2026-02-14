import type { TableSpec } from "./types";
import { columnDefinitionKey, indexDefinitionKey } from "./normalize";

export type MatrixCell = {
  status: "PRESENT" | "MISSING";
  diff: "NONE" | "DIFFERENT" | "MISSING";
};

export interface TableDiffSummary {
  columnsDifferent: number;
  indexesDifferent: number;
  missingColumns: number;
  missingIndexes: number;
}

export interface MatrixRow {
  objectKey: string;
  displayName: string;
  cells: Record<string, MatrixCell>;
  diffSummary: TableDiffSummary;
}

const emptySummary = (): TableDiffSummary => ({
  columnsDifferent: 0,
  indexesDifferent: 0,
  missingColumns: 0,
  missingIndexes: 0,
});

export const compareTable = (
  baseline: TableSpec | null,
  candidate: TableSpec | null,
  options: {
    ignoreIndexName: boolean;
    ignoreColumnOrder: boolean;
  },
): TableDiffSummary => {
  if (!baseline || !candidate) {
    return emptySummary();
  }

  const summary = emptySummary();

  const baselineColumns = new Map(
    baseline.columns.map((c) => [c.name.toUpperCase(), columnDefinitionKey(c, options.ignoreColumnOrder)]),
  );
  const candidateColumns = new Map(
    candidate.columns.map((c) => [c.name.toUpperCase(), columnDefinitionKey(c, options.ignoreColumnOrder)]),
  );

  for (const [name, key] of baselineColumns) {
    const candidateKey = candidateColumns.get(name);
    if (!candidateKey) {
      summary.missingColumns += 1;
      continue;
    }
    if (candidateKey !== key) {
      summary.columnsDifferent += 1;
    }
  }

  const baselineIndexes = new Set(baseline.indexes.map((idx) => indexDefinitionKey(idx, options.ignoreIndexName)));
  const candidateIndexes = new Set(candidate.indexes.map((idx) => indexDefinitionKey(idx, options.ignoreIndexName)));

  for (const key of baselineIndexes) {
    if (!candidateIndexes.has(key)) {
      summary.missingIndexes += 1;
    }
  }
  for (const key of candidateIndexes) {
    if (!baselineIndexes.has(key)) {
      summary.indexesDifferent += 1;
    }
  }

  return summary;
};

export const hasDifference = (summary: TableDiffSummary): boolean =>
  summary.columnsDifferent > 0 ||
  summary.indexesDifferent > 0 ||
  summary.missingColumns > 0 ||
  summary.missingIndexes > 0;
