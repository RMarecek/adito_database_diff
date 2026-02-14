import type { NextFunction, Request, Response } from "express";
import type { Role } from "../auth-types";
import { forbidden, unauthorized } from "../errors";

export const requireRoles =
  (...required: Role[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(unauthorized());
      return;
    }

    const set = new Set(req.auth.roles);
    const allowed = required.length === 0 || required.some((role) => set.has(role));
    if (!allowed) {
      next(forbidden());
      return;
    }
    next();
  };
