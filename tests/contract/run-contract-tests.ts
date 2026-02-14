import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { startMockCrmGateway } from "./mock-crm-gateway";
import { InMemoryRepository } from "./in-memory-repo";
import { oracleFixture } from "../fixtures/oracle-fixture";
import { mariadbFixture } from "../fixtures/mariadb-fixture";

interface HttpResult<T> {
  status: number;
  body: T;
  headers: Headers;
}

interface TestContext {
  baseUrl: string;
  token: string;
  close: () => Promise<void>;
}

type StepAction =
  | "CREATE_TABLE"
  | "DROP_TABLE"
  | "ADD_COLUMN"
  | "DROP_COLUMN"
  | "ALTER_COLUMN"
  | "RENAME_TABLE"
  | "RENAME_COLUMN"
  | "CREATE_INDEX"
  | "DROP_INDEX";

interface ChangeStepInput {
  stepId: string;
  action: StepAction;
  target: { schema: string; table: string };
  table: null;
  column: {
    name: string;
    ordinalPosition: number;
    canonicalType: string;
    nativeType: string;
    length: number | null;
    precision: number | null;
    scale: number | null;
    nullable: boolean;
    defaultRaw: string | null;
    comment: string | null;
    charset: string | null;
    collation: string | null;
  } | null;
  index: null;
  options: Record<string, unknown> | null;
}

