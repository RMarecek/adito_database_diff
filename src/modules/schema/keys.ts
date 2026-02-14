const normalizePart = (value: string): string => value.trim().toUpperCase();

export const makeTableKey = (schema: string, tableName: string): string =>
  `${normalizePart(schema)}.${normalizePart(tableName)}`;

export const makeColumnKey = (schema: string, tableName: string, columnName: string): string =>
  `${normalizePart(schema)}.${normalizePart(tableName)}.${normalizePart(columnName)}`;

export const makeIndexKey = (schema: string, tableName: string, indexName: string): string =>
  `${normalizePart(schema)}.${normalizePart(tableName)}.${normalizePart(indexName)}`;
