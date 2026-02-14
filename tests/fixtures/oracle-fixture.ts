import type { CrmFixture, CrmFixtureColumn, CrmFixtureIndex, CrmFixtureTable } from "./types";

const schema = "CRM";

const table = (name: string, tablespace = "CRM_DATA"): CrmFixtureTable => ({
  schema,
  name,
  isView: false,
  comment: null,
  storage: {
    engine: null,
    tablespace,
  },
});

const column = (
  tableName: string,
  name: string,
  ordinalPosition: number,
  nativeType: string,
  canonicalType: CrmFixtureColumn["canonicalType"],
  options: Partial<CrmFixtureColumn> = {},
): CrmFixtureColumn => ({
  schema,
  table: tableName,
  name,
  ordinalPosition,
  nativeType,
  canonicalType,
  length: options.length ?? null,
  precision: options.precision ?? null,
  scale: options.scale ?? null,
  nullable: options.nullable ?? true,
  defaultRaw: options.defaultRaw ?? null,
  comment: null,
  charset: options.charset ?? null,
  collation: options.collation ?? null,
});

const index = (
  tableName: string,
  name: string,
  columns: string[],
  options: Partial<CrmFixtureIndex> = {},
): CrmFixtureIndex => ({
  schema,
  table: tableName,
  name,
  unique: options.unique ?? false,
  indexType: options.indexType ?? "BTREE",
  tablespace: options.tablespace ?? "CRM_IDX",
  whereClause: options.whereClause ?? null,
  columns: columns.map((col, idx) => ({
    name: col,
    position: idx + 1,
    direction: "ASC",
    expression: null,
  })),
});

const tables = [
  table("CUSTOMERS"),
  table("ORDERS"),
  table("PRODUCTS"),
  table("PAYMENTS"),
  table("INVOICES"),
  table("SHIPMENTS"),
  table("USERS"),
  table("ROLES"),
  table("AUDIT_LOG"),
  table("SETTINGS"),
  table("NOTIFICATIONS"),
];

