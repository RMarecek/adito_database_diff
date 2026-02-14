import type {
  CanonicalType,
  ColumnSpec,
  IndexSpec,
  SnapshotSpec,
  TableSpec,
} from "../src/index";
import { tableKey } from "../src/index";

const col = (
  name: string,
  ordinalPosition: number,
  canonicalType: CanonicalType,
  nativeType: string,
  options: Partial<ColumnSpec> = {},
): ColumnSpec => ({
  name,
  ordinalPosition,
  canonicalType,
  nativeType,
  length: options.length ?? null,
  precision: options.precision ?? null,
  scale: options.scale ?? null,
  nullable: options.nullable ?? true,
  defaultRaw: options.defaultRaw ?? null,
  comment: null,
  charset: null,
  collation: null,
});

const idx = (
  name: string,
  columns: Array<{ name: string; position: number }>,
  options: Partial<IndexSpec> = {},
): IndexSpec => ({
  name,
  unique: options.unique ?? false,
  indexType: options.indexType ?? "BTREE",
  columns: columns.map((column) => ({
    name: column.name,
    position: column.position,
    direction: "ASC",
    expression: null,
  })),
  whereClause: null,
  tablespace: null,
});

const table = (schema: string, name: string, columns: ColumnSpec[], indexes: IndexSpec[]): TableSpec => ({
  schema,
  name,
  tableKey: tableKey(schema, name),
  isView: false,
  comment: null,
  storage: { engine: null, tablespace: "CRM_DATA" },
  columns,
  indexes,
});

const customersBaseline = table(
  "CRM",
  "CUSTOMERS",
  [
    col("ID", 1, "BIGINT", "NUMBER(19)", { precision: 19, scale: 0, nullable: false }),
    col("EMAIL", 2, "STRING", "VARCHAR2(255 CHAR)", { length: 255, nullable: true }),
    col("STATUS", 3, "STRING", "VARCHAR2(20 CHAR)", {
      length: 20,
      nullable: false,
      defaultRaw: "'ACTIVE'",
    }),
    col("CREATED_AT", 4, "DATETIME", "TIMESTAMP", { nullable: false }),
  ],
  [
    idx("PK_CUSTOMERS", [{ name: "ID", position: 1 }], { unique: true }),
    idx("IDX_CUSTOMERS_EMAIL", [{ name: "EMAIL", position: 1 }]),
  ],
);

const ordersBaseline = table(
  "CRM",
  "ORDERS",
  [
    col("ID", 1, "BIGINT", "NUMBER(19)", { precision: 19, scale: 0, nullable: false }),
    col("CUSTOMER_ID", 2, "BIGINT", "NUMBER(19)", { precision: 19, scale: 0, nullable: false }),
    col("TOTAL", 3, "DECIMAL", "NUMBER(12,2)", { precision: 12, scale: 2, nullable: false }),
  ],
  [
    idx("PK_ORDERS", [{ name: "ID", position: 1 }], { unique: true }),
    idx("IDX_ORDERS_CUSTOMER", [{ name: "CUSTOMER_ID", position: 1 }]),
  ],
);

const auditBaseline = table(
  "CRM",
  "AUDIT_LOG",
  [
    col("ID", 1, "BIGINT", "NUMBER(19)", { precision: 19, scale: 0, nullable: false }),
    col("PAYLOAD", 2, "JSON", "CLOB", { nullable: true }),
  ],
  [],
);

export const baselineSnapshot: SnapshotSpec = {
  snapshotId: "00000000-0000-4000-8000-000000000001",
  instanceId: "00000000-0000-4000-8000-100000000001",
  tables: [customersBaseline, ordersBaseline, auditBaseline],
};

const customersTarget = table(
  "crm",
  "customers",
  [
    col("ID", 1, "INT", "NUMBER(10)", { precision: 10, scale: 0, nullable: false }),
    col("EMAIL", 2, "STRING", "VARCHAR2(120 CHAR)", { length: 120, nullable: true }),
    col("STATUS", 3, "STRING", "VARCHAR2(20 CHAR)", {
      length: 20,
      nullable: true,
      defaultRaw: null,
    }),
    col("CREATED_AT", 4, "DATETIME", "TIMESTAMP", { nullable: false }),
    col("LEGACY_CODE", 5, "STRING", "VARCHAR2(32 CHAR)", { length: 32, nullable: true }),
  ],
  [
    idx("PK_CUSTOMERS", [{ name: "ID", position: 1 }], { unique: true }),
    idx("IX_EMAIL_ALT_NAME", [{ name: "EMAIL", position: 1 }]),
    idx("IDX_OLD_LEGACY", [{ name: "LEGACY_CODE", position: 1 }]),
  ],
);

const auditTarget = table(
  "CRM",
  "AUDIT_LOG",
  [
    col("ID", 1, "BIGINT", "NUMBER(19)", { precision: 19, scale: 0, nullable: false }),
    col("PAYLOAD", 2, "STRING", "VARCHAR2(2000 CHAR)", { length: 2000, nullable: true }),
  ],
  [],
);

const extraTarget = table(
  "CRM",
  "EXTRA_TARGET_ONLY",
  [col("ID", 1, "BIGINT", "NUMBER(19)", { precision: 19, scale: 0, nullable: false })],
  [idx("PK_EXTRA_TARGET_ONLY", [{ name: "ID", position: 1 }], { unique: true })],
);

export const targetSnapshot: SnapshotSpec = {
  snapshotId: "00000000-0000-4000-8000-000000000002",
  instanceId: "00000000-0000-4000-8000-100000000002",
  tables: [customersTarget, auditTarget, extraTarget],
};

export const identicalSnapshot: SnapshotSpec = {
  snapshotId: "00000000-0000-4000-8000-000000000003",
  instanceId: "00000000-0000-4000-8000-100000000003",
  tables: JSON.parse(JSON.stringify(baselineSnapshot.tables)),
};

export const sparseSnapshot: SnapshotSpec = {
  snapshotId: "00000000-0000-4000-8000-000000000004",
  instanceId: "00000000-0000-4000-8000-100000000004",
  tables: [table("CRM", "CUSTOMERS", [col("ID", 1, "BIGINT", "NUMBER(19)", { precision: 19, scale: 0, nullable: false })], [])],
};

export const cloneSnapshot = (snapshot: SnapshotSpec): SnapshotSpec =>
  JSON.parse(JSON.stringify(snapshot)) as SnapshotSpec;
