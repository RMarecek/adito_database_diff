export interface CrmFixtureTable {
  schema: string;
  name: string;
  isView: boolean;
  comment: string | null;
  storage: {
    engine: string | null;
    tablespace: string | null;
  };
}

export interface CrmFixtureColumn {
  schema: string;
  table: string;
  name: string;
  ordinalPosition: number;
  nativeType: string;
  canonicalType:
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
  length: number | null;
  precision: number | null;
  scale: number | null;
  nullable: boolean;
  defaultRaw: string | null;
  comment: string | null;
  charset: string | null;
  collation: string | null;
}

export interface CrmFixtureIndex {
  schema: string;
  table: string;
  name: string;
  unique: boolean;
  indexType: string;
  tablespace: string | null;
  whereClause: string | null;
  columns: Array<{
    name: string;
    position: number;
    direction: "ASC" | "DESC";
    expression: string | null;
  }>;
}

export interface CrmFixture {
  db: {
    type: "oracle" | "mariadb";
    version: string;
    defaultSchema: string;
  };
  tables: CrmFixtureTable[];
  columns: CrmFixtureColumn[];
  indexes: CrmFixtureIndex[];
}
