"use client";

const KEY = "schema_compare_snapshot_history";
const MAX_ITEMS = 200;

export interface SnapshotHistoryItem {
  snapshotId: string;
  instanceId: string;
  schema: string;
  createdAt: string;
}

const readAll = (): SnapshotHistoryItem[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SnapshotHistoryItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const getSnapshotHistory = (): SnapshotHistoryItem[] =>
  readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const addSnapshotHistory = (item: SnapshotHistoryItem): void => {
  const existing = readAll();
  const deduped = existing.filter((x) => x.snapshotId !== item.snapshotId);
  deduped.unshift(item);
  localStorage.setItem(KEY, JSON.stringify(deduped.slice(0, MAX_ITEMS)));
};
