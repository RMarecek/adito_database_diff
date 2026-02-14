import { validate as isUuid } from "uuid";
import { badRequest } from "../../common/errors";
import type { ChangeStep, StepAction } from "./types";

const ACTIONS: StepAction[] = [
  "CREATE_TABLE",
  "DROP_TABLE",
  "ADD_COLUMN",
  "DROP_COLUMN",
  "ALTER_COLUMN",
  "RENAME_TABLE",
  "RENAME_COLUMN",
  "CREATE_INDEX",
  "DROP_INDEX",
];

const mustHave = (ok: boolean, message: string): void => {
  if (!ok) throw badRequest(message);
};

export const validateChangeStep = (step: ChangeStep): void => {
  mustHave(isUuid(step.stepId), "stepId must be UUIDv4");
  mustHave(ACTIONS.includes(step.action), "Unsupported action");
  mustHave(Boolean(step.target?.schema), "target.schema is required");
  mustHave(Boolean(step.target?.table), "target.table is required");

  if (step.action === "CREATE_TABLE") {
    mustHave(Boolean(step.table), "CREATE_TABLE requires table payload");
  }
  if (step.action === "ADD_COLUMN" || step.action === "ALTER_COLUMN" || step.action === "RENAME_COLUMN") {
    mustHave(Boolean(step.column), `${step.action} requires column payload`);
  }
  if (step.action === "CREATE_INDEX") {
    mustHave(Boolean(step.index), "CREATE_INDEX requires index payload");
  }
};

export const validateChangeSteps = (steps: ChangeStep[]): void => {
  mustHave(Array.isArray(steps) && steps.length > 0, "steps must be a non-empty array");
  for (const step of steps) validateChangeStep(step);
};
