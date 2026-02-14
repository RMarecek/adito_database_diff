import axios, { type AxiosInstance } from "axios";
import { badRequest } from "../../common/errors";
import { env } from "../../config/env";
import type { InstanceEntity } from "../instances/instance.entity";
import type { ChangeStep } from "../schema/types";
import type { MetadataBundle } from "../schema/normalize";

export interface MetadataExportOptions {
  detailLevel?: "fast" | "full";
  includeColumnDefaults?: boolean;
  includeColumnComments?: boolean;
  includeIndexExpressions?: boolean;
  useCache?: boolean;
  cacheTtlSeconds?: number;
  maxObjectsPerPage?: number;
}

interface MetadataExportRequest {
  schema: string;
  include: { tables: boolean; columns: boolean; indexes: boolean };
  filters: {
    tableNameLike: string | null;
    tableNames?: string[] | null;
    includeViews: boolean;
    includeSystemIndexes?: boolean;
  };
  options?: MetadataExportOptions;
  page: { pageSize: number; pageToken: string | null };
}

interface DdlValidateRequest {
  schema: string;
  steps: ChangeStep[];
  options: { returnSqlPreview: boolean; strict: boolean };
}

interface DdlExecuteRequest {
  requestId: string;
  schema: string;
  changeSet: { id: string; title: string };
  steps: ChangeStep[];
  options: { stopOnError: boolean; lockTimeoutSeconds?: number };
}

