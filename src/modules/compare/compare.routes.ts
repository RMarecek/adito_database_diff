import { Router } from "express";
import { badRequest } from "../../common/errors";
import { ok } from "../../common/http";
import { requireRoles } from "../../common/middleware/rbac";
import { CompareService } from "./compare.service";

const parseIntQuery = (value: unknown, fallback: number): number => {
  if (typeof value === "undefined") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw badRequest("Invalid pagination argument");
  return Math.floor(n);
};

export const buildCompareRouter = (compareService: CompareService): Router => {
  const router = Router();

  router.post("/compare-runs", requireRoles("viewer", "editor", "admin"), async (req, res, next) => {
    try {
      const run = await compareService.createRun(req.body);
      ok(
        res,
        {
          compareRunId: run.compareRunId,
          status: run.status,
          createdAt: run.createdAt.toISOString(),
        },
        201,
      );
    } catch (err) {
      next(err);
    }
  });

  router.get("/compare-runs/:compareRunId/matrix", requireRoles("viewer", "editor", "executor", "approver", "admin"), async (req, res, next) => {
    try {
      const data = await compareService.getMatrix(req.params.compareRunId, {
        level: typeof req.query.level === "string" ? req.query.level : undefined,
        onlyDifferences: req.query.onlyDifferences,
        search: typeof req.query.search === "string" ? req.query.search : null,
        offset: parseIntQuery(req.query.offset, 0),
        limit: parseIntQuery(req.query.limit, 200),
      });
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  router.get("/compare-runs/:compareRunId/details", requireRoles("viewer", "editor", "executor", "approver", "admin"), async (req, res, next) => {
    try {
      const tableKey = typeof req.query.tableKey === "string" ? req.query.tableKey : "";
      if (!tableKey) throw badRequest("tableKey is required");
      const details = await compareService.getDetails(req.params.compareRunId, tableKey);
      ok(res, details);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
