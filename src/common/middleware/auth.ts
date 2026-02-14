import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { unauthorized } from "../errors";
import { ALL_ROLES, type Role } from "../auth-types";

type TokenPayload = jwt.JwtPayload & {
  roles?: string[] | string;
};

const coerceRoles = (value: TokenPayload["roles"]): Role[] => {
  const asArray = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return asArray.filter((role): role is Role => ALL_ROLES.includes(role as Role));
};

export const authMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
  if (!env.AUTH_REQUIRED) {
    req.auth = { sub: "dev-user", roles: ["admin"] };
    next();
    return;
  }

  const header = req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    next(unauthorized("Missing bearer token"));
    return;
  }

  const token = header.slice("Bearer ".length).trim();
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }) as TokenPayload;

    req.auth = {
      sub: String(decoded.sub ?? "unknown"),
      roles: coerceRoles(decoded.roles),
    };
    next();
  } catch {
    next(unauthorized("Invalid bearer token"));
  }
};
