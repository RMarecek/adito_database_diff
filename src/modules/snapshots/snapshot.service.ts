import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { AppDataSource } from "../../config/data-source";
import { env } from "../../config/env";
import { badRequest, notFound } from "../../common/errors";
import { makeColumnKey, makeIndexKey, makeTableKey } from "../schema/keys";
import { compareTable, hasDifference } from "../schema/diff";
import type { TableSpec } from "../schema/types";
import { normalizeBundleToTableSpecs } from "../schema/normalize";
import { SnapshotEntity } from "./snapshot.entity";
import { SnapshotTableEntity } from "./snapshot-table.entity";
import { SnapshotColumnEntity } from "./snapshot-column.entity";
import { SnapshotIndexEntity } from "./snapshot-index.entity";
import { jobBus } from "../jobs/job-bus";
import type { CrmConnectorService, MetadataExportOptions } from "../crmConnector/crm-connector.service";
import type { InstanceService } from "../instances/instance.service";

const createSnapshotSchema = z.object({
  schema: z.string().min(1).max(128),
  filters: z.object({
    tableNameLike: z.string().nullable().optional(),
    includeViews: z.boolean().default(false),
  }),
  options: z
    .object({
      detailLevel: z.enum(["fast", "full"]).optional(),
      includeColumnDefaults: z.boolean().optional(),
      includeColumnComments: z.boolean().optional(),
      includeIndexExpressions: z.boolean().optional(),
      useCache: z.boolean().optional(),
      cacheTtlSeconds: z.number().int().positive().optional(),
      maxObjectsPerPage: z.number().int().positive().optional(),
    })
    .optional(),
});

