import { In } from "typeorm";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { AppDataSource } from "../../config/data-source";
import { badRequest, notFound } from "../../common/errors";
import { CompareRunEntity } from "./compare-run.entity";
import { SnapshotEntity } from "../snapshots/snapshot.entity";
import { compareTable, hasDifference, type MatrixRow } from "../schema/diff";
import type { CompareOptions, TableSpec } from "../schema/types";
import type { SnapshotService } from "../snapshots/snapshot.service";
import { indexDefinitionKey } from "../schema/normalize";
import { InstanceEntity } from "../instances/instance.entity";
import { paginateMatrixRows } from "./matrix-pagination";

const createCompareRunSchema = z.object({
  baselineSnapshotId: z.string().uuid(),
  snapshotIds: z.array(z.string().uuid()).min(1),
  options: z.object({
    matchIndexByDefinition: z.boolean().default(true),
    ignoreIndexName: z.boolean().default(true),
    ignoreColumnOrder: z.boolean().default(false),
  }),
});

const parseBool = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "undefined") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
};

export class CompareService {
  private readonly repo = AppDataSource.getRepository(CompareRunEntity);
  private readonly snapshotRepo = AppDataSource.getRepository(SnapshotEntity);
  private readonly instanceRepo = AppDataSource.getRepository(InstanceEntity);

  constructor(private readonly snapshots: SnapshotService) {}

  async createRun(input: unknown): Promise<CompareRunEntity> {
    const parsed = createCompareRunSchema.safeParse(input);
    if (!parsed.success) throw badRequest("Invalid request payload", { issues: parsed.error.issues });
    const payload = parsed.data;

    const selectedSnapshotIds = [...new Set([payload.baselineSnapshotId, ...payload.snapshotIds])];
    const available = await this.snapshotRepo.findBy({
      snapshotId: In(selectedSnapshotIds),
    });
    if (available.length !== selectedSnapshotIds.length) {
      throw badRequest("One or more snapshotIds do not exist");
    }

    const run = this.repo.create({
      compareRunId: uuidv4(),
      baselineSnapshotId: payload.baselineSnapshotId,
      snapshotIdsJson: JSON.stringify(selectedSnapshotIds),
      optionsJson: JSON.stringify(payload.options),
      status: "READY",
    });
    return this.repo.save(run);
  }

  async getRunOrFail(compareRunId: string): Promise<{ run: CompareRunEntity; snapshotIds: string[]; options: CompareOptions }> {
    const run = await this.repo.findOne({ where: { compareRunId } });
    if (!run) throw notFound(`Compare run not found: ${compareRunId}`);
    return {
      run,
      snapshotIds: JSON.parse(run.snapshotIdsJson),
      options: JSON.parse(run.optionsJson),
    };
  }