const columns = [
  column("CUSTOMERS", "ID", 1, "NUMBER(19)", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("CUSTOMERS", "EMAIL", 2, "VARCHAR2(255 CHAR)", "STRING", { length: 255, nullable: false }),
  column("CUSTOMERS", "STATUS", 3, "VARCHAR2(20 CHAR)", "STRING", { length: 20, defaultRaw: "'ACTIVE'", nullable: false }),
  column("CUSTOMERS", "CREATED_AT", 4, "TIMESTAMP", "DATETIME", { nullable: false }),

  column("ORDERS", "ID", 1, "NUMBER(19)", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("ORDERS", "CUSTOMER_ID", 2, "NUMBER(19)", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("ORDERS", "TOTAL", 3, "NUMBER(12,2)", "DECIMAL", { precision: 12, scale: 2, nullable: false }),
  column("ORDERS", "STATUS", 4, "VARCHAR2(16 CHAR)", "STRING", { length: 16, defaultRaw: "'OPEN'" }),

  column("PRODUCTS", "ID", 1, "NUMBER(19)", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("PRODUCTS", "SKU", 2, "VARCHAR2(64 CHAR)", "STRING", { length: 64, nullable: false }),
  column("PRODUCTS", "PRICE", 3, "NUMBER(10,2)", "DECIMAL", { precision: 10, scale: 2, nullable: false }),

  column("PAYMENTS", "ID", 1, "NUMBER(19)", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("PAYMENTS", "ORDER_ID", 2, "NUMBER(19)", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("PAYMENTS", "PAID_AT", 3, "TIMESTAMP", "DATETIME", { nullable: true }),

  column("INVOICES", "ID", 1, "NUMBER(19)", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("INVOICES", "ORDER_ID", 2, "NUMBER(19)", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("INVOICES", "DUE_DATE", 3, "DATE", "DATE", { nullable: false }),

  column("SHIPMENTS", "ID", 1, "NUMBER(19)", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("SHIPMENTS", "ORDER_ID", 2, "NUMBER(19)", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("SHIPMENTS", "TRACKING_NO", 3, "VARCHAR2(80 CHAR)", "STRING", { length: 80 }),

  column("USERS", "ID", 1, "NUMBER(19)", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("USERS", "USERNAME", 2, "VARCHAR2(64 CHAR)", "STRING", { length: 64, nullable: false }),
  column("USERS", "EMAIL", 3, "VARCHAR2(255 CHAR)", "STRING", { length: 255, nullable: false }),

  column("ROLES", "ID", 1, "NUMBER(19)", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("ROLES", "ROLE_NAME", 2, "VARCHAR2(64 CHAR)", "STRING", { length: 64, nullable: false }),

  column("AUDIT_LOG", "ID", 1, "NUMBER(19)", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("AUDIT_LOG", "EVENT_TYPE", 2, "VARCHAR2(64 CHAR)", "STRING", { length: 64 }),
  column("AUDIT_LOG", "PAYLOAD", 3, "CLOB", "JSON"),

  column("SETTINGS", "ID", 1, "NUMBER(19)", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("SETTINGS", "KEY", 2, "VARCHAR2(120 CHAR)", "STRING", { length: 120, nullable: false }),
  column("SETTINGS", "VALUE", 3, "CLOB", "STRING", { nullable: true }),

  column("NOTIFICATIONS", "ID", 1, "NUMBER(19)", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("NOTIFICATIONS", "USER_ID", 2, "NUMBER(19)", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("NOTIFICATIONS", "SEEN", 3, "NUMBER(1)", "BOOLEAN", { nullable: false, defaultRaw: "0" }),
];

const indexes = [
  index("CUSTOMERS", "PK_CUSTOMERS", ["ID"], { unique: true }),
  index("CUSTOMERS", "IDX_CUSTOMERS_EMAIL", ["EMAIL"]),

  index("ORDERS", "PK_ORDERS", ["ID"], { unique: true }),
  index("ORDERS", "IDX_ORDERS_CUSTOMER", ["CUSTOMER_ID"]),

  index("PRODUCTS", "PK_PRODUCTS", ["ID"], { unique: true }),
  index("PRODUCTS", "UQ_PRODUCTS_SKU", ["SKU"], { unique: true }),

  index("PAYMENTS", "PK_PAYMENTS", ["ID"], { unique: true }),
  index("PAYMENTS", "IDX_PAYMENTS_ORDER", ["ORDER_ID"]),

  index("INVOICES", "PK_INVOICES", ["ID"], { unique: true }),
  index("INVOICES", "IDX_INVOICES_ORDER", ["ORDER_ID"]),

  index("SHIPMENTS", "PK_SHIPMENTS", ["ID"], { unique: true }),
  index("SHIPMENTS", "UQ_SHIPMENTS_TRACK", ["TRACKING_NO"], { unique: true }),

  index("USERS", "PK_USERS", ["ID"], { unique: true }),
  index("USERS", "UQ_USERS_USERNAME", ["USERNAME"], { unique: true }),

  index("ROLES", "PK_ROLES", ["ID"], { unique: true }),
  index("ROLES", "UQ_ROLES_NAME", ["ROLE_NAME"], { unique: true }),

  index("AUDIT_LOG", "PK_AUDIT_LOG", ["ID"], { unique: true }),

  index("SETTINGS", "PK_SETTINGS", ["ID"], { unique: true }),
  index("SETTINGS", "UQ_SETTINGS_KEY", ["KEY"], { unique: true }),

  index("NOTIFICATIONS", "PK_NOTIFICATIONS", ["ID"], { unique: true }),
  index("NOTIFICATIONS", "IDX_NOTIF_USER", ["USER_ID"]),
];

export const oracleFixture: CrmFixture = {
  db: {
    type: "oracle",
    version: "19c",
    defaultSchema: schema,
  },
  tables,
  columns,
  indexes,
};
