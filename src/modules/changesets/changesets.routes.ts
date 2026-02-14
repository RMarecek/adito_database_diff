import { Router } from "express";
import { ok } from "../../common/http";
import { requireRoles } from "../../common/middleware/rbac";
import { ChangeSetService } from "./changeset.service";

export const buildChangeSetsRouter = (changeSets: ChangeSetService): Router => {
  const router = Router();

  router.get("/changesets", requireRoles("viewer", "editor", "executor", "approver", "admin"), async (req, res, next) => {
    try {
      const items = await changeSets.list();
      ok(res, {
        items: items.map((x) => ({
          changeSetId: x.changeSetId,
          title: x.title,
          description: x.description,
          sourceCompareRunId: x.sourceCompareRunId,
          status: x.status,
          createdAt: x.createdAt.toISOString(),
          updatedAt: x.updatedAt.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/changesets", requireRoles("editor", "admin"), async (req, res, next) => {
    try {
      const created = await changeSets.create(req.body);
      ok(
        res,
        {
          changeSetId: created.changeSetId,
          status: created.status,
        },
        201,
      );
    } catch (err) {
      next(err);
    }
  });

  router.get("/changesets/:changeSetId", requireRoles("viewer", "editor", "executor", "approver", "admin"), async (req, res, next) => {
    try {
      const head = await changeSets.getOrFail(req.params.changeSetId);
      const steps = await changeSets.getSteps(req.params.changeSetId);
      ok(res, {
        changeSetId: head.changeSetId,
        title: head.title,
        description: head.description,
        status: head.status,
        steps,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/changesets/:changeSetId/steps", requireRoles("editor", "admin"), async (req, res, next) => {
    try {
      const steps = await changeSets.addSteps(req.params.changeSetId, req.body);
      ok(res, { steps });
    } catch (err) {
      next(err);
    }
  });

  router.post("/changesets/:changeSetId/plan/from-compare", requireRoles("editor", "admin"), async (req, res, next) => {
    try {
      const steps = await changeSets.planFromCompare(req.params.changeSetId, req.body);
      ok(res, { steps });
    } catch (err) {
      next(err);
    }
  });

  router.post("/changesets/:changeSetId/validate", requireRoles("editor", "executor", "admin"), async (req, res, next) => {
    try {
      const result = await changeSets.validate(req.params.changeSetId, req.body, req.correlationId);
      ok(res, result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/changesets/:changeSetId/execute", requireRoles("executor", "approver", "admin"), async (req, res, next) => {
    try {
      const executionIds = await changeSets.execute(req.params.changeSetId, req.body, {
        sub: req.auth?.sub ?? "unknown",
        correlationId: req.correlationId,
      });
      ok(
        res,
        {
          executionIds,
        },
        202,
      );
    } catch (err) {
      next(err);
    }
  });

  return router;
};
