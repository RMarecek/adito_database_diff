import type { Role } from "../common/auth-types";

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      auth?: {
        sub: string;
        roles: Role[];
      };
    }
  }
}

export {};
