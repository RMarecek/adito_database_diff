export type Role = "viewer" | "editor" | "executor" | "approver" | "admin";

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

export interface ApiErrorBody {
  correlationId: string;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface InstanceItem {
  instanceId: string;
  name: string;
  environment: string;
  crmBaseUrl: string;
  dbType: "oracle" | "mariadb";
  defaultSchema: string;
  capabilities: {
    read: boolean;
    write: boolean;
  };
  lastSnapshotAt: string | null;
}

export interface SnapshotSummary {
  snapshotId: string;
  instanceId: string;
  schema: string;
  status: "QUEUED" | "RUNNING" | "READY" | "FAILED";
  createdAt: string;
  stats: {
    tables: number;
    columns: number;
    indexes: number;
  };
}

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

export interface IndexSpec {
  name: string;
  unique: boolean;
  indexType: string;
  columns: Array<{
    name: string;
    position: number;
    direction: "ASC" | "DESC";
    expression: string | null;
  }>;
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
  options: Record<string, unknown> | null;
}

export interface CompareMatrixResponse {
  correlationId: string;
  level: "table";
  instances: Array<{
    instanceId: string;
    name: string;
    dbType: "oracle" | "mariadb";
  }>;
  options: {
    matchIndexByDefinition: boolean;
    ignoreIndexName: boolean;
    ignoreColumnOrder: boolean;
  };
  total: number;
  items: Array<{
    objectKey: string;
    displayName: string;
    cells: Record<
      string,
      {
        status: "PRESENT" | "MISSING";
        diff: "NONE" | "DIFFERENT" | "MISSING";
      }
    >;
    diffSummary: {
      columnsDifferent: number;
      indexesDifferent: number;
      missingColumns: number;
      missingIndexes: number;
    };
  }>;
}

export interface CompareDetailsResponse {
  correlationId: string;
  tableKey: string;
  perInstance: Record<
    string,
    {
      table: TableSpec | null;
    }
  >;
  diff: {
    columns: Array<{
      columnName: string;
      typeDiff: boolean;
      nullableDiff: boolean;
      defaultDiff: boolean;
    }>;
    indexes: Array<{
      indexDefinitionKey: string;
      missingInInstanceIds: string[];
    }>;
  };
}

export interface ChangeSetSummary {
  changeSetId: string;
  title: string;
  description: string | null;
  sourceCompareRunId: string | null;
  status: "DRAFT" | "VALIDATED" | "EXECUTED";
  createdAt: string;
  updatedAt: string;
}

export interface ChangeSetDetail {
  changeSetId: string;
  title: string;
  description: string | null;
  status: "DRAFT" | "VALIDATED" | "EXECUTED";
  steps: ChangeStep[];
}

export interface ExecutionDetail {
  executionId: string;
  changeSetId: string;
  instanceId: string;
  jobId: string;
  startedBy: string;
  status: string;
  submittedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  crm: unknown;
  logs: Array<{
    time: string;
    level: string;
    message: string;
  }>;
}

export interface AuditResult {
  total: number;
  items: Array<{
    id: string;
    userId: string;
    action: string;
    tableKey: string | null;
    payload: unknown;
    correlationId: string;
    time: string;
  }>;
}