export type CreateSnapshotInput = z.infer<typeof createSnapshotSchema>;

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export class SnapshotService {
  private readonly snapshotRepo = AppDataSource.getRepository(SnapshotEntity);
  private readonly tableRepo = AppDataSource.getRepository(SnapshotTableEntity);
  private readonly columnRepo = AppDataSource.getRepository(SnapshotColumnEntity);
  private readonly indexRepo = AppDataSource.getRepository(SnapshotIndexEntity);

  constructor(
    private readonly instances: InstanceService,
    private readonly crm: CrmConnectorService,
  ) {}

  async createSnapshot(instanceId: string, input: unknown, correlationId: string): Promise<{ snapshotId: string; jobId: string; status: "QUEUED" }> {
    const parsed = createSnapshotSchema.safeParse(input);
    if (!parsed.success) {
      throw badRequest("Invalid request payload", { issues: parsed.error.issues });
    }
    const instance = await this.instances.getOrFail(instanceId);
    const payload = parsed.data;
    const metadataOptions: MetadataExportOptions = {
      detailLevel: payload.options?.detailLevel ?? env.CRM_METADATA_DETAIL_LEVEL,
      includeColumnDefaults:
        payload.options?.includeColumnDefaults ?? env.CRM_METADATA_INCLUDE_COLUMN_DEFAULTS,
      includeColumnComments:
        payload.options?.includeColumnComments ?? env.CRM_METADATA_INCLUDE_COLUMN_COMMENTS,
      includeIndexExpressions:
        payload.options?.includeIndexExpressions ?? env.CRM_METADATA_INCLUDE_INDEX_EXPRESSIONS,
      useCache: payload.options?.useCache ?? env.CRM_METADATA_USE_CACHE,
      cacheTtlSeconds: payload.options?.cacheTtlSeconds ?? env.CRM_METADATA_CACHE_TTL_SECONDS,
      maxObjectsPerPage:
        payload.options?.maxObjectsPerPage ?? env.CRM_METADATA_MAX_OBJECTS_PER_PAGE,
    };

    const snapshotId = uuidv4();
    const job = jobBus.createJob();

    await this.snapshotRepo.save(
      this.snapshotRepo.create({
        snapshotId,
        instanceId: instance.instanceId,
        schema: payload.schema,
        status: "QUEUED",
        jobId: job.jobId,
      }),
    );

    jobBus.run(job.jobId, async () => {
      try {
        await this.snapshotRepo.update({ snapshotId }, { status: "RUNNING" });
        jobBus.emit(job.jobId, "job.progress", { stage: "fetching_metadata" });
        const bundle = await this.crm.metadataExportAll(
          instance,
          {
            schema: payload.schema,
            include: { tables: true, columns: true, indexes: true },
            filters: {
              tableNameLike: payload.filters.tableNameLike ?? null,
              includeViews: payload.filters.includeViews,
              includeSystemIndexes: false,
            },
            options: metadataOptions,
          },
          correlationId,
        );

        const tableSpecs = normalizeBundleToTableSpecs(bundle);
        await this.persistSnapshotContent(snapshotId, tableSpecs);

        await this.snapshotRepo.update(
          { snapshotId },
          {
            status: "READY",
            completedAt: new Date(),
            statsTables: tableSpecs.length,
            statsColumns: tableSpecs.reduce((acc, t) => acc + t.columns.length, 0),
            statsIndexes: tableSpecs.reduce((acc, t) => acc + t.indexes.length, 0),
            errorMessage: null,
          },
        );
        jobBus.emit(job.jobId, "job.progress", { stage: "persisted", tables: tableSpecs.length });
      } catch (err) {
        await this.setSnapshotFailed(snapshotId, err instanceof Error ? err.message : "Unknown snapshot failure");
        throw err;
      }
    });

    return { snapshotId, jobId: job.jobId, status: "QUEUED" };
  }

  private async persistSnapshotContent(snapshotId: string, tables: TableSpec[]): Promise<void> {
    await this.tableRepo.delete({ snapshotId });
    await this.columnRepo.delete({ snapshotId });
    await this.indexRepo.delete({ snapshotId });

    const tableRows: SnapshotTableEntity[] = [];
    const columnRows: SnapshotColumnEntity[] = [];
    const indexRows: SnapshotIndexEntity[] = [];

    for (const table of tables) {
      tableRows.push(
        this.tableRepo.create({
          id: uuidv4(),
          snapshotId,
          tableKey: table.tableKey,
          schema: table.schema,
          name: table.name,
          isView: table.isView,
          comment: table.comment,
          storageJson: JSON.stringify(table.storage),
        }),
      );

      for (const column of table.columns) {
        columnRows.push(
          this.columnRepo.create({
            id: uuidv4(),
            snapshotId,
            tableKey: table.tableKey,
            columnKey: makeColumnKey(table.schema, table.name, column.name),
            name: column.name,
            ordinalPosition: column.ordinalPosition,
            canonicalType: column.canonicalType,
            nativeType: column.nativeType,
            length: column.length,
            precision: column.precision,
            scale: column.scale,
            nullable: column.nullable,
            defaultRaw: column.defaultRaw,
            comment: column.comment,
            charset: column.charset,
            collation: column.collation,
          }),
        );
      }

      for (const index of table.indexes) {
        indexRows.push(
          this.indexRepo.create({
            id: uuidv4(),
            snapshotId,
            tableKey: table.tableKey,
            indexKey: makeIndexKey(table.schema, table.name, index.name),
            name: index.name,
            unique: index.unique,
            indexType: index.indexType,
            columnsJson: JSON.stringify(index.columns),
            whereClause: index.whereClause,
            tablespace: index.tablespace,
          }),
        );
      }
    }

    if (tableRows.length > 0) await this.tableRepo.save(tableRows);
    if (columnRows.length > 0) await this.columnRepo.save(columnRows);
    if (indexRows.length > 0) await this.indexRepo.save(indexRows);
  }

  async getSnapshot(snapshotId: string): Promise<SnapshotEntity> {
    const snapshot = await this.snapshotRepo.findOne({ where: { snapshotId } });
    if (!snapshot) throw notFound(`Snapshot not found: ${snapshotId}`);
    return snapshot;
  }

  async listTables(
    snapshotId: string,
    query: {
      search: string | null;
      onlyDifferencesFromSnapshotId: string | null;
      offset: number;
      limit: number;
    },
  ): Promise<{ total: number; items: Array<{ tableKey: string; schema: string; name: string; isView: boolean }> }> {
    const rows = await this.tableRepo.find({ where: { snapshotId } });

    const details = new Map<string, SnapshotTableEntity>();
    for (const row of rows) details.set(row.tableKey, row);

    let filteredKeys = [...details.keys()];
    if (query.search) {
      const search = query.search.toUpperCase();
      filteredKeys = filteredKeys.filter((k) => k.includes(search));
    }

    if (query.onlyDifferencesFromSnapshotId) {
      const baseMap = await this.tableMapForSnapshot(query.onlyDifferencesFromSnapshotId);
      const curMap = await this.tableMapForSnapshot(snapshotId);
      filteredKeys = filteredKeys.filter((key) => {
        const base = baseMap.get(key) ?? null;
        const cur = curMap.get(key) ?? null;
        if (!base || !cur) return true;
        return hasDifference(compareTable(base, cur, { ignoreIndexName: false, ignoreColumnOrder: false }));
      });
    }

    filteredKeys.sort((a, b) => a.localeCompare(b));
    const total = filteredKeys.length;
    const items = filteredKeys.slice(query.offset, query.offset + query.limit).map((tableKey) => {
      const row = details.get(tableKey)!;
      return {
        tableKey: row.tableKey,
        schema: row.schema,
        name: row.name,
        isView: row.isView,
      };
    });
    return { total, items };
  }

  async getTable(snapshotId: string, tableKey: string): Promise<TableSpec> {
    const normalizedKey = normalizeTableKey(tableKey);
    const table = await this.tableRepo.findOne({
      where: { snapshotId, tableKey: normalizedKey },
    });
    if (!table) throw notFound(`Table not found: ${tableKey}`);

    const columns = await this.columnRepo.find({
      where: { snapshotId, tableKey: normalizedKey },
      order: { ordinalPosition: "ASC" },
    });
    const indexes = await this.indexRepo.find({
      where: { snapshotId, tableKey: normalizedKey },
      order: { name: "ASC" },
    });

    return {
      schema: table.schema,
      name: table.name,
      tableKey: table.tableKey,
      isView: table.isView,
      comment: table.comment,
      storage: parseJson(table.storageJson, { engine: null, tablespace: null }),
      columns: columns.map((c) => ({
        name: c.name,
        ordinalPosition: c.ordinalPosition,
        canonicalType: c.canonicalType as TableSpec["columns"][number]["canonicalType"],
        nativeType: c.nativeType,
        length: c.length,
        precision: c.precision,
        scale: c.scale,
        nullable: c.nullable,
        defaultRaw: c.defaultRaw,
        comment: c.comment,
        charset: c.charset,
        collation: c.collation,
      })),
      indexes: indexes.map((i) => ({
        name: i.name,
        unique: i.unique,
        indexType: i.indexType,
        columns: parseJson(i.columnsJson, []),
        whereClause: i.whereClause,
        tablespace: i.tablespace,
      })),
    };
  }

  async tableMapForSnapshot(snapshotId: string): Promise<Map<string, TableSpec>> {
    const tables = await this.tableRepo.find({ where: { snapshotId }, order: { tableKey: "ASC" } });
    const columns = await this.columnRepo.find({ where: { snapshotId }, order: { ordinalPosition: "ASC" } });
    const indexes = await this.indexRepo.find({ where: { snapshotId }, order: { name: "ASC" } });

    const columnsByTable = new Map<string, SnapshotColumnEntity[]>();
    const indexesByTable = new Map<string, SnapshotIndexEntity[]>();

    for (const c of columns) {
      const arr = columnsByTable.get(c.tableKey) ?? [];
      arr.push(c);
      columnsByTable.set(c.tableKey, arr);
    }
    for (const i of indexes) {
      const arr = indexesByTable.get(i.tableKey) ?? [];
      arr.push(i);
      indexesByTable.set(i.tableKey, arr);
    }

    const map = new Map<string, TableSpec>();
    for (const t of tables) {
      map.set(t.tableKey, {
        schema: t.schema,
        name: t.name,
        tableKey: t.tableKey,
        isView: t.isView,
        comment: t.comment,
        storage: parseJson(t.storageJson, { engine: null, tablespace: null }),
        columns: (columnsByTable.get(t.tableKey) ?? []).map((c) => ({
          name: c.name,
          ordinalPosition: c.ordinalPosition,
          canonicalType: c.canonicalType as TableSpec["columns"][number]["canonicalType"],
          nativeType: c.nativeType,
          length: c.length,
          precision: c.precision,
          scale: c.scale,
          nullable: c.nullable,
          defaultRaw: c.defaultRaw,
          comment: c.comment,
          charset: c.charset,
          collation: c.collation,
        })),
        indexes: (indexesByTable.get(t.tableKey) ?? []).map((i) => ({
          name: i.name,
          unique: i.unique,
          indexType: i.indexType,
          columns: parseJson(i.columnsJson, []),
          whereClause: i.whereClause,
          tablespace: i.tablespace,
        })),
      });
    }
    return map;
  }

  async findLatestSnapshotIdByInstance(instanceId: string): Promise<string | null> {
    const latest = await this.snapshotRepo.findOne({
      where: { instanceId, status: "READY" },
      order: { createdAt: "DESC" },
    });
    return latest?.snapshotId ?? null;
  }

  async setSnapshotFailed(snapshotId: string, message: string): Promise<void> {
    await this.snapshotRepo.update(
      { snapshotId },
      {
        status: "FAILED",
        errorMessage: message,
        completedAt: new Date(),
      },
    );
  }
}

const normalizeTableKey = (tableKey: string): string => {
  const [schema, name] = tableKey.split(".");
  if (!schema || !name) throw badRequest("tableKey must be SCHEMA.TABLE");
  return makeTableKey(schema, name);
};
