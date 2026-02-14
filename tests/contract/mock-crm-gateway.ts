import express, { type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { CrmFixture } from "../fixtures/types";

type ExecutionStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

interface MockExecution {
  executionId: string;
  submittedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  status: ExecutionStatus;
  steps: Array<{ stepId: string; action: string; target?: { schema?: string; table?: string } }>;
  logs: Array<{ time: string; level: string; message: string }>;
}

export interface MockCrmCallLog {
  health: number;
  dbInfo: number;
  metadataExport: Array<{ body: Record<string, unknown> }>;
  validate: Array<{ body: Record<string, unknown> }>;
  execute: Array<{ body: Record<string, unknown> }>;
  status: Array<{ executionId: string }>;
  logs: Array<{ executionId: string; after: string | null }>;
}

export interface MockCrmGateway {
  baseUrl: string;
  calls: MockCrmCallLog;
  close: () => Promise<void>;
}

const correlationIdOf = (req: Request): string => {
  const value = req.header("X-Correlation-Id");
  return value && value.trim() ? value : randomUUID();
};

const sqlForAction = (action: string, schema: string, table: string): string => {
  switch (action) {
    case "ADD_COLUMN":
      return `ALTER TABLE ${schema}.${table} ADD (...)`;
    case "ALTER_COLUMN":
      return `ALTER TABLE ${schema}.${table} MODIFY (...)`;
    case "CREATE_INDEX":
      return `CREATE INDEX ... ON ${schema}.${table} (...)`;
    case "DROP_INDEX":
      return `DROP INDEX ...`;
    default:
      return `-- ${action} ${schema}.${table}`;
  }
};

const withError = (res: Response, correlationId: string, code: string, message: string, status = 400): void => {
  res.status(status).json({
    correlationId,
    error: {
      code,
      message,
      details: {},
    },
  });
};

const updateExecutionStatus = (execution: MockExecution): void => {
  const elapsed = Date.now() - new Date(execution.submittedAt).getTime();
  if (elapsed < 150) {
    execution.status = "QUEUED";
    execution.startedAt = null;
    execution.endedAt = null;
    return;
  }
  if (elapsed < 600) {
    execution.status = "RUNNING";
    execution.startedAt = execution.startedAt ?? new Date(new Date(execution.submittedAt).getTime() + 150).toISOString();
    execution.endedAt = null;
    return;
  }
  execution.status = "SUCCEEDED";
  execution.startedAt = execution.startedAt ?? new Date(new Date(execution.submittedAt).getTime() + 150).toISOString();
  execution.endedAt = execution.endedAt ?? new Date(new Date(execution.submittedAt).getTime() + 620).toISOString();
};

const buildExecutionLogs = (execution: MockExecution): Array<{ time: string; level: string; message: string }> => {
  updateExecutionStatus(execution);
  const submittedAt = new Date(execution.submittedAt).getTime();
  const rows = [
    {
      time: new Date(submittedAt + 10).toISOString(),
      level: "INFO",
      message: "Execution queued",
    },
    {
      time: new Date(submittedAt + 180).toISOString(),
      level: "INFO",
      message: "Execution started",
    },
  ];
  if (execution.status === "SUCCEEDED") {
    rows.push({
      time: execution.endedAt ?? new Date(submittedAt + 620).toISOString(),
      level: "INFO",
      message: "Execution completed",
    });
  }
  return rows;
};

export const startMockCrmGateway = async (fixture: CrmFixture): Promise<MockCrmGateway> => {
  const app = express();
  app.use(express.json());

  const calls: MockCrmCallLog = {
    health: 0,
    dbInfo: 0,
    metadataExport: [],
    validate: [],
    execute: [],
    status: [],
    logs: [],
  };
  const executions = new Map<string, MockExecution>();

  app.all("/database_rest", (req, res) => {
    const correlationId = correlationIdOf(req);
    res.setHeader("X-Correlation-Id", correlationId);
    const action = String(req.query.action ?? "");

    if (action === "health" && req.method === "GET") {
      calls.health += 1;
      res.status(200).json({
        correlationId,
        status: "ok",
        service: `mock-crm-${fixture.db.type}`,
        version: "1.0.0",
        time: new Date().toISOString(),
      });
      return;
    }

    if (action === "db_info" && req.method === "GET") {
      calls.dbInfo += 1;
      res.status(200).json({
        correlationId,
        db: fixture.db,
      });
      return;
    }

    if (action === "metadata_export" && req.method === "POST") {
      calls.metadataExport.push({ body: (req.body ?? {}) as Record<string, unknown> });
      const tokenRaw = (req.body?.page?.pageToken as string | null | undefined) ?? null;
      const offset = tokenRaw ? Number(tokenRaw) : 0;
      const maxPage = 3;
      const requestedPage = Number(req.body?.page?.pageSize ?? maxPage);
      const pageSize = Number.isFinite(requestedPage) ? Math.max(1, Math.min(maxPage, requestedPage)) : maxPage;

      const tablePage = fixture.tables.slice(offset, offset + pageSize);
      const tableNames = new Set(tablePage.map((table) => table.name.toUpperCase()));
      const nextOffset = offset + pageSize;
      const nextPageToken = nextOffset < fixture.tables.length ? String(nextOffset) : null;

      res.status(200).json({
        correlationId,
        db: {
          type: fixture.db.type,
          version: fixture.db.version,
        },
        generatedAt: new Date().toISOString(),
        page: {
          pageSize,
          nextPageToken,
        },
        tables: tablePage,
        columns: fixture.columns.filter((column) => tableNames.has(column.table.toUpperCase())),
        indexes: fixture.indexes.filter((index) => tableNames.has(index.table.toUpperCase())),
      });
      return;
    }

    if (action === "ddl_validate" && req.method === "POST") {
      calls.validate.push({ body: (req.body ?? {}) as Record<string, unknown> });
      const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
      const schema = String(req.body?.schema ?? fixture.db.defaultSchema);
      res.status(200).json({
        correlationId,
        db: { type: fixture.db.type, version: fixture.db.version },
        valid: true,
        results: steps.map((step: { stepId?: string; action?: string; target?: { table?: string } }) => ({
          stepId: step.stepId ?? randomUUID(),
          valid: true,
          blockingIssues: [],
          warnings: [],
          sqlPreview: [
            sqlForAction(String(step.action ?? "UNKNOWN"), schema, String(step.target?.table ?? "UNKNOWN")),
          ],
          estimatedLocking: "LOW",
        })),
      });
      return;
    }

    if (action === "ddl_execute" && req.method === "POST") {
      calls.execute.push({ body: (req.body ?? {}) as Record<string, unknown> });
      const executionId = randomUUID();
      const submittedAt = new Date().toISOString();
      const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
      executions.set(executionId, {
        executionId,
        submittedAt,
        startedAt: null,
        endedAt: null,
        status: "QUEUED",
        steps,
        logs: [],
      });

      res.status(202).json({
        correlationId,
        executionId,
        status: "QUEUED",
        submittedAt,
      });
      return;
    }

    if (action === "ddl_execution_status" && req.method === "GET") {
      const executionId = String(req.query.executionId ?? "");
      calls.status.push({ executionId });
      const execution = executions.get(executionId);
      if (!execution) {
        withError(res, correlationId, "NOT_FOUND", "executionId not found", 404);
        return;
      }
      updateExecutionStatus(execution);
      res.status(200).json({
        correlationId,
        executionId,
        status: execution.status,
        submittedAt: execution.submittedAt,
        startedAt: execution.startedAt,
        endedAt: execution.endedAt,
        stepResults: execution.steps.map((step) => ({
          stepId: step.stepId ?? randomUUID(),
          status: execution.status === "SUCCEEDED" ? "SUCCEEDED" : execution.status,
          startedAt: execution.startedAt,
          endedAt: execution.endedAt,
          sqlExecuted: [
            sqlForAction(
              String(step.action ?? "UNKNOWN"),
              String(step.target?.schema ?? fixture.db.defaultSchema),
              String(step.target?.table ?? "UNKNOWN"),
            ),
          ],
          error: null,
        })),
      });
      return;
    }

    if (action === "ddl_execution_logs" && req.method === "GET") {
      const executionId = String(req.query.executionId ?? "");
      const after = typeof req.query.after === "string" ? req.query.after : null;
      calls.logs.push({ executionId, after });
      const execution = executions.get(executionId);
      if (!execution) {
        withError(res, correlationId, "NOT_FOUND", "executionId not found", 404);
        return;
      }

      const logs = buildExecutionLogs(execution);
      const afterTs = after ? new Date(after).getTime() : 0;
      const items = logs.filter((log) => new Date(log.time).getTime() > afterTs);
      res.status(200).json({
        correlationId,
        executionId,
        items,
      });
      return;
    }

    withError(res, correlationId, "INVALID_ARGUMENT", "Unknown action", 400);
  });

  const server = await new Promise<Server>((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    calls,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
};
