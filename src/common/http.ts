import type { Response } from "express";

export const ok = <T extends Record<string, unknown>>(res: Response, body: T, statusCode = 200): void => {
  res.status(statusCode).json({
    correlationId: res.getHeader("X-Correlation-Id"),
    ...body,
  });
};
