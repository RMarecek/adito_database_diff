export const ALL_ROLES = ["viewer", "editor", "executor", "approver", "admin"] as const;

export type Role = (typeof ALL_ROLES)[number];