export class CrmConnectorService {
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      timeout: env.CRM_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }

  private actionUrl(base: string, action: string, extra: Record<string, string | undefined> = {}): string {
    const trimmed = base.trim().replace(/\/+$/, "");
    const endpoint = trimmed.endsWith("/database_rest")
      ? trimmed
      : `${trimmed}/database_rest`;
    const url = new URL(endpoint);
    url.searchParams.set("action", action);
    for (const [key, value] of Object.entries(extra)) {
      if (value) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private authHeader(instance: InstanceEntity): Record<string, string> {
    // authRef can point to a secret provider; this is an MVP passthrough fallback.
    return instance.authRef ? { Authorization: `Bearer ${instance.authRef}` } : {};
  }

  private isGatewayTimeout(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 504;
  }

  async dbInfo(instance: InstanceEntity, correlationId: string): Promise<{ type: "oracle" | "mariadb"; version: string; defaultSchema: string }> {
    const url = this.actionUrl(instance.crmBaseUrl, "db_info");
    const res = await this.http.get(url, {
      headers: { ...this.authHeader(instance), "X-Correlation-Id": correlationId },
    });
    return res.data.db;
  }

  async metadataExportAll(
    instance: InstanceEntity,
    request: Omit<MetadataExportRequest, "page">,
    correlationId: string,
  ): Promise<MetadataBundle> {
    const tables: MetadataBundle["tables"] = [];
    const columns: MetadataBundle["columns"] = [];
    const indexes: MetadataBundle["indexes"] = [];

    let nextPageToken: string | null = null;
    let db: MetadataBundle["db"] | null = null;
    let pageSize = Math.max(
      10,
      Math.min(env.CRM_METADATA_PAGE_SIZE, request.options?.maxObjectsPerPage ?? 200, 200),
    );

    do {
      let fetched = false;
      while (!fetched) {
        const body: MetadataExportRequest = {
          ...request,
          page: {
            pageSize,
            pageToken: nextPageToken,
          },
        };

        try {
          const url = this.actionUrl(instance.crmBaseUrl, "metadata_export");
          const res = await this.http.post(url, body, {
            headers: { ...this.authHeader(instance), "X-Correlation-Id": correlationId },
          });

          db = res.data.db ?? db;
          tables.push(
            ...(Array.isArray(res.data.tables) ? res.data.tables : []).map((row: Record<string, unknown>) => ({
              schema: String(row.schema ?? ""),
              name: String(row.name ?? ""),
              isView: Boolean(row.isView ?? false),
              comment: (row.comment as string | null | undefined) ?? null,
              storage: {
                engine: ((row.storage as { engine?: string | null } | null | undefined)?.engine ?? null) as string | null,
                tablespace: ((row.storage as { tablespace?: string | null } | null | undefined)?.tablespace ?? null) as string | null,
              },
            })),
          );
          columns.push(
            ...(Array.isArray(res.data.columns) ? res.data.columns : []).map((row: Record<string, unknown>) => ({
              schema: String(row.schema ?? ""),
              table: String(row.table ?? ""),
              name: String(row.name ?? ""),
              ordinalPosition: Number(row.ordinalPosition ?? 0),
              nativeType: String(row.nativeType ?? ""),
              canonicalType: (row.canonicalType as MetadataBundle["columns"][number]["canonicalType"] | null | undefined) ?? null,
              length: row.length == null ? null : Number(row.length),
              precision: row.precision == null ? null : Number(row.precision),
              scale: row.scale == null ? null : Number(row.scale),
              nullable: Boolean(row.nullable ?? true),
              defaultRaw: (row.defaultRaw as string | null | undefined) ?? null,
              comment: (row.comment as string | null | undefined) ?? null,
              charset: (row.charset as string | null | undefined) ?? null,
              collation: (row.collation as string | null | undefined) ?? null,
            })),
          );
          indexes.push(
            ...(Array.isArray(res.data.indexes) ? res.data.indexes : []).map((row: Record<string, unknown>) => ({
              schema: String(row.schema ?? ""),
              table: String(row.table ?? ""),
              name: String(row.name ?? ""),
              unique: Boolean(row.unique ?? false),
              indexType: String(row.indexType ?? "BTREE"),
              tablespace: (row.tablespace as string | null | undefined) ?? null,
              whereClause: (row.whereClause as string | null | undefined) ?? null,
              columns: (Array.isArray(row.columns) ? row.columns : []).map((col: Record<string, unknown>) => ({
                name: String(col.name ?? ""),
                position: Number(col.position ?? 0),
                direction: col.direction === "DESC" ? "DESC" : "ASC",
                expression: (col.expression as string | null | undefined) ?? null,
              })),
            })),
          );
          nextPageToken = res.data.page?.nextPageToken ?? null;
          fetched = true;
        } catch (error) {
          if (this.isGatewayTimeout(error) && pageSize > 10) {
            pageSize = Math.max(10, Math.floor(pageSize / 2));
            continue;
          }
          throw error;
        }
      }
    } while (nextPageToken);

    if (!db) throw badRequest("CRM metadata_export returned no db metadata");

    return { db, tables, columns, indexes };
  }

  async ddlValidate(
    instance: InstanceEntity,
    request: DdlValidateRequest,
    correlationId: string,
  ): Promise<unknown> {
    const url = this.actionUrl(instance.crmBaseUrl, "ddl_validate");
    const res = await this.http.post(url, request, {
      headers: { ...this.authHeader(instance), "X-Correlation-Id": correlationId },
    });
    return res.data;
  }

  async ddlExecute(
    instance: InstanceEntity,
    request: DdlExecuteRequest,
    correlationId: string,
  ): Promise<{ executionId: string; status: string; submittedAt: string }> {
    const url = this.actionUrl(instance.crmBaseUrl, "ddl_execute");
    const res = await this.http.post(url, request, {
      headers: { ...this.authHeader(instance), "X-Correlation-Id": correlationId },
    });
    return {
      executionId: String(res.data.executionId),
      status: String(res.data.status),
      submittedAt: String(res.data.submittedAt),
    };
  }

  async ddlExecutionStatus(
    instance: InstanceEntity,
    executionId: string,
    correlationId: string,
  ): Promise<unknown> {
    const url = this.actionUrl(instance.crmBaseUrl, "ddl_execution_status", {
      executionId,
    });
    const res = await this.http.get(url, {
      headers: { ...this.authHeader(instance), "X-Correlation-Id": correlationId },
    });
    return res.data;
  }

  async ddlExecutionLogs(
    instance: InstanceEntity,
    executionId: string,
    afterIso: string | null,
    correlationId: string,
  ): Promise<{ items: Array<{ time: string; level: string; message: string }> }> {
    const url = this.actionUrl(instance.crmBaseUrl, "ddl_execution_logs", {
      executionId,
      after: afterIso ?? undefined,
    });
    const res = await this.http.get(url, {
      headers: { ...this.authHeader(instance), "X-Correlation-Id": correlationId },
    });
    return { items: res.data.items ?? [] };
  }
}
