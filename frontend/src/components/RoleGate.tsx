"use client";

import type { ReactNode } from "react";
import { Alert } from "@mui/material";
import type { Role } from "@/lib/types";
import { useAuth } from "@/lib/auth";

export const RoleGate = ({
  roles,
  children,
  fallback,
}: {
  roles: Role[];
  children: ReactNode;
  fallback?: ReactNode;
}) => {
  const { hasRole } = useAuth();
  if (hasRole(...roles)) return <>{children}</>;
  return (
    <>
      {fallback ?? (
        <Alert severity="info">
          Hidden by RBAC. Required roles: <strong>{roles.join(", ")}</strong>
        </Alert>
      )}
    </>
  );
};
