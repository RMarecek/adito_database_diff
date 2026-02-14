import express from "express";
import { v4 as uuidv4 } from "uuid";

type Execution = {
  executionId: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  submittedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  logs: Array<{ time: string; level: string; message: string }>;
  steps: Array<{ stepId: string; sqlExecuted: string[] }>;
};

const executions = new Map<string, Execution>();
const app = express();
app.use(express.json());

const correlationId = (req: express.Request): string =>
  (req.header("X-Correlation-Id") || uuidv4()).toString();

app.all("/database_rest", (req, res) => {
  const action = String(req.query.action ?? "");
  const cId = correlationId(req);
  res.setHeader("X-Correlation-Id", cId);

  if (action === "health" && req.method === "GET") {
    return res.status(200).json({
      correlationId: cId,
      status: "ok",
      service: "crm-db-gateway-mock",
      version: "1.0.0",
      time: new Date().toISOString(),
    });
  }

  if (action === "db_info" && req.method === "GET") {
    return res.status(200).json({
      correlationId: cId,
      db: {
        type: "oracle",
        version: "19c",
        defaultSchema: "CRM",
      },
    });
  }

  if (action === "metadata_export" && req.method === "POST") {
    return res.status(200).json({
      correlationId: cId,
      db: { type: "oracle", version: "19c" },
      generatedAt: new Date().toISOString(),
      page: { pageSize: 200, nextPageToken: null },
      tables: [
        {
          schema: "CRM",
          name: "CUSTOMERS",
          isView: false,
          comment: null,
          storage: { engine: null, tablespace: "CRM_DATA" },
        },
      ],
      columns: [
        {
          schema: "CRM",
          table: "CUSTOMERS",
          name: "ID",
          ordinalPosition: 1,
          nativeType: "NUMBER(19)",
          canonicalType: "BIGINT",
          length: null,
          precision: 19,
          scale: 0,
          nullable: false,
          defaultRaw: null,
          comment: null,
          charset: null,
          collation: null,
        },
        {
          schema: "CRM",
          table: "CUSTOMERS",
          name: "EMAIL",
          ordinalPosition: 2,
          nativeType: "VARCHAR2(255 CHAR)",
          canonicalType: "STRING",
          length: 255,
          precision: null,
          scale: null,
          nullable: true,
          defaultRaw: null,
          comment: null,
          charset: null,
          collation: null,
        },
      ],
      indexes: [
        {
          schema: "CRM",
          table: "CUSTOMERS",
          name: "IDX_CUSTOMERS_EMAIL",
          unique: false,
          indexType: "BTREE",
          tablespace: "CRM_IDX",
          whereClause: null,
          columns: [{ name: "EMAIL", position: 1, direction: "ASC", expression: null }],
        },
      ],
    });
  }

  if (action === "ddl_validate" && req.method === "POST") {
    const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
    return res.status(200).json({
      correlationId: cId,
      db: { type: "oracle", version: "19c" },
      valid: true,
      results: steps.map((step: { stepId: string; action: string; target?: { schema?: string; table?: string } }) => ({
        stepId: step.stepId,
        valid: true,
        blockingIssues: [],
        warnings: [],
        sqlPreview: [
          `-- ${step.action} ${step.target?.schema ?? "CRM"}.${step.target?.table ?? "UNKNOWN"}`,
        ],
        estimatedLocking: "LOW",
      })),
    });
  }

  if (action === "ddl_execute" && req.method === "POST") {
    const executionId = uuidv4();
    const now = new Date().toISOString();
    const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
    const entry: Execution = {
      executionId,
      status: "QUEUED",
      submittedAt: now,
      startedAt: null,
      endedAt: null,
      logs: [{ time: now, level: "INFO", message: "Execution queued" }],
      steps: steps.map((s: { stepId: string; action: string }) => ({
        stepId: s.stepId,
        sqlExecuted: [`-- SQL for ${s.action}`],
      })),
    };
    executions.set(executionId, entry);

    setTimeout(() => {
      const x = executions.get(executionId);
      if (!x) return;
      x.status = "RUNNING";
      x.startedAt = new Date().toISOString();
      x.logs.push({
        time: x.startedAt,
        level: "INFO",
        message: "DDL execution started",
      });
    }, 300);

    setTimeout(() => {
      const x = executions.get(executionId);
      if (!x) return;
      x.status = "SUCCEEDED";
      x.endedAt = new Date().toISOString();
      x.logs.push({
        time: x.endedAt,
        level: "INFO",
        message: "DDL execution completed",
      });
    }, 1200);

    return res.status(202).json({
      correlationId: cId,
      executionId,
      status: "QUEUED",
      submittedAt: now,
    });
  }

  if (action === "ddl_execution_status" && req.method === "GET") {
    const executionId = String(req.query.executionId ?? "");
    const execution = executions.get(executionId);
    if (!execution) {
      return res.status(404).json({
        correlationId: cId,
        error: { code: "NOT_FOUND", message: "executionId not found", details: {} },
      });
    }
    return res.status(200).json({
      correlationId: cId,
      executionId: execution.executionId,
      status: execution.status,
      submittedAt: execution.submittedAt,
      startedAt: execution.startedAt,
      endedAt: execution.endedAt,
      stepResults: execution.steps.map((step) => ({
        stepId: step.stepId,
        status: execution.status === "SUCCEEDED" ? "SUCCEEDED" : "RUNNING",
        startedAt: execution.startedAt,
        endedAt: execution.endedAt,
        sqlExecuted: step.sqlExecuted,
        error: null,
      })),
    });
  }

  if (action === "ddl_execution_logs" && req.method === "GET") {
    const executionId = String(req.query.executionId ?? "");
    const after = req.query.after ? new Date(String(req.query.after)).getTime() : 0;
    const execution = executions.get(executionId);
    if (!execution) {
      return res.status(404).json({
        correlationId: cId,
        error: { code: "NOT_FOUND", message: "executionId not found", details: {} },
      });
    }
    return res.status(200).json({
      correlationId: cId,
      executionId: execution.executionId,
      items: execution.logs.filter((x) => new Date(x.time).getTime() > after),
    });
  }

  return res.status(400).json({
    correlationId: cId,
    error: {
      code: "INVALID_ARGUMENT",
      message: "Unknown action",
      details: { action },
    },
  });
});

const port = Number(process.env.CRM_MOCK_PORT ?? 4100);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`CRM mock server listening on ${port}`);
});