  async getMatrix(
    compareRunId: string,
    query: {
      level: string | undefined;
      onlyDifferences: unknown;
      search: string | null;
      offset: number;
      limit: number;
    },
  ): Promise<{
    level: "table";
    instances: Array<{ instanceId: string; name: string; dbType: "oracle" | "mariadb" }>;
    options: CompareOptions;
    total: number;
    items: MatrixRow[];
  }> {
    if (query.level && query.level !== "table") throw badRequest("Only level=table is supported");
    const { run, snapshotIds, options } = await this.getRunOrFail(compareRunId);
    const snapshotRows = await this.snapshotRepo.findBy({
      snapshotId: In(snapshotIds),
    });
    const snapshotsById = new Map(snapshotRows.map((row) => [row.snapshotId, row]));
    const snapshots = snapshotIds
      .map((snapshotId) => snapshotsById.get(snapshotId))
      .filter((snapshot): snapshot is SnapshotEntity => Boolean(snapshot));

    const groupedBySnapshot = new Map<string, Map<string, TableSpec[]>>();
    for (const snapshotId of snapshotIds) {
      const tableMap = await this.snapshots.tableMapForSnapshot(snapshotId);
      groupedBySnapshot.set(snapshotId, this.groupByTableName(tableMap));
    }

    const allTableNames = new Set<string>();
    for (const grouped of groupedBySnapshot.values()) {
      for (const name of grouped.keys()) allTableNames.add(name);
    }

    const instanceMetaById = await this.instanceMetaBySnapshotIds(snapshotIds);
    const baselineSnapshot = snapshotsById.get(run.baselineSnapshotId) ?? null;
    const baselineDbType = baselineSnapshot
      ? (instanceMetaById.get(baselineSnapshot.instanceId)?.dbType ?? null)
      : null;

    let rows: MatrixRow[] = [];
    const baselineGrouped = groupedBySnapshot.get(run.baselineSnapshotId) ?? new Map<string, TableSpec[]>();

    for (const tableName of allTableNames) {
      if (query.search && !tableName.includes(query.search.toUpperCase())) continue;

      const baseline = this.pickTableByName(baselineGrouped, tableName, undefined);
      const preferredSchema = baseline?.schema;
      const diffSummary = { columnsDifferent: 0, indexesDifferent: 0, missingColumns: 0, missingIndexes: 0 };
      const cells: MatrixRow["cells"] = {};

      for (const snapshot of snapshots) {
        const grouped = groupedBySnapshot.get(snapshot.snapshotId) ?? new Map<string, TableSpec[]>();
        const candidate = this.pickTableByName(grouped, tableName, preferredSchema);
        if (!candidate) {
          if (baseline) {
            diffSummary.missingColumns = Math.max(
              diffSummary.missingColumns,
              Math.max(1, baseline.columns.length),
            );
            diffSummary.missingIndexes = Math.max(
              diffSummary.missingIndexes,
              Math.max(1, baseline.indexes.length),
            );
          }
          cells[snapshot.instanceId] = {
            status: "MISSING",
            diff: baseline ? "MISSING" : "NONE",
          };
          continue;
        }
        if (!baseline) {
          if (snapshot.snapshotId !== run.baselineSnapshotId) {
            diffSummary.columnsDifferent = Math.max(
              diffSummary.columnsDifferent,
              Math.max(1, candidate.columns.length),
            );
            diffSummary.indexesDifferent = Math.max(
              diffSummary.indexesDifferent,
              Math.max(1, candidate.indexes.length),
            );
          }
          cells[snapshot.instanceId] = {
            status: "PRESENT",
            diff: snapshot.snapshotId === run.baselineSnapshotId ? "NONE" : "DIFFERENT",
          };
          continue;
        }

        const summary = compareTable(baseline, candidate, {
          ignoreColumnOrder: options.ignoreColumnOrder,
          ignoreIndexName: options.ignoreIndexName,
          compareNativeType:
            baselineDbType && instanceMetaById.get(snapshot.instanceId)?.dbType
              ? baselineDbType === instanceMetaById.get(snapshot.instanceId)?.dbType
              : true,
        });
        diffSummary.columnsDifferent = Math.max(diffSummary.columnsDifferent, summary.columnsDifferent);
        diffSummary.indexesDifferent = Math.max(diffSummary.indexesDifferent, summary.indexesDifferent);
        diffSummary.missingColumns = Math.max(diffSummary.missingColumns, summary.missingColumns);
        diffSummary.missingIndexes = Math.max(diffSummary.missingIndexes, summary.missingIndexes);

        cells[snapshot.instanceId] = {
          status: "PRESENT",
          diff: hasDifference(summary) ? "DIFFERENT" : "NONE",
        };
      }

      rows.push({
        objectKey: tableName,
        displayName: tableName,
        cells,
        diffSummary,
      });
    }

    if (parseBool(query.onlyDifferences, false)) {
      rows = rows.filter(
        (row) =>
          hasDifference(row.diffSummary) ||
          Object.values(row.cells).some((cell) => cell.status === "MISSING" || cell.diff !== "NONE"),
      );
    }
    rows.sort((a, b) => a.objectKey.localeCompare(b.objectKey));
    const paged = paginateMatrixRows(rows, query.offset, query.limit);

    const instanceNameMap = await this.instanceNamesBySnapshotIds(snapshotIds);
    return {
      level: "table",
      options,
      instances: snapshots.map((s) => ({
        instanceId: s.instanceId,
        name: instanceNameMap.get(s.instanceId) ?? s.instanceId,
        dbType: instanceMetaById.get(s.instanceId)?.dbType ?? "oracle",
      })),
      total: paged.total,
      items: paged.items,
    };
  }

