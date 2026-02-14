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

export type CanonicalDbType = "oracle" | "mariadb";

export type IndexDirection = "ASC" | "DESC";

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

export interface IndexColumnSpec {
  name: string;
  position: number;
  direction: IndexDirection;
  expression: string | null;
}

export interface IndexSpec {
  name: string;
  unique: boolean;
  indexType: string;
  columns: IndexColumnSpec[];
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
  options: {
    ifExists?: boolean;
    ifNotExists?: boolean;
    [key: string]: unknown;
  } | null;
}

export interface CompareOptions {
  matchIndexByDefinition: boolean;
  ignoreIndexName: boolean;
  ignoreColumnOrder: boolean;
}
