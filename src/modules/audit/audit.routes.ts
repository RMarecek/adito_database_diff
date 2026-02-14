import { Router } from "express";
import { badRequest } from "../../common/errors";
import { ok } from "../../common/http";
import { requireRoles } from "../../common/middleware/rbac";
import { AuditService } from "./audit.service";

const parseIntQuery = (value: unknown, fallback: number): number => {
  if (typeof value === "undefined") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw badRequest("Invalid pagination argument");
  return Math.floor(n);
};

export const buildAuditRouter = (audit: AuditService): Router => {
  const router = Router();

  router.get("/audit", requireRoles("admin", "approver"), async (req, res, next) => {
    try {
      const result = await audit.search({
        tableKey: typeof req.query.tableKey === "string" ? req.query.tableKey : null,
        userId: typeof req.query.user === "string" ? req.query.user : null,
        from: typeof req.query.from === "string" ? req.query.from : null,
        to: typeof req.query.to === "string" ? req.query.to : null,
        offset: parseIntQuery(req.query.offset, 0),
        limit: parseIntQuery(req.query.limit, 200),
      });
      ok(res, result);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
