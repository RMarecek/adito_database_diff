import "reflect-metadata";
import { DataSource, type DataSourceOptions } from "typeorm";
import { env } from "./env";
import { InstanceEntity } from "../modules/instances/instance.entity";
import { SnapshotEntity } from "../modules/snapshots/snapshot.entity";
import { SnapshotTableEntity } from "../modules/snapshots/snapshot-table.entity";
import { SnapshotColumnEntity } from "../modules/snapshots/snapshot-column.entity";
import { SnapshotIndexEntity } from "../modules/snapshots/snapshot-index.entity";
import { CompareRunEntity } from "../modules/compare/compare-run.entity";
import { ChangeSetEntity } from "../modules/changesets/changeset.entity";
import { ChangeSetStepEntity } from "../modules/changesets/changeset-step.entity";
import { ExecutionEntity } from "../modules/executions/execution.entity";
import { ExecutionLogEntity } from "../modules/executions/execution-log.entity";
import { AuditEventEntity } from "../modules/audit/audit-event.entity";
import { InitSchema202602130001 } from "../migrations/202602130001-init-schema";

const common = {
  entities: [
    InstanceEntity,
    SnapshotEntity,
    SnapshotTableEntity,
    SnapshotColumnEntity,
    SnapshotIndexEntity,
    CompareRunEntity,
    ChangeSetEntity,
    ChangeSetStepEntity,
    ExecutionEntity,
    ExecutionLogEntity,
    AuditEventEntity,
  ],
  migrations: [InitSchema202602130001],
  synchronize: env.DB_SYNCHRONIZE,
  logging: env.DB_LOGGING,
};

const buildOptions = (): DataSourceOptions => {
  if (env.DB_TYPE === "sqlite") {
    const options = {
      type: "sqlite",
      database: env.SQLITE_PATH,
      ...common,
    };
    return options as DataSourceOptions;
  }
  if (env.DB_TYPE === "mariadb") {
    const options = {
      type: "mariadb",
      host: env.DB_HOST,
      port: env.DB_PORT,
      username: env.DB_USERNAME,
      password: env.DB_PASSWORD,
      database: env.DB_DATABASE,
      ...common,
    };
    return options as DataSourceOptions;
  }
  const options = {
    type: "oracle",
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    sid: env.DB_SID,
    serviceName: env.DB_SERVICE_NAME || undefined,
    ...common,
  };
  return options as DataSourceOptions;
};

export const AppDataSource = new DataSource(buildOptions());
