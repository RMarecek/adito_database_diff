import { Router } from "express";
import { buildInstancesRouter } from "./instances/instances.routes";
import { InstanceService } from "./instances/instance.service";
import { CrmConnectorService } from "./crmConnector/crm-connector.service";
import { SnapshotService } from "./snapshots/snapshot.service";
import { buildSnapshotsRouter } from "./snapshots/snapshots.routes";
import { CompareService } from "./compare/compare.service";
import { buildCompareRouter } from "./compare/compare.routes";
import { ExecutionService } from "./executions/execution.service";
import { buildExecutionsRouter } from "./executions/executions.routes";
import { ChangeSetService } from "./changesets/changeset.service";
import { buildChangeSetsRouter } from "./changesets/changesets.routes";
import { buildJobsRouter } from "./jobs/jobs.routes";
import { AuditService } from "./audit/audit.service";
import { buildAuditRouter } from "./audit/audit.routes";

const instanceService = new InstanceService();
const crmConnector = new CrmConnectorService();
const snapshotService = new SnapshotService(instanceService, crmConnector);
const compareService = new CompareService(snapshotService);
const executionService = new ExecutionService(instanceService, crmConnector);
const changeSetService = new ChangeSetService(
  compareService,
  snapshotService,
  instanceService,
  crmConnector,
  executionService,
);
const auditService = new AuditService();

export const apiRouter = Router();
apiRouter.use("/instances", buildInstancesRouter(instanceService));
apiRouter.use("/", buildSnapshotsRouter(snapshotService));
apiRouter.use("/", buildCompareRouter(compareService));
apiRouter.use("/", buildChangeSetsRouter(changeSetService));
apiRouter.use("/", buildExecutionsRouter(executionService));
apiRouter.use("/", buildJobsRouter());
apiRouter.use("/", buildAuditRouter(auditService));
