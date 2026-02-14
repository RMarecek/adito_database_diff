import { Router } from "express";
import { badRequest } from "../../common/errors";
import { ok } from "../../common/http";
import { requireRoles } from "../../common/middleware/rbac";
import { SnapshotService } from "./snapshot.service";

const parseIntQuery = (value: unknown, fallback: number): number => {
  if (typeof value === "undefined") return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) throw badRequest("Invalid pagination argument");
  return Math.floor(num);
};

export const buildSnapshotsRouter = (snapshotService: SnapshotService): Router => {
  const router = Router();

  router.post(
    "/instances/:instanceId/snapshots",
    requireRoles("editor", "admin"),
    async (req, res, next) => {
      try {
        const result = await snapshotService.createSnapshot(
          req.params.instanceId,
          req.body,
          req.correlationId,
        );
        ok(res, result, 202);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get("/snapshots/:snapshotId", requireRoles("viewer", "editor", "executor", "approver", "admin"), async (req, res, next) => {
    try {
      const snapshot = await snapshotService.getSnapshot(req.params.snapshotId);
      ok(res, {
        snapshotId: snapshot.snapshotId,
        instanceId: snapshot.instanceId,
        schema: snapshot.schema,
        status: snapshot.status,
        createdAt: snapshot.createdAt.toISOString(),
        stats: {
          tables: snapshot.statsTables,
          columns: snapshot.statsColumns,
          indexes: snapshot.statsIndexes,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/snapshots/:snapshotId/tables", requireRoles("viewer", "editor", "executor", "approver", "admin"), async (req, res, next) => {
    try {
      const result = await snapshotService.listTables(req.params.snapshotId, {
        search: typeof req.query.search === "string" ? req.query.search : null,
        onlyDifferencesFromSnapshotId:
          typeof req.query.onlyDifferencesFromSnapshotId === "string"
            ? req.query.onlyDifferencesFromSnapshotId
            : null,
        offset: parseIntQuery(req.query.offset, 0),
        limit: parseIntQuery(req.query.limit, 200),
      });
      ok(res, result);
    } catch (err) {
      next(err);
    }
  });

  router.get("/snapshots/:snapshotId/tables/:tableKey", requireRoles("viewer", "editor", "executor", "approver", "admin"), async (req, res, next) => {
    try {
      const table = await snapshotService.getTable(req.params.snapshotId, req.params.tableKey);
      ok(res, { table });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
