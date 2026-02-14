import type { NextFunction, Request, Response } from "express";
import { ApiError, internalError } from "../errors";

export const notFoundHandler = (_req: Request, _res: Response, next: NextFunction): void => {
  next(new ApiError(404, "NOT_FOUND", "Route not found"));
};

export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
  const normalized = err instanceof ApiError ? err : internalError();
  const correlationId = req.correlationId ?? String(res.getHeader("X-Correlation-Id") ?? "");

  res.status(normalized.statusCode).json({
    correlationId,
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details ?? {},
    },
  });
};
