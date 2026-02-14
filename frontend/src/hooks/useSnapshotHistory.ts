"use client";

import { useCallback, useEffect, useState } from "react";
import { addSnapshotHistory, getSnapshotHistory, type SnapshotHistoryItem } from "@/lib/snapshot-history";

export const useSnapshotHistory = () => {
  const [items, setItems] = useState<SnapshotHistoryItem[]>([]);

  const refresh = useCallback(() => {
    setItems(getSnapshotHistory());
  }, []);

  const add = useCallback((item: SnapshotHistoryItem) => {
    addSnapshotHistory(item);
    setItems(getSnapshotHistory());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    items,
    add,
    refresh,
  };
};
