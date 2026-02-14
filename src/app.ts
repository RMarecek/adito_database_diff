import cors from "cors";
import express from "express";
import { correlationIdMiddleware } from "./common/middleware/correlation-id";
import { authMiddleware } from "./common/middleware/auth";
import { notFoundHandler, errorHandler } from "./common/middleware/error-handler";
import { apiRouter } from "./modules/api-router";

export const createApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(correlationIdMiddleware);

  app.get("/healthz", (_req, res) => {
    res.status(200).json({
      correlationId: res.getHeader("X-Correlation-Id"),
      status: "ok",
      service: "schema-compare-backend",
      time: new Date().toISOString(),
    });
  });

  app.use("/api/v1", authMiddleware, apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