const workspaceRoot = process.cwd();

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const makeCorrelationId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const requestJson = async <T>(
  context: TestContext,
  method: "GET" | "POST",
  pathname: string,
  body?: unknown,
): Promise<HttpResult<T>> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${context.token}`,
    "X-Correlation-Id": makeCorrelationId(),
    Accept: "application/json",
  };
  if (typeof body !== "undefined") {
    headers["Content-Type"] = "application/json; charset=utf-8";
  }

  const response = await fetch(`${context.baseUrl}${pathname}`, {
    method,
    headers,
    body: typeof body === "undefined" ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as T;
  return {
    status: response.status,
    body: data,
    headers: response.headers,
  };
};

const waitFor = async <T>(
  producer: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> => {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 500;
  const started = Date.now();
  while (true) {
    const value = await producer();
    if (predicate(value)) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await wait(intervalMs);
  }
};

const createTestContext = async (): Promise<{
  context: TestContext;
  oracleGateway: Awaited<ReturnType<typeof startMockCrmGateway>>;
  mariadbGateway: Awaited<ReturnType<typeof startMockCrmGateway>>;
}> => {
  const dbDir = path.resolve(workspaceRoot, "tests", "tmp");
  const dbPath = path.resolve(dbDir, "contract-tests.sqlite");
  await fs.mkdir(dbDir, { recursive: true });
  await fs.rm(dbPath, { force: true });

  process.env.NODE_ENV = "test";
  process.env.AUTH_REQUIRED = "true";
  process.env.JWT_SECRET = "contract-secret";
  process.env.JWT_AUDIENCE = "schema-compare";
  process.env.JWT_ISSUER = "schema-compare-api";
  process.env.DB_TYPE = "oracle";
  process.env.DB_HOST = "127.0.0.1";
  process.env.DB_PORT = "1521";
  process.env.DB_USERNAME = "contract";
  process.env.DB_PASSWORD = "contract";
  process.env.DB_DATABASE = "contract";
  process.env.DB_SID = "ORCLCDB";
  process.env.DB_SERVICE_NAME = "";
  process.env.DB_SYNCHRONIZE = "false";
  process.env.DB_LOGGING = "false";
  process.env.SQLITE_PATH = dbPath;
  process.env.CRM_TIMEOUT_MS = "10000";

  const oracleGateway = await startMockCrmGateway(oracleFixture);
  const mariadbGateway = await startMockCrmGateway(mariadbFixture);

  const { AppDataSource } = await import("../../src/config/data-source");
  const { InstanceEntity } = await import("../../src/modules/instances/instance.entity");
  const { SnapshotEntity } = await import("../../src/modules/snapshots/snapshot.entity");
  const { SnapshotTableEntity } = await import("../../src/modules/snapshots/snapshot-table.entity");
  const { SnapshotColumnEntity } = await import("../../src/modules/snapshots/snapshot-column.entity");
  const { SnapshotIndexEntity } = await import("../../src/modules/snapshots/snapshot-index.entity");
  const { CompareRunEntity } = await import("../../src/modules/compare/compare-run.entity");
  const { ChangeSetEntity } = await import("../../src/modules/changesets/changeset.entity");
  const { ChangeSetStepEntity } = await import("../../src/modules/changesets/changeset-step.entity");
  const { ExecutionEntity } = await import("../../src/modules/executions/execution.entity");
  const { ExecutionLogEntity } = await import("../../src/modules/executions/execution-log.entity");
  const { AuditEventEntity } = await import("../../src/modules/audit/audit-event.entity");

  const repositoryMap = new Map<unknown, InMemoryRepository<Record<string, unknown>>>([
    [InstanceEntity, new InMemoryRepository(["instanceId"])],
    [SnapshotEntity, new InMemoryRepository(["snapshotId"])],
    [SnapshotTableEntity, new InMemoryRepository(["id"])],
    [SnapshotColumnEntity, new InMemoryRepository(["id"])],
    [SnapshotIndexEntity, new InMemoryRepository(["id"])],
    [CompareRunEntity, new InMemoryRepository(["compareRunId"])],
    [ChangeSetEntity, new InMemoryRepository(["changeSetId"])],
    [ChangeSetStepEntity, new InMemoryRepository(["stepId"])],
    [ExecutionEntity, new InMemoryRepository(["executionId"])],
    [ExecutionLogEntity, new InMemoryRepository(["id"])],
    [AuditEventEntity, new InMemoryRepository(["id"])],
  ]);

  (AppDataSource as unknown as { getRepository: (entity: unknown) => InMemoryRepository<Record<string, unknown>> })
    .getRepository = (entity: unknown): InMemoryRepository<Record<string, unknown>> => {
    const repo = repositoryMap.get(entity);
    if (!repo) throw new Error(`No in-memory repository registered for entity ${String(entity)}`);
    return repo;
  };

  const { createApp } = await import("../../src/app");
  const app = createApp();
  const server = await new Promise<Server>((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  const port = (server.address() as AddressInfo).port;

  const token = jwt.sign(
    {
      sub: "contract-tester",
      roles: ["viewer", "editor", "executor", "approver", "admin"],
    },
    "contract-secret",
    {
      issuer: "schema-compare-api",
      audience: "schema-compare",
      expiresIn: "1h",
    },
  );

  return {
    context: {
      baseUrl: `http://127.0.0.1:${port}/api/v1`,
      token,
      close: async () => {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      },
    },
    oracleGateway,
    mariadbGateway,
  };
};

const createInstance = async (
  context: TestContext,
  input: {
    name: string;
    environment: string;
    crmBaseUrl: string;
    dbType: "oracle" | "mariadb";
    defaultSchema: string;
  },
): Promise<string> => {
  const response = await requestJson<{ item: { instanceId: string } }>(context, "POST", "/instances", {
    ...input,
    capabilities: { read: true, write: true },
    authRef: "mock-auth-token",
  });
  assert.equal(response.status, 201);
  return response.body.item.instanceId;
};

const startSnapshot = async (context: TestContext, instanceId: string, schema: string): Promise<string> => {
  const queued = await requestJson<{ snapshotId: string; status: string }>(
    context,
    "POST",
    `/instances/${instanceId}/snapshots`,
    {
      schema,
      filters: { tableNameLike: null, includeViews: false },
    },
  );
  assert.equal(queued.status, 202);
  assert.equal(queued.body.status, "QUEUED");
  return queued.body.snapshotId;
};

