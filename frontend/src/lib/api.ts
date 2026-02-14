import type {
  ApiErrorBody,
  AuditResult,
  ChangeSetDetail,
  ChangeSetSummary,
  ChangeStep,
  CompareDetailsResponse,
  CompareMatrixResponse,
  ExecutionDetail,
  InstanceItem,
  SnapshotSummary,
  TableSpec,
} from "./types";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId: string | null;
  readonly details: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error.message ?? fallback);
    this.name = "ApiClientError";
    this.status = status;
    this.code = body?.error.code ?? "UNKNOWN";
    this.correlationId = body?.correlationId ?? null;
    this.details = (body?.error.details as Record<string, unknown>) ?? {};
  }
}

const randomCorrelationId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `cid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const toQuery = (input: Record<string, string | number | boolean | null | undefined>): string => {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === null || typeof value === "undefined") continue;
    qs.set(key, String(value));
  }
  const text = qs.toString();
  return text ? `?${text}` : "";
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | null;

  constructor(baseUrl: string, getToken: () => string | null) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.getToken = getToken;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    parse: "json" | "text" = "json",
  ): Promise<T> {
    const token = this.getToken();
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("X-Correlation-Id", randomCorrelationId());
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json; charset=utf-8");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });

    if (!res.ok) {
      let body: ApiErrorBody | null = null;
      try {
        body = (await res.json()) as ApiErrorBody;
      } catch {
        body = null;
      }
      throw new ApiClientError(res.status, body, `Request failed: ${res.status}`);
    }

    if (parse === "text") return (await res.text()) as T;
    return (await res.json()) as T;
  }

  listInstances(): Promise<{ correlationId: string; items: InstanceItem[] }> {
    return this.request("/instances");
  }

  createInstance(body: {
    name: string;
    environment: string;
    crmBaseUrl: string;
    dbType: "oracle" | "mariadb";
    defaultSchema: string;
    capabilities: { read: boolean; write: boolean };
    authRef: string | null;
  }): Promise<{ correlationId: string; item: InstanceItem & { authRef: string | null } }> {
    return this.request("/instances", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  updateInstance(
    instanceId: string,
    body: Partial<{
      name: string;
      environment: string;
      crmBaseUrl: string;
      dbType: "oracle" | "mariadb";
      defaultSchema: string;
      capabilities: { read: boolean; write: boolean };
      authRef: string | null;
    }>,
  ): Promise<{ correlationId: string; item: InstanceItem & { authRef: string | null } }> {
    return this.request(`/instances/${encodeURIComponent(instanceId)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  createSnapshot(
    instanceId: string,
    body: {
      schema: string;
      filters: { tableNameLike: string | null; includeViews: boolean };
      options?: {
        detailLevel?: "fast" | "full";
        includeColumnDefaults?: boolean;
        includeColumnComments?: boolean;
        includeIndexExpressions?: boolean;
        useCache?: boolean;
        cacheTtlSeconds?: number;
        maxObjectsPerPage?: number;
      };
    },
  ): Promise<{ correlationId: string; jobId: string; snapshotId: string; status: "QUEUED" }> {
    return this.request(`/instances/${encodeURIComponent(instanceId)}/snapshots`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  getSnapshot(snapshotId: string): Promise<SnapshotSummary & { correlationId: string }> {
    return this.request(`/snapshots/${encodeURIComponent(snapshotId)}`);
  }

  listSnapshotTables(
    snapshotId: string,
    params: {
      search?: string;
      onlyDifferencesFromSnapshotId?: string;
      offset?: number;
      limit?: number;
    },
  ): Promise<{
    correlationId: string;
    total: number;
    items: Array<{ tableKey: string; schema: string; name: string; isView: boolean }>;
  }> {
    return this.request(
      `/snapshots/${encodeURIComponent(snapshotId)}/tables${toQuery({
        search: params.search,
        onlyDifferencesFromSnapshotId: params.onlyDifferencesFromSnapshotId,
        offset: params.offset ?? 0,
        limit: params.limit ?? 200,
      })}`,
    );
  }

  getSnapshotTable(snapshotId: string, tableKey: string): Promise<{ correlationId: string; table: TableSpec }> {
    return this.request(
      `/snapshots/${encodeURIComponent(snapshotId)}/tables/${encodeURIComponent(tableKey)}`,
    );
  }

  createCompareRun(body: {
    baselineSnapshotId: string;
    snapshotIds: string[];
    options: { matchIndexByDefinition: boolean; ignoreIndexName: boolean; ignoreColumnOrder: boolean };
  }): Promise<{ correlationId: string; compareRunId: string; status: string; createdAt: string }> {
    return this.request("/compare-runs", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  getCompareMatrix(
    compareRunId: string,
    params: {
      level?: "table";
      onlyDifferences?: boolean;
      search?: string;
      offset: number;
      limit: number;
    },
  ): Promise<CompareMatrixResponse> {
    return this.request(
      `/compare-runs/${encodeURIComponent(compareRunId)}/matrix${toQuery({
        level: params.level ?? "table",
        onlyDifferences: params.onlyDifferences ?? false,
        search: params.search,
        offset: params.offset,
        limit: params.limit,
      })}`,
    );
  }

  getCompareDetails(compareRunId: string, tableKey: string): Promise<CompareDetailsResponse> {
    return this.request(
      `/compare-runs/${encodeURIComponent(compareRunId)}/details${toQuery({ tableKey })}`,
    );
  }

  listChangeSets(): Promise<{ correlationId: string; items: ChangeSetSummary[] }> {
    return this.request("/changesets");
  }

  createChangeSet(body: {
    title: string;
    description?: string | null;
    sourceCompareRunId?: string | null;
  }): Promise<{ correlationId: string; changeSetId: string; status: "DRAFT" }> {
    return this.request("/changesets", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  getChangeSet(changeSetId: string): Promise<{ correlationId: string } & ChangeSetDetail> {
    return this.request(`/changesets/${encodeURIComponent(changeSetId)}`);
  }

  addChangeSetSteps(
    changeSetId: string,
    body: { append: boolean; steps: ChangeStep[] },
  ): Promise<{ correlationId: string; steps: ChangeStep[] }> {
    return this.request(`/changesets/${encodeURIComponent(changeSetId)}/steps`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  planFromCompare(
    changeSetId: string,
    body: {
      compareRunId: string;
      tableKeys: string[];
      targets: { baselineInstanceId: string; targetInstanceIds: string[] };
      include: { tables: boolean; columns: boolean; indexes: boolean };
      strategy: { alignToBaseline: boolean; allowDestructive: boolean };
    },
  ): Promise<{ correlationId: string; steps: ChangeStep[] }> {
    return this.request(`/changesets/${encodeURIComponent(changeSetId)}/plan/from-compare`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  validateChangeSet(
    changeSetId: string,
    body: {
      targetInstanceIds: string[];
      options: { returnSqlPreview: boolean; strict: boolean };
    },
  ): Promise<{
    correlationId: string;
    overallValid: boolean;
    perTarget: Record<string, { valid: boolean; results: unknown[] }>;
  }> {
    return this.request(`/changesets/${encodeURIComponent(changeSetId)}/validate`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  executeChangeSet(
    changeSetId: string,
    body: { targetInstanceIds: string[]; options: { stopOnError: boolean } },
  ): Promise<{
    correlationId: string;
    executionIds: Array<{ instanceId: string; executionId: string; jobId: string }>;
  }> {
    return this.request(`/changesets/${encodeURIComponent(changeSetId)}/execute`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  getExecution(executionId: string): Promise<{ correlationId: string } & ExecutionDetail> {
    return this.request(`/executions/${encodeURIComponent(executionId)}`);
  }

  getJobEventsUrl(jobId: string): string {
    return `${this.baseUrl}/jobs/${encodeURIComponent(jobId)}/events`;
  }

  searchAudit(params: {
    tableKey?: string;
    user?: string;
    from?: string;
    to?: string;
    offset?: number;
    limit?: number;
  }): Promise<{ correlationId: string } & AuditResult> {
    return this.request(
      `/audit${toQuery({
        tableKey: params.tableKey,
        user: params.user,
        from: params.from,
        to: params.to,
        offset: params.offset ?? 0,
        limit: params.limit ?? 200,
      })}`,
    );
  }
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1";

let tokenGetter: () => string | null = () => null;

export const configureTokenGetter = (getter: () => string | null): void => {
  tokenGetter = getter;
};

export const api = new ApiClient(baseUrl, () => tokenGetter());
