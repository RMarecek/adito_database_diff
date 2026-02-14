import { Router } from "express";
import { ok } from "../../common/http";
import { requireRoles } from "../../common/middleware/rbac";
import { ExecutionService } from "./execution.service";

export const buildExecutionsRouter = (executions: ExecutionService): Router => {
  const router = Router();

  router.get("/executions/:executionId", requireRoles("viewer", "editor", "executor", "approver", "admin"), async (req, res, next) => {
    try {
      const data = await executions.getExecution(req.params.executionId, req.correlationId);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
