import type { MatrixRow } from "../schema/diff";

export const paginateMatrixRows = (
  rows: MatrixRow[],
  offset: number,
  limit: number,
): { total: number; items: MatrixRow[] } => ({
  total: rows.length,
  items: rows.slice(offset, offset + limit),
});
