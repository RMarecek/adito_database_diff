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
    instances: Array<{ instanceId: string; name: string }>;
    total: number;
    items: MatrixRow[];
  }> {
    if (query.level && query.level !== "table") throw badRequest("Only level=table is supported");
    const { run, snapshotIds, options } = await this.getRunOrFail(compareRunId);
    const snapshots = await this.snapshotRepo.findBy({
      snapshotId: In(snapshotIds),
    });
    const mapBySnapshot = new Map<string, Map<string, TableSpec>>();

    for (const snapshotId of snapshotIds) {
      mapBySnapshot.set(snapshotId, await this.snapshots.tableMapForSnapshot(snapshotId));
    }

    const allKeys = new Set<string>();
    for (const map of mapBySnapshot.values()) {
      for (const key of map.keys()) allKeys.add(key);
    }

    let rows: MatrixRow[] = [];
    const baselineMap = mapBySnapshot.get(run.baselineSnapshotId) ?? new Map<string, TableSpec>();

    for (const key of allKeys) {
      if (query.search && !key.includes(query.search.toUpperCase())) continue;

      const baseline = baselineMap.get(key) ?? null;
      const diffSummary = { columnsDifferent: 0, indexesDifferent: 0, missingColumns: 0, missingIndexes: 0 };
      const cells: MatrixRow["cells"] = {};

      for (const snapshot of snapshots) {
        const candidate = mapBySnapshot.get(snapshot.snapshotId)?.get(key) ?? null;
        if (!candidate) {
          cells[snapshot.instanceId] = {
            status: "MISSING",
            diff: baseline ? "MISSING" : "NONE",
          };
          continue;
        }
        if (!baseline) {
          cells[snapshot.instanceId] = {
            status: "PRESENT",
            diff: snapshot.snapshotId === run.baselineSnapshotId ? "NONE" : "DIFFERENT",
          };
          continue;
        }

        const summary = compareTable(baseline, candidate, {
          ignoreColumnOrder: options.ignoreColumnOrder,
          ignoreIndexName: options.ignoreIndexName,
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

      const row: MatrixRow = {
        objectKey: key,
        displayName: key.split(".")[1] ?? key,
        cells,
        diffSummary,
      };
      rows.push(row);
    }

    if (parseBool(query.onlyDifferences, false)) {
      rows = rows.filter((row) => hasDifference(row.diffSummary));
    }
    rows.sort((a, b) => a.objectKey.localeCompare(b.objectKey));
    const paged = paginateMatrixRows(rows, query.offset, query.limit);

    const instanceNameMap = await this.instanceNamesBySnapshotIds(snapshotIds);
    return {
      level: "table",
      instances: snapshots.map((s) => ({
        instanceId: s.instanceId,
        name: instanceNameMap.get(s.instanceId) ?? s.instanceId,
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
    const normalizedTableKey = tableKey.toUpperCase();
    const { run, snapshotIds, options } = await this.getRunOrFail(compareRunId);
    const snapshots = await this.snapshotRepo.findBy({
      snapshotId: In(snapshotIds),
    });

    const perInstance: Record<string, { table: TableSpec | null }> = {};
    const tablesBySnapshot = new Map<string, TableSpec | null>();
    for (const snapshot of snapshots) {
      const map = await this.snapshots.tableMapForSnapshot(snapshot.snapshotId);
      const table = map.get(normalizedTableKey) ?? null;
      tablesBySnapshot.set(snapshot.snapshotId, table);
      perInstance[snapshot.instanceId] = { table };
    }

    const baseline = tablesBySnapshot.get(run.baselineSnapshotId) ?? null;
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
          if (col.canonicalType !== baseColumn.canonicalType || col.nativeType !== baseColumn.nativeType) {
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
      tableKey: normalizedTableKey,
      perInstance,
      diff: {
        columns: columnDiffs,
        indexes: indexDiffs,
      },
    };
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
}
