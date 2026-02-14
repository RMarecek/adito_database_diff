import { In } from "typeorm";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { AppDataSource } from "../../config/data-source";
import { badRequest, notFound } from "../../common/errors";
import { ChangeSetEntity } from "./changeset.entity";
import { ChangeSetStepEntity } from "./changeset-step.entity";
import type { ChangeStep, TableSpec } from "../schema/types";
import { validateChangeSteps } from "../schema/step-validation";
import type { CompareService } from "../compare/compare.service";
import { SnapshotEntity } from "../snapshots/snapshot.entity";
import type { SnapshotService } from "../snapshots/snapshot.service";
import { columnDefinitionKey, indexDefinitionKey } from "../schema/normalize";
import type { InstanceService } from "../instances/instance.service";
import type { CrmConnectorService } from "../crmConnector/crm-connector.service";
import type { ExecutionService } from "../executions/execution.service";

const createSchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().nullable().optional(),
  sourceCompareRunId: z.string().uuid().nullable().optional(),
});

const addStepsSchema = z.object({
  append: z.boolean(),
  steps: z.array(z.any()).min(1),
});

const planFromCompareSchema = z.object({
  compareRunId: z.string().uuid(),
  tableKeys: z.array(z.string()).min(1),
  targets: z.object({
    baselineInstanceId: z.string().uuid(),
    targetInstanceIds: z.array(z.string().uuid()).min(1),
  }),
  include: z.object({
    tables: z.boolean(),
    columns: z.boolean(),
    indexes: z.boolean(),
  }),
  strategy: z.object({
    alignToBaseline: z.boolean().default(true),
    allowDestructive: z.boolean().default(false),
  }),
});

const validateSchema = z.object({
  targetInstanceIds: z.array(z.string().uuid()).min(1),
  options: z.object({
    returnSqlPreview: z.boolean().default(true),
    strict: z.boolean().default(true),
  }),
});

const executeSchema = z.object({
  targetInstanceIds: z.array(z.string().uuid()).min(1),
  options: z.object({
    stopOnError: z.boolean().default(true),
  }),
});

