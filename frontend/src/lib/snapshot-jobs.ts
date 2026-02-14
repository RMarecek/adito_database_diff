import { api } from "./api";
import type { SnapshotSummary } from "./types";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const waitForSnapshotReady = async (
  snapshotId: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    onUpdate?: (snapshot: SnapshotSummary) => void;
  } = {},
): Promise<SnapshotSummary> => {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 1500;
  const startedAt = Date.now();

  while (true) {
    const snapshot = await api.getSnapshot(snapshotId);
    options.onUpdate?.(snapshot);
    if (snapshot.status === "READY") return snapshot;
    if (snapshot.status === "FAILED") {
      throw new Error(`Snapshot ${snapshotId} failed`);
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Snapshot ${snapshotId} timed out`);
    }
    await sleep(intervalMs);
  }
};