  async getDetails(compareRunId: string, tableKey: string): Promise<{
    tableKey: string;
    perInstance: Record<string, { table: TableSpec | null }>;
    diff: {
      columns: Array<{ columnName: string; typeDiff: boolean; nullableDiff: boolean; defaultDiff: boolean }>;
      indexes: Array<{ indexDefinitionKey: string; missingInInstanceIds: string[] }>;
    };
  }> {
    const normalized = tableKey.toUpperCase();
    const selection = this.parseTableSelection(normalized);
    const requestedSchema = selection.schema;
    const tableName = selection.tableName;
    const { run, snapshotIds, options } = await this.getRunOrFail(compareRunId);
    const snapshotRows = await this.snapshotRepo.findBy({
      snapshotId: In(snapshotIds),
    });
    const snapshotsById = new Map(snapshotRows.map((row) => [row.snapshotId, row]));
    const snapshots = snapshotIds
      .map((snapshotId) => snapshotsById.get(snapshotId))
      .filter((snapshot): snapshot is SnapshotEntity => Boolean(snapshot));

    const groupedBySnapshot = new Map<string, Map<string, TableSpec[]>>();
    for (const snapshot of snapshots) {
      const tableMap = await this.snapshots.tableMapForSnapshot(snapshot.snapshotId);
      groupedBySnapshot.set(snapshot.snapshotId, this.groupByTableName(tableMap));
    }

    const baselineGrouped = groupedBySnapshot.get(run.baselineSnapshotId) ?? new Map<string, TableSpec[]>();
    const baseline = this.pickTableByName(baselineGrouped, tableName, requestedSchema ?? undefined);
    const preferredSchema = baseline?.schema ?? requestedSchema ?? undefined;
    const instanceMetaById = await this.instanceMetaBySnapshotIds(snapshotIds);
    const baselineSnapshot = snapshotsById.get(run.baselineSnapshotId) ?? null;
    const baselineDbType = baselineSnapshot
      ? (instanceMetaById.get(baselineSnapshot.instanceId)?.dbType ?? null)
      : null;

    const perInstance: Record<string, { table: TableSpec | null }> = {};
    const tablesBySnapshot = new Map<string, TableSpec | null>();
    for (const snapshot of snapshots) {
      const grouped = groupedBySnapshot.get(snapshot.snapshotId) ?? new Map<string, TableSpec[]>();
      const table = this.pickTableByName(grouped, tableName, preferredSchema);
      tablesBySnapshot.set(snapshot.snapshotId, table);
      perInstance[snapshot.instanceId] = { table };
    }

    const columnDiffs: Array<{ columnName: string; typeDiff: boolean; nullableDiff: boolean; defaultDiff: boolean }> = [];
    const indexDiffs: Array<{ indexDefinitionKey: string; missingInInstanceIds: string[] }> = [];

    if (baseline) {
      for (const baseColumn of baseline.columns) {
        let typeDiff = false;
        let nullableDiff = false;
        let defaultDiff = false;
        for (const snapshot of snapshots) {
          if (snapshot.snapshotId === run.baselineSnapshotId) continue;
          const table = tablesBySnapshot.get(snapshot.snapshotId);
          const col = table?.columns.find((c) => c.name === baseColumn.name);
          if (!col) continue;
          const compareNativeType =
            baselineDbType && instanceMetaById.get(snapshot.instanceId)?.dbType
              ? baselineDbType === instanceMetaById.get(snapshot.instanceId)?.dbType
              : true;
          if (
            col.canonicalType !== baseColumn.canonicalType ||
            col.length !== baseColumn.length ||
            col.precision !== baseColumn.precision ||
            col.scale !== baseColumn.scale ||
            (compareNativeType && col.nativeType.toUpperCase() !== baseColumn.nativeType.toUpperCase())
          ) {
            typeDiff = true;
          }
          if (col.nullable !== baseColumn.nullable) nullableDiff = true;
          if ((col.defaultRaw ?? null) !== (baseColumn.defaultRaw ?? null)) defaultDiff = true;
        }
        if (typeDiff || nullableDiff || defaultDiff) {
          columnDiffs.push({
            columnName: baseColumn.name,
            typeDiff,
            nullableDiff,
            defaultDiff,
          });
        }
      }

      const baselineIndexKeys = baseline.indexes.map((idx) => indexDefinitionKey(idx, options.ignoreIndexName));
      for (const baselineIndexKey of baselineIndexKeys) {
        const missingInInstanceIds: string[] = [];
        for (const snapshot of snapshots) {
          if (snapshot.snapshotId === run.baselineSnapshotId) continue;
          const table = tablesBySnapshot.get(snapshot.snapshotId);
          const keys = new Set((table?.indexes ?? []).map((idx) => indexDefinitionKey(idx, options.ignoreIndexName)));
          if (!keys.has(baselineIndexKey)) {
            missingInInstanceIds.push(snapshot.instanceId);
          }
        }
        if (missingInInstanceIds.length > 0) {
          indexDiffs.push({
            indexDefinitionKey: baselineIndexKey,
            missingInInstanceIds,
          });
        }
      }
    }

    return {
      tableKey: tableName,
      perInstance,
      diff: {
        columns: columnDiffs,
        indexes: indexDiffs,
      },
    };
  }

