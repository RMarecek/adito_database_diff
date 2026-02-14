import type { CrmFixture, CrmFixtureColumn, CrmFixtureIndex, CrmFixtureTable } from "./types";

const schema = "crm";

const table = (name: string): CrmFixtureTable => ({
  schema,
  name,
  isView: false,
  comment: null,
  storage: {
    engine: "InnoDB",
    tablespace: null,
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
  charset: options.charset ?? "utf8mb4",
  collation: options.collation ?? "utf8mb4_general_ci",
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
  tablespace: null,
  whereClause: options.whereClause ?? null,
  columns: columns.map((col, idx) => ({
    name: col,
    position: idx + 1,
    direction: "ASC",
    expression: null,
  })),
});

const tables = [
  table("customers"),
  table("orders"),
  table("products"),
  table("payments"),
  table("invoices"),
  table("shipments"),
  table("users"),
  table("roles"),
  table("audit_log"),
  table("settings"),
  table("notifications"),
];

const columns = [
  column("customers", "id", 1, "bigint", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("customers", "email", 2, "varchar(191)", "STRING", { length: 191, nullable: false }),
  column("customers", "status", 3, "varchar(20)", "STRING", { length: 20, defaultRaw: "'ACTIVE'", nullable: false }),
  column("customers", "created_at", 4, "datetime(3)", "DATETIME", { nullable: false }),

  column("orders", "id", 1, "bigint", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("orders", "customer_id", 2, "bigint", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("orders", "total", 3, "decimal(10,2)", "DECIMAL", { precision: 10, scale: 2, nullable: false }),
  column("orders", "status", 4, "varchar(16)", "STRING", { length: 16, defaultRaw: "'NEW'" }),

  column("products", "id", 1, "bigint", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("products", "sku", 2, "varchar(64)", "STRING", { length: 64, nullable: false }),
  column("products", "price", 3, "decimal(12,2)", "DECIMAL", { precision: 12, scale: 2, nullable: false }),

  column("payments", "id", 1, "bigint", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("payments", "order_id", 2, "bigint", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("payments", "paid_at", 3, "datetime(3)", "DATETIME", { nullable: true }),
  column("payments", "provider_ref", 4, "varchar(80)", "STRING", { length: 80 }),

  column("invoices", "id", 1, "bigint", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("invoices", "order_id", 2, "bigint", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("invoices", "due_date", 3, "date", "DATE", { nullable: true }),

  column("shipments", "id", 1, "bigint", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("shipments", "order_id", 2, "bigint", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("shipments", "tracking_no", 3, "varchar(120)", "STRING", { length: 120 }),
  column("shipments", "warehouse_code", 4, "varchar(32)", "STRING", { length: 32 }),

  column("users", "id", 1, "bigint", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("users", "username", 2, "varchar(64)", "STRING", { length: 64, nullable: false }),
  column("users", "email", 3, "varchar(191)", "STRING", { length: 191, nullable: false }),
  column("users", "active", 4, "tinyint(1)", "BOOLEAN", { nullable: false, defaultRaw: "1" }),

  column("roles", "id", 1, "bigint", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("roles", "role_name", 2, "varchar(64)", "STRING", { length: 64, nullable: false }),

  column("audit_log", "id", 1, "bigint", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("audit_log", "event_type", 2, "varchar(64)", "STRING", { length: 64 }),
  column("audit_log", "payload", 3, "longtext", "JSON"),

  column("settings", "id", 1, "bigint", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("settings", "key", 2, "varchar(120)", "STRING", { length: 120, nullable: false }),
  column("settings", "value", 3, "longtext", "STRING", { nullable: true }),

  column("notifications", "id", 1, "bigint", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("notifications", "user_id", 2, "bigint", "BIGINT", { precision: 19, scale: 0, nullable: false }),
  column("notifications", "seen", 3, "tinyint(1)", "BOOLEAN", { nullable: false, defaultRaw: "0" }),
];

const indexes = [
  index("customers", "pk_customers", ["id"], { unique: true }),
  index("customers", "ix_customers_mail", ["email"]),

  index("orders", "pk_orders", ["id"], { unique: true }),
  index("orders", "ix_orders_customer", ["customer_id"]),

  index("products", "pk_products", ["id"], { unique: true }),
  index("products", "uq_products_sku", ["sku"], { unique: true }),

  index("payments", "pk_payments", ["id"], { unique: true }),

  index("invoices", "pk_invoices", ["id"], { unique: true }),
  index("invoices", "ix_invoices_order", ["order_id"]),

  index("shipments", "pk_shipments", ["id"], { unique: true }),

  index("users", "pk_users", ["id"], { unique: true }),
  index("users", "uq_users_username", ["username"], { unique: true }),

  index("roles", "pk_roles", ["id"], { unique: true }),

  index("audit_log", "pk_audit_log", ["id"], { unique: true }),

  index("settings", "pk_settings", ["id"], { unique: true }),
  index("settings", "uq_settings_key", ["key"], { unique: true }),

  index("notifications", "pk_notifications", ["id"], { unique: true }),
];

export const mariadbFixture: CrmFixture = {
  db: {
    type: "mariadb",
    version: "10.11",
    defaultSchema: schema,
  },
  tables,
  columns,
  indexes,
};