const getSnapshot = async (
  context: TestContext,
  snapshotId: string,
): Promise<{
  snapshotId: string;
  status: "QUEUED" | "RUNNING" | "READY" | "FAILED";
  stats: { tables: number; columns: number; indexes: number };
}> => {
  const result = await requestJson<{
    snapshotId: string;
    status: "QUEUED" | "RUNNING" | "READY" | "FAILED";
    stats: { tables: number; columns: number; indexes: number };
  }>(context, "GET", `/snapshots/${snapshotId}`);
  assert.equal(result.status, 200);
  return result.body;
};

const createBaselineChangeStep = (): ChangeStepInput => ({
  stepId: "11111111-1111-4111-8111-111111111111",
  action: "ADD_COLUMN",
  target: { schema: "CRM", table: "CUSTOMERS" },
  table: null,
  column: {
    name: "NEW_COL",
    ordinalPosition: 99,
    canonicalType: "STRING",
    nativeType: "VARCHAR2(120 CHAR)",
    length: 120,
    precision: null,
    scale: null,
    nullable: true,
    defaultRaw: null,
    comment: null,
    charset: null,
    collation: null,
  },
  index: null,
  options: { ifNotExists: true },
});

const run = async (): Promise<void> => {
  const { context, oracleGateway, mariadbGateway } = await createTestContext();
  let failed = 0;
  const report = (name: string, error?: unknown): void => {
    if (!error) {
      // eslint-disable-next-line no-console
      console.log(`PASS: ${name}`);
      return;
    }
    failed += 1;
    // eslint-disable-next-line no-console
    console.error(`FAIL: ${name}`);
    // eslint-disable-next-line no-console
    console.error(error);
  };

  try {
    const oracleInstanceId = await createInstance(context, {
      name: "ORACLE-QA",
      environment: "qa",
      crmBaseUrl: oracleGateway.baseUrl,
      dbType: "oracle",
      defaultSchema: "CRM",
    });
    const mariadbInstanceId = await createInstance(context, {
      name: "MARIADB-QA",
      environment: "qa",
      crmBaseUrl: mariadbGateway.baseUrl,
      dbType: "mariadb",
      defaultSchema: "crm",
    });

    try {
      const snapshotId = await startSnapshot(context, oracleInstanceId, "CRM");
      const ready = await waitFor(
        () => getSnapshot(context, snapshotId),
        (snapshot) => snapshot.status === "READY",
      );

      assert.equal(ready.stats.tables, oracleFixture.tables.length);
      assert.equal(ready.stats.columns, oracleFixture.columns.length);
      assert.equal(ready.stats.indexes, oracleFixture.indexes.length);
      assert.ok(oracleGateway.calls.metadataExport.length >= 4);
      const firstMetadataCallPage = (oracleGateway.calls.metadataExport[0]?.body.page ?? null) as
        | { pageToken?: string | null }
        | null;
      assert.equal(firstMetadataCallPage?.pageToken ?? null, null);
      const firstMetadataCallOptions = (oracleGateway.calls.metadataExport[0]?.body.options ?? null) as
        | { detailLevel?: string; includeColumnDefaults?: boolean; maxObjectsPerPage?: number }
        | null;
      assert.equal(firstMetadataCallOptions?.detailLevel ?? null, "fast");
      assert.equal(firstMetadataCallOptions?.includeColumnDefaults ?? null, false);
      report("snapshot job consumes CRM metadata paging (Oracle)");
    } catch (error) {
      report("snapshot job consumes CRM metadata paging (Oracle)", error);
    }

    try {
      const snapshotId = await startSnapshot(context, mariadbInstanceId, "crm");
      const ready = await waitFor(
        () => getSnapshot(context, snapshotId),
        (snapshot) => snapshot.status === "READY",
      );
      assert.equal(ready.stats.tables, mariadbFixture.tables.length);
      assert.equal(ready.stats.columns, mariadbFixture.columns.length);
      assert.equal(ready.stats.indexes, mariadbFixture.indexes.length);
      assert.ok(mariadbGateway.calls.metadataExport.length >= 4);

      const tableResult = await requestJson<{
        table: { schema: string; name: string; columns: Array<{ nativeType: string }> };
      }>(context, "GET", `/snapshots/${snapshotId}/tables/CRM.CUSTOMERS`);
      assert.equal(tableResult.status, 200);
      assert.equal(tableResult.body.table.schema, "CRM");
      assert.ok(tableResult.body.table.columns.some((column) => column.nativeType.toLowerCase().includes("varchar")));
      report("snapshot fixtures cover MariaDB metadata shape");
    } catch (error) {
      report("snapshot fixtures cover MariaDB metadata shape", error);
    }

    let changeSetId = "";
    try {
      const created = await requestJson<{ changeSetId: string }>(context, "POST", "/changesets", {
        title: "Contract Validate Execute",
        description: "contract test",
      });
      assert.equal(created.status, 201);
      changeSetId = created.body.changeSetId;

      const steps = [createBaselineChangeStep()];
      const update = await requestJson<{ steps: ChangeStepInput[] }>(
        context,
        "POST",
        `/changesets/${changeSetId}/steps`,
        {
          append: true,
          steps,
        },
      );
      assert.equal(update.status, 200);
      assert.equal(update.body.steps.length, 1);
      report("changeset setup for validate/execute");
    } catch (error) {
      report("changeset setup for validate/execute", error);
    }

    try {
      const validate = await requestJson<{
        overallValid: boolean;
        perTarget: Record<string, { valid: boolean; results: unknown[] }>;
      }>(
        context,
        "POST",
        `/changesets/${changeSetId}/validate`,
        {
          targetInstanceIds: [oracleInstanceId],
          options: { returnSqlPreview: true, strict: true },
        },
      );
      assert.equal(validate.status, 200);
      assert.equal(validate.body.overallValid, true);
      assert.ok(validate.body.perTarget[oracleInstanceId]?.valid);
      assert.ok(oracleGateway.calls.validate.length >= 1);
      const forwarded = oracleGateway.calls.validate[oracleGateway.calls.validate.length - 1]?.body;
      assert.equal(forwarded.schema, "CRM");
      assert.equal((forwarded.steps as Array<{ action: string }>)[0]?.action, "ADD_COLUMN");
      report("backend validate forwards steps to CRM validate");
    } catch (error) {
      report("backend validate forwards steps to CRM validate", error);
    }

    try {
      const execute = await requestJson<{
        executionIds: Array<{ instanceId: string; executionId: string; jobId: string }>;
      }>(
        context,
        "POST",
        `/changesets/${changeSetId}/execute`,
        {
          targetInstanceIds: [oracleInstanceId],
          options: { stopOnError: true },
        },
      );
      assert.equal(execute.status, 202);
      assert.equal(execute.body.executionIds.length, 1);
      const executionId = execute.body.executionIds[0].executionId;

      const done = await waitFor(
        async () =>
          requestJson<{
            status: string;
            logs: Array<{ time: string; level: string; message: string }>;
          }>(context, "GET", `/executions/${executionId}`),
        (value) => value.body.status === "SUCCEEDED",
        { timeoutMs: 20_000, intervalMs: 800 },
      );
      assert.equal(done.status, 200);
      assert.equal(done.body.status, "SUCCEEDED");
      assert.ok(done.body.logs.length > 0);

      assert.ok(oracleGateway.calls.execute.length >= 1);
      assert.ok(oracleGateway.calls.status.length >= 1);
      assert.ok(oracleGateway.calls.logs.length >= 1);
      report("backend execute starts CRM execution and tracks status/logs");
    } catch (error) {
      report("backend execute starts CRM execution and tracks status/logs", error);
    }
  } finally {
    await context.close();
    await oracleGateway.close();
    await mariadbGateway.close();
  }

  if (failed > 0) {
    process.exitCode = 1;
    // eslint-disable-next-line no-console
    console.error(`\n${failed} contract test(s) failed`);
  } else {
    // eslint-disable-next-line no-console
    console.log("\nAll contract tests passed");
  }
};

void run();