const parseJson = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export class ChangeSetService {
  private readonly changeSetRepo = AppDataSource.getRepository(ChangeSetEntity);
  private readonly stepRepo = AppDataSource.getRepository(ChangeSetStepEntity);
  private readonly snapshotRepo = AppDataSource.getRepository(SnapshotEntity);

  constructor(
    private readonly compare: CompareService,
    private readonly snapshots: SnapshotService,
    private readonly instances: InstanceService,
    private readonly crm: CrmConnectorService,
    private readonly executions: ExecutionService,
  ) {}

  async list(): Promise<ChangeSetEntity[]> {
    return this.changeSetRepo.find({ order: { createdAt: "DESC" } });
  }

  async create(input: unknown): Promise<ChangeSetEntity> {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) throw badRequest("Invalid request payload", { issues: parsed.error.issues });
    const value = parsed.data;

    const entity = this.changeSetRepo.create({
      changeSetId: uuidv4(),
      title: value.title,
      description: value.description ?? null,
      sourceCompareRunId: value.sourceCompareRunId ?? null,
      status: "DRAFT",
    });
    return this.changeSetRepo.save(entity);
  }

  async getOrFail(changeSetId: string): Promise<ChangeSetEntity> {
    const item = await this.changeSetRepo.findOne({ where: { changeSetId } });
    if (!item) throw notFound(`ChangeSet not found: ${changeSetId}`);
    return item;
  }

  async getSteps(changeSetId: string): Promise<ChangeStep[]> {
    const rows = await this.stepRepo.find({
      where: { changeSetId },
      order: { stepOrder: "ASC" },
    });
    return rows.map((row) => ({
      stepId: row.stepId,
      action: row.action as ChangeStep["action"],
      target: parseJson(row.targetJson, { schema: "", table: "" }),
      table: parseJson(row.tableJson, null),
      column: parseJson(row.columnJson, null),
      index: parseJson(row.indexJson, null),
      options: parseJson(row.optionsJson, null),
    }));
  }

  async addSteps(changeSetId: string, input: unknown): Promise<ChangeStep[]> {
    await this.getOrFail(changeSetId);
    const parsed = addStepsSchema.safeParse(input);
    if (!parsed.success) throw badRequest("Invalid request payload", { issues: parsed.error.issues });
    const value = parsed.data;
    const steps = value.steps as ChangeStep[];
    validateChangeSteps(steps);

    if (!value.append) {
      await this.stepRepo.delete({ changeSetId });
    }
    const existingCount = await this.stepRepo.countBy({ changeSetId });
    const rows = steps.map((step, idx) =>
      this.stepRepo.create({
        stepId: step.stepId,
        changeSetId,
        stepOrder: existingCount + idx + 1,
        action: step.action,
        targetJson: JSON.stringify(step.target),
        tableJson: step.table ? JSON.stringify(step.table) : null,
        columnJson: step.column ? JSON.stringify(step.column) : null,
        indexJson: step.index ? JSON.stringify(step.index) : null,
        optionsJson: step.options ? JSON.stringify(step.options) : null,
      }),
    );
    await this.stepRepo.save(rows);
    return this.getSteps(changeSetId);
  }

  async planFromCompare(changeSetId: string, input: unknown): Promise<ChangeStep[]> {
    await this.getOrFail(changeSetId);
    const parsed = planFromCompareSchema.safeParse(input);
    if (!parsed.success) throw badRequest("Invalid request payload", { issues: parsed.error.issues });
    const value = parsed.data;

    const run = await this.compare.getRunOrFail(value.compareRunId);
    const snapshotRows = await this.snapshotRepo.findBy({
      snapshotId: In(run.snapshotIds),
    });

    const baselineSnapshot = snapshotRows.find((s) => s.instanceId === value.targets.baselineInstanceId);
    if (!baselineSnapshot) throw badRequest("baselineInstanceId does not belong to compare run");

    const targetSnapshots = snapshotRows.filter((s) => value.targets.targetInstanceIds.includes(s.instanceId));
    if (targetSnapshots.length === 0) throw badRequest("No target snapshots available for selected target instances");

    const baselineMap = await this.snapshots.tableMapForSnapshot(baselineSnapshot.snapshotId);
    const generated: ChangeStep[] = [];

    for (const tableKey of value.tableKeys.map((x) => x.toUpperCase())) {
      const baselineTable = baselineMap.get(tableKey);
      if (!baselineTable) continue;
      for (const targetSnapshot of targetSnapshots) {
        const targetMap = await this.snapshots.tableMapForSnapshot(targetSnapshot.snapshotId);
        const targetTable = targetMap.get(tableKey) ?? null;
        generated.push(
          ...this.planTableStepsForTarget({
            baselineTable,
            targetTable,
            include: value.include,
            allowDestructive: value.strategy.allowDestructive,
            ignoreIndexName: run.options.ignoreIndexName,
          }),
        );
      }
    }

    // dedupe by stable shape so multi-target planning does not produce redundant idempotent steps
    const unique = new Map<string, ChangeStep>();
    for (const step of generated) {
      const key = JSON.stringify({
        action: step.action,
        target: step.target,
        table: step.table,
        column: step.column,
        index: step.index,
        options: step.options,
      });
      if (!unique.has(key)) unique.set(key, step);
    }

    return this.addSteps(changeSetId, {
      append: false,
      steps: [...unique.values()],
    });
  }

  async validate(changeSetId: string, input: unknown, correlationId: string): Promise<{
    overallValid: boolean;
    perTarget: Record<string, { valid: boolean; results: unknown[] }>;
  }> {
    const parsed = validateSchema.safeParse(input);
    if (!parsed.success) throw badRequest("Invalid request payload", { issues: parsed.error.issues });
    const value = parsed.data;
    const changeSet = await this.getOrFail(changeSetId);
    const steps = await this.getSteps(changeSetId);
    if (steps.length === 0) throw badRequest("No steps in ChangeSet");

    const schema = String(steps[0]?.target.schema ?? "CRM");
    const perTarget: Record<string, { valid: boolean; results: unknown[] }> = {};

    for (const instanceId of value.targetInstanceIds) {
      const instance = await this.instances.getOrFail(instanceId);
      const response = (await this.crm.ddlValidate(
        instance,
        {
          schema,
          steps,
          options: value.options,
        },
        correlationId,
      )) as {
        valid?: boolean;
        results?: unknown[];
      };
      perTarget[instanceId] = {
        valid: Boolean(response.valid),
        results: response.results ?? [],
      };
    }

    const overallValid = Object.values(perTarget).every((x) => x.valid);
    if (overallValid) {
      await this.changeSetRepo.update({ changeSetId }, { status: "VALIDATED" });
    }
    return { overallValid, perTarget };
  }

  async execute(
    changeSetId: string,
    input: unknown,
    context: { sub: string; correlationId: string },
  ): Promise<Array<{ instanceId: string; executionId: string; jobId: string }>> {
    const parsed = executeSchema.safeParse(input);
    if (!parsed.success) throw badRequest("Invalid request payload", { issues: parsed.error.issues });
    const value = parsed.data;

    const changeSet = await this.getOrFail(changeSetId);
    const steps = await this.getSteps(changeSetId);
    if (steps.length === 0) throw badRequest("No steps in ChangeSet");
    const schema = String(steps[0]?.target.schema ?? "CRM");

    const executionIds: Array<{ instanceId: string; executionId: string; jobId: string }> = [];
    for (const targetInstanceId of value.targetInstanceIds) {
      const queued = await this.executions.queueExecution({
        changeSetId: changeSet.changeSetId,
        changeSetTitle: changeSet.title,
        schema,
        steps,
        instanceId: targetInstanceId,
        startedBy: context.sub,
        stopOnError: value.options.stopOnError,
        correlationId: context.correlationId,
      });
      executionIds.push({
        instanceId: targetInstanceId,
        executionId: queued.executionId,
        jobId: queued.jobId,
      });
    }
    await this.changeSetRepo.update({ changeSetId }, { status: "EXECUTED" });
    return executionIds;
  }

  private planTableStepsForTarget(input: {
    baselineTable: TableSpec;
    targetTable: TableSpec | null;
    include: { tables: boolean; columns: boolean; indexes: boolean };
    allowDestructive: boolean;
    ignoreIndexName: boolean;
  }): ChangeStep[] {
    const { baselineTable, targetTable, include, allowDestructive, ignoreIndexName } = input;
    const steps: ChangeStep[] = [];

    if (!targetTable) {
      if (include.tables) {
        steps.push({
          stepId: uuidv4(),
          action: "CREATE_TABLE",
          target: { schema: baselineTable.schema, table: baselineTable.name },
          table: baselineTable,
          column: null,
          index: null,
          options: { ifNotExists: true },
        });
      }
      if (include.columns) {
        for (const column of baselineTable.columns) {
          steps.push({
            stepId: uuidv4(),
            action: "ADD_COLUMN",
            target: { schema: baselineTable.schema, table: baselineTable.name },
            table: null,
            column,
            index: null,
            options: { ifNotExists: true },
          });
        }
      }
      if (include.indexes) {
        for (const index of baselineTable.indexes) {
          steps.push({
            stepId: uuidv4(),
            action: "CREATE_INDEX",
            target: { schema: baselineTable.schema, table: baselineTable.name },
            table: null,
            column: null,
            index,
            options: { ifNotExists: true },
          });
        }
      }
      return steps;
    }

    if (include.columns) {
      const targetByName = new Map(targetTable.columns.map((c) => [c.name, c]));
      const baselineByName = new Map(baselineTable.columns.map((c) => [c.name, c]));

      for (const baselineColumn of baselineTable.columns) {
        const targetColumn = targetByName.get(baselineColumn.name);
        if (!targetColumn) {
          steps.push({
            stepId: uuidv4(),
            action: "ADD_COLUMN",
            target: { schema: baselineTable.schema, table: baselineTable.name },
            table: null,
            column: baselineColumn,
            index: null,
            options: { ifNotExists: true },
          });
          continue;
        }

        if (
          columnDefinitionKey(baselineColumn, false) !==
          columnDefinitionKey(targetColumn, false)
        ) {
          steps.push({
            stepId: uuidv4(),
            action: "ALTER_COLUMN",
            target: { schema: baselineTable.schema, table: baselineTable.name },
            table: null,
            column: baselineColumn,
            index: null,
            options: null,
          });
        }
      }

      if (allowDestructive) {
        for (const targetColumn of targetTable.columns) {
          if (!baselineByName.has(targetColumn.name)) {
            steps.push({
              stepId: uuidv4(),
              action: "DROP_COLUMN",
              target: { schema: baselineTable.schema, table: baselineTable.name },
              table: null,
              column: targetColumn,
              index: null,
              options: { ifExists: true },
            });
          }
        }
      }
    }

    if (include.indexes) {
      const baselineKeyToIndex = new Map(
        baselineTable.indexes.map((idx) => [indexDefinitionKey(idx, ignoreIndexName), idx]),
      );
      const targetKeys = new Set(targetTable.indexes.map((idx) => indexDefinitionKey(idx, ignoreIndexName)));

      for (const [key, baselineIndex] of baselineKeyToIndex) {
        if (!targetKeys.has(key)) {
          steps.push({
            stepId: uuidv4(),
            action: "CREATE_INDEX",
            target: { schema: baselineTable.schema, table: baselineTable.name },
            table: null,
            column: null,
            index: baselineIndex,
            options: { ifNotExists: true },
          });
        }
      }

      if (allowDestructive) {
        const baselineKeys = new Set(baselineKeyToIndex.keys());
        for (const targetIndex of targetTable.indexes) {
          const key = indexDefinitionKey(targetIndex, ignoreIndexName);
          if (!baselineKeys.has(key)) {
            steps.push({
              stepId: uuidv4(),
              action: "DROP_INDEX",
              target: { schema: baselineTable.schema, table: baselineTable.name },
              table: null,
              column: null,
              index: targetIndex,
              options: { ifExists: true },
            });
          }
        }
      }
    }

    return steps;
  }
}
