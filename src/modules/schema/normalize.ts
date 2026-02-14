import { makeColumnKey, makeIndexKey, makeTableKey } from "./keys";
import type {
  CanonicalDbType,
  CanonicalType,
  ColumnSpec,
  IndexSpec,
  TableSpec,
} from "./types";

const mapNativeType = (nativeType: string): CanonicalType => {
  const t = nativeType.toUpperCase();
  if (t.includes("CHAR") || t.includes("TEXT") || t.includes("VARCHAR") || t.includes("CLOB")) return "STRING";
  if (t.includes("NUMBER") || t.includes("INT")) return t.includes("BIGINT") ? "BIGINT" : "INT";
  if (t.includes("DECIMAL") || t.includes("NUMERIC")) return "DECIMAL";
  if (t.includes("FLOAT") || t.includes("DOUBLE") || t.includes("REAL")) return "FLOAT";
  if (t.includes("BOOL")) return "BOOLEAN";
  if (t.includes("DATE") && !t.includes("TIME")) return "DATE";
  if (t.includes("TIMESTAMP") || (t.includes("DATE") && t.includes("TIME"))) return "DATETIME";
  if (t.includes("TIME") && !t.includes("STAMP")) return "TIME";
  if (t.includes("BINARY")) return "BINARY";
  if (t.includes("BLOB")) return "BLOB";
  if (t.includes("JSON")) return "JSON";
  if (t.includes("UUID")) return "UUID";
  return "OTHER";
};

export interface MetadataTableRow {
  schema: string;
  name: string;
  isView: boolean;
  comment: string | null;
  storage: { engine: string | null; tablespace: string | null };
}

export interface MetadataColumnRow {
  schema: string;
  table: string;
  name: string;
  ordinalPosition: number;
  nativeType: string;
  canonicalType?: CanonicalType | null;
  length: number | null;
  precision: number | null;
  scale: number | null;
  nullable: boolean;
  defaultRaw: string | null;
  comment: string | null;
  charset: string | null;
  collation: string | null;
}

export interface MetadataIndexRow {
  schema: string;
  table: string;
  name: string;
  unique: boolean;
  indexType: string;
  columns: Array<{ name: string; position: number; direction: "ASC" | "DESC"; expression: string | null }>;
  whereClause: string | null;
  tablespace: string | null;
}

export interface MetadataBundle {
  db: { type: CanonicalDbType; version: string };
  tables: MetadataTableRow[];
  columns: MetadataColumnRow[];
  indexes: MetadataIndexRow[];
}

export const normalizeBundleToTableSpecs = (bundle: MetadataBundle): TableSpec[] => {
  const columnsByTable = new Map<string, ColumnSpec[]>();
  const indexesByTable = new Map<string, IndexSpec[]>();

  for (const col of bundle.columns) {
    const tableKey = makeTableKey(col.schema, col.table);
    const column: ColumnSpec = {
      name: col.name.toUpperCase(),
      ordinalPosition: col.ordinalPosition,
      canonicalType: col.canonicalType ?? mapNativeType(col.nativeType),
      nativeType: col.nativeType,
      length: col.length,
      precision: col.precision,
      scale: col.scale,
      nullable: col.nullable,
      defaultRaw: col.defaultRaw,
      comment: col.comment,
      charset: col.charset,
      collation: col.collation,
    };
    const list = columnsByTable.get(tableKey) ?? [];
    list.push(column);
    columnsByTable.set(tableKey, list);
  }

  for (const idx of bundle.indexes) {
    const tableKey = makeTableKey(idx.schema, idx.table);
    const mapped: IndexSpec = {
      name: idx.name.toUpperCase(),
      unique: idx.unique,
      indexType: idx.indexType,
      whereClause: idx.whereClause,
      tablespace: idx.tablespace,
      columns: idx.columns.map((c) => ({
        name: c.name.toUpperCase(),
        position: c.position,
        direction: c.direction,
        expression: c.expression,
      })),
    };
    const list = indexesByTable.get(tableKey) ?? [];
    list.push(mapped);
    indexesByTable.set(tableKey, list);
  }

  return bundle.tables.map((table) => {
    const tableKey = makeTableKey(table.schema, table.name);
    const columns = (columnsByTable.get(tableKey) ?? []).sort((a, b) => a.ordinalPosition - b.ordinalPosition);
    const indexes = (indexesByTable.get(tableKey) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    return {
      schema: table.schema.toUpperCase(),
      name: table.name.toUpperCase(),
      tableKey,
      isView: table.isView,
      comment: table.comment,
      storage: table.storage,
      columns,
      indexes,
    };
  });
};

export const indexDefinitionKey = (index: IndexSpec, ignoreName: boolean): string => {
  const canonicalIndexType = (value: string): string => {
    const upper = value.trim().toUpperCase();
    if (upper === "NORMAL" || upper === "BTREE") return "BTREE";
    return upper;
  };
  const normalizeWhereClause = (value: string | null): string =>
    (value ?? "").replace(/\s+/g, " ").trim().toUpperCase();

  const cols = [...index.columns]
    .sort((a, b) => a.position - b.position)
    .map((c) => `${c.name}:${c.direction}:${c.expression ?? ""}`)
    .join("|");
  const prefix = ignoreName ? "IGN" : index.name.toUpperCase();
  return `${prefix};U=${index.unique ? 1 : 0};T=${canonicalIndexType(index.indexType)};C=${cols};W=${normalizeWhereClause(index.whereClause)}`;
};

export const columnDefinitionKey = (
  column: ColumnSpec,
  ignoreOrder = false,
  includeNativeType = true,
): string => {
  const ord = ignoreOrder ? "" : String(column.ordinalPosition);
  const core = [
    ord,
    column.name.toUpperCase(),
    column.canonicalType,
    String(column.length ?? ""),
    String(column.precision ?? ""),
    String(column.scale ?? ""),
    String(column.nullable),
    column.defaultRaw ?? "",
  ];
  if (includeNativeType) {
    core.push(column.nativeType.toUpperCase());
  }
  return core.join(";");
};

export const ensureKeyedColumn = (schema: string, table: string, columnName: string): string =>
  makeColumnKey(schema, table, columnName);

export const ensureKeyedIndex = (schema: string, table: string, indexName: string): string =>
  makeIndexKey(schema, table, indexName);