  private parseTableSelection(input: string): { schema: string | null; tableName: string } {
    const parts = input.split(".");
    if (parts.length >= 2) {
      const tableName = parts[parts.length - 1] ?? input;
      const schema = parts.slice(0, parts.length - 1).join(".");
      return {
        schema: schema || null,
        tableName,
      };
    }
    return { schema: null, tableName: input };
  }

  private groupByTableName(tableMap: Map<string, TableSpec>): Map<string, TableSpec[]> {
    const grouped = new Map<string, TableSpec[]>();
    for (const table of tableMap.values()) {
      const name = table.name.toUpperCase();
      const current = grouped.get(name) ?? [];
      current.push(table);
      grouped.set(name, current);
    }
    for (const tables of grouped.values()) {
      tables.sort((a, b) => a.tableKey.localeCompare(b.tableKey));
    }
    return grouped;
  }

  private pickTableByName(
    grouped: Map<string, TableSpec[]>,
    tableName: string,
    preferredSchema?: string,
  ): TableSpec | null {
    const candidates = grouped.get(tableName.toUpperCase()) ?? [];
    if (candidates.length === 0) return null;
    if (preferredSchema) {
      const preferred = candidates.find((table) => table.schema.toUpperCase() === preferredSchema.toUpperCase());
      if (preferred) return preferred;
    }
    return candidates[0];
  }

  private async instanceNamesBySnapshotIds(snapshotIds: string[]): Promise<Map<string, string>> {
    const snapshots = await this.snapshotRepo.findBy({
      snapshotId: In(snapshotIds),
    });
    const instanceIds = [...new Set(snapshots.map((s) => s.instanceId))];
    if (instanceIds.length === 0) return new Map<string, string>();
    const instances = await this.instanceRepo.findBy({
      instanceId: In(instanceIds),
    });
    return new Map(instances.map((i) => [i.instanceId, i.name]));
  }

  private async instanceMetaBySnapshotIds(
    snapshotIds: string[],
  ): Promise<Map<string, { name: string; dbType: "oracle" | "mariadb" }>> {
    const snapshots = await this.snapshotRepo.findBy({
      snapshotId: In(snapshotIds),
    });
    const instanceIds = [...new Set(snapshots.map((s) => s.instanceId))];
    if (instanceIds.length === 0) return new Map();
    const instances = await this.instanceRepo.findBy({
      instanceId: In(instanceIds),
    });
    return new Map(instances.map((instance) => [instance.instanceId, { name: instance.name, dbType: instance.dbType }]));
  }
}
