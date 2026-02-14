import { Router } from "express";
import { notFound } from "../../common/errors";
import { requireRoles } from "../../common/middleware/rbac";
import { jobBus, type JobEvent } from "./job-bus";

const writeEvent = (res: import("express").Response, event: JobEvent): void => {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
};

export const buildJobsRouter = (): Router => {
  const router = Router();

  router.get("/jobs/:jobId/events", requireRoles("viewer", "editor", "executor", "approver", "admin"), (req, res, next) => {
    try {
      const state = jobBus.get(req.params.jobId);
      if (!state) throw notFound(`Job not found: ${req.params.jobId}`);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      for (const event of state.events) writeEvent(res, event);

      const unsubscribe = jobBus.subscribe(req.params.jobId, (event) => {
        writeEvent(res, event);
      });

      const keepAlive = setInterval(() => {
        res.write(": keep-alive\n\n");
      }, 15000);

      req.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
