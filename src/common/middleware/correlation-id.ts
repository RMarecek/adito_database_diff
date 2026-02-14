import type { NextFunction, Request, Response } from "express";
import { validate as isUuid } from "uuid";
import { v4 as uuidv4 } from "uuid";

const HEADER_NAME = "X-Correlation-Id";

export const correlationIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.header(HEADER_NAME);
  const correlationId = incoming && isUuid(incoming) ? incoming : uuidv4();

  req.correlationId = correlationId;
  res.setHeader(HEADER_NAME, correlationId);
  next();
};
