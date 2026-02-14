import { Router } from "express";
import { ok } from "../../common/http";
import { requireRoles } from "../../common/middleware/rbac";
import { InstanceService } from "./instance.service";

const toApiItem = (
  x: {
  instanceId: string;
  name: string;
  environment: string;
  crmBaseUrl: string;
  dbType: "oracle" | "mariadb";
  defaultSchema: string;
  capabilitiesRead: boolean;
  capabilitiesWrite: boolean;
  authRef: string | null;
  lastSnapshotAt?: Date | null;
},
  options: { includeAuthRef?: boolean } = {},
) => ({
  instanceId: x.instanceId,
  name: x.name,
  environment: x.environment,
  crmBaseUrl: x.crmBaseUrl,
  dbType: x.dbType,
  defaultSchema: x.defaultSchema,
  capabilities: {
    read: x.capabilitiesRead,
    write: x.capabilitiesWrite,
  },
  ...(options.includeAuthRef ? { authRef: x.authRef } : {}),
  lastSnapshotAt: x.lastSnapshotAt ? x.lastSnapshotAt.toISOString() : null,
});

export const buildInstancesRouter = (instanceService: InstanceService): Router => {
  const router = Router();

  router.get("/", requireRoles("viewer", "editor", "executor", "approver", "admin"), async (req, res, next) => {
    try {
      const items = await instanceService.list();
      ok(res, {
        items: items.map((x) => toApiItem(x)),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", requireRoles("admin"), async (req, res, next) => {
    try {
      const created = await instanceService.create(req.body);
      ok(
        res,
        {
          item: toApiItem(created, { includeAuthRef: true }),
        },
        201,
      );
    } catch (err) {
      next(err);
    }
  });

  router.put("/:instanceId", requireRoles("admin"), async (req, res, next) => {
    try {
      const updated = await instanceService.update(req.params.instanceId, req.body);
      ok(res, { item: toApiItem(updated, { includeAuthRef: true }) });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
