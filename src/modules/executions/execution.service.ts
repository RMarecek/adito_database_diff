import { In } from "typeorm";
import { v4 as uuidv4 } from "uuid";
import { AppDataSource } from "../../config/data-source";
import { notFound } from "../../common/errors";
import { jobBus } from "../jobs/job-bus";
import type { ChangeStep } from "../schema/types";
import type { CrmConnectorService } from "../crmConnector/crm-connector.service";
import type { InstanceService } from "../instances/instance.service";
import { ExecutionEntity, type ExecutionStatus } from "./execution.entity";
import { ExecutionLogEntity } from "./execution-log.entity";

const terminal = new Set(["SUCCEEDED", "FAILED"]);

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const normalizeStatus = (value: string): ExecutionStatus => {
  const v = value.toUpperCase();
  if (v === "QUEUED" || v === "PENDING") return "QUEUED";
  if (v === "RUNNING" || v === "STARTED") return "RUNNING";
  if (v === "SUCCEEDED" || v === "SUCCESS" || v === "COMPLETED") return "SUCCEEDED";
  return "FAILED";
};

export class ExecutionService {
  private readonly executionRepo = AppDataSource.getRepository(ExecutionEntity);
  private readonly logRepo = AppDataSource.getRepository(ExecutionLogEntity);

  constructor(
    private readonly instances: InstanceService,
    private readonly crm: CrmConnectorService,
  ) {}

  async queueExecution(input: {
    changeSetId: string;
    changeSetTitle: string;
    schema: string;
    steps: ChangeStep[];
    instanceId: string;
    startedBy: string;
    stopOnError: boolean;
    correlationId: string;
  }): Promise<{ executionId: string; jobId: string }> {
    const instance = await this.instances.getOrFail(input.instanceId);
    const job = jobBus.createJob();
    const executionId = uuidv4();

    await this.executionRepo.save(
      this.executionRepo.create({
        executionId,
        changeSetId: input.changeSetId,
        instanceId: input.instanceId,
        jobId: job.jobId,
        startedBy: input.startedBy,
        status: "QUEUED",
      }),
    );

    jobBus.run(job.jobId, async () => {
      let after: string | null = null;
      try {
        await this.executionRepo.update(
          { executionId },
          {
            status: "RUNNING",
            startedAt: new Date(),
          },
        );

        const crmAccepted = await this.crm.ddlExecute(
          instance,
          {
            requestId: uuidv4(),
            schema: input.schema,
            changeSet: { id: input.changeSetId, title: input.changeSetTitle },
            steps: input.steps,
            options: { stopOnError: input.stopOnError, lockTimeoutSeconds: 60 },
          },
          input.correlationId,
        );

        await this.executionRepo.update(
          { executionId },
          {
            crmExecutionId: crmAccepted.executionId,
            rawStatusJson: JSON.stringify(crmAccepted),
          },
        );

        jobBus.emit(job.jobId, "job.progress", {
          executionId,
          crmExecutionId: crmAccepted.executionId,
          status: crmAccepted.status,
        });

        let reachedTerminal = false;
        for (let i = 0; i < 240; i += 1) {
          const statusResp = (await this.crm.ddlExecutionStatus(
            instance,
            crmAccepted.executionId,
            input.correlationId,
          )) as {
            status?: string;
            stepResults?: unknown[];
            [key: string]: unknown;
          };

          const normalized = normalizeStatus(String(statusResp.status ?? "RUNNING"));
          await this.executionRepo.update(
            { executionId },
            {
              status: normalized,
              rawStatusJson: JSON.stringify(statusResp),
            },
          );

          const logsResp = await this.crm.ddlExecutionLogs(
            instance,
            crmAccepted.executionId,
            after,
            input.correlationId,
          );

          if (logsResp.items.length > 0) {
            after = logsResp.items[logsResp.items.length - 1]?.time ?? after;
            await this.logRepo.save(
              logsResp.items.map((item) =>
                this.logRepo.create({
                  id: uuidv4(),
                  executionId,
                  time: new Date(item.time),
                  level: item.level,
                  message: item.message,
                }),
              ),
            );

            for (const item of logsResp.items) {
              jobBus.emit(job.jobId, "job.log", {
                executionId,
                level: item.level,
                time: item.time,
                message: item.message,
              });
            }
          }

          if (terminal.has(normalized)) {
            reachedTerminal = true;
            await this.executionRepo.update(
              { executionId },
              {
                endedAt: new Date(),
              },
            );
            break;
          }
          await sleep(1500);
        }

        if (!reachedTerminal) {
          await this.executionRepo.update(
            { executionId },
            {
              status: "FAILED",
              endedAt: new Date(),
              rawStatusJson: JSON.stringify({
                error: "Execution polling timeout",
              }),
            },
          );
          jobBus.emit(job.jobId, "job.log", {
            executionId,
            level: "ERROR",
            time: new Date().toISOString(),
            message: "Execution polling timeout",
          });
        }
      } catch (err) {
        await this.executionRepo.update(
          { executionId },
          {
            status: "FAILED",
            endedAt: new Date(),
            rawStatusJson: JSON.stringify({
              error: err instanceof Error ? err.message : "Unknown execution failure",
            }),
          },
        );
        throw err;
      }
    });

    return { executionId, jobId: job.jobId };
  }

  async getExecution(executionId: string, correlationId: string): Promise<{
    executionId: string;
    changeSetId: string;
    instanceId: string;
    jobId: string;
    startedBy: string;
    status: string;
    submittedAt: string;
    startedAt: string | null;
    endedAt: string | null;
    crm: unknown;
    logs: Array<{ time: string; level: string; message: string }>;
  }> {
    const row = await this.executionRepo.findOne({ where: { executionId } });
    if (!row) throw notFound(`Execution not found: ${executionId}`);

    let crmStatus: unknown = null;
    if (row.crmExecutionId) {
      try {
        const instance = await this.instances.getOrFail(row.instanceId);
        crmStatus = await this.crm.ddlExecutionStatus(instance, row.crmExecutionId, correlationId);
      } catch {
        crmStatus = null;
      }
    }

    const logs = await this.logRepo.find({
      where: { executionId },
      order: { time: "ASC" },
      take: 1000,
    });

    return {
      executionId: row.executionId,
      changeSetId: row.changeSetId,
      instanceId: row.instanceId,
      jobId: row.jobId,
      startedBy: row.startedBy,
      status: row.status,
      submittedAt: row.submittedAt.toISOString(),
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      crm: crmStatus ?? (row.rawStatusJson ? JSON.parse(row.rawStatusJson) : null),
      logs: logs.map((x) => ({
        time: x.time.toISOString(),
        level: x.level,
        message: x.message,
      })),
    };
  }

  async getExecutions(executionIds: string[]): Promise<ExecutionEntity[]> {
    if (executionIds.length === 0) return [];
    return this.executionRepo.find({
      where: { executionId: In(executionIds) },
    });
  }
}
