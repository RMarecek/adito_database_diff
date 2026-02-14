import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
} from "typeorm";

export class InitSchema202602130001 implements MigrationInterface {
  name = "InitSchema202602130001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type;
    const textType = dbType === "oracle" ? "clob" : "text";
    const boolType = dbType === "oracle" ? "number" : dbType === "mariadb" ? "tinyint" : "integer";
    const intType = dbType === "oracle" ? "number" : "int";
    const dateType = dbType === "sqlite" ? "datetime" : "timestamp";
    const nowDefault = dbType === "oracle" ? "SYSTIMESTAMP" : "CURRENT_TIMESTAMP";

    await queryRunner.createTable(
      new Table({
        name: "instances",
        columns: [
          { name: "instanceId", type: "varchar", length: "36", isPrimary: true },
          { name: "name", type: "varchar", length: "128" },
          { name: "environment", type: "varchar", length: "32" },
          { name: "crmBaseUrl", type: "varchar", length: "1024" },
          { name: "dbType", type: "varchar", length: "16" },
          { name: "defaultSchema", type: "varchar", length: "128" },
          { name: "capabilitiesRead", type: boolType, default: "1" },
          { name: "capabilitiesWrite", type: boolType, default: "0" },
          { name: "authRef", type: "varchar", length: "1024", isNullable: true },
          { name: "createdAt", type: dateType, default: nowDefault },
          { name: "updatedAt", type: dateType, default: nowDefault },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: "snapshots",
        columns: [
          { name: "snapshotId", type: "varchar", length: "36", isPrimary: true },
          { name: "instanceId", type: "varchar", length: "36" },
          { name: "schema", type: "varchar", length: "128" },
          { name: "status", type: "varchar", length: "16", default: "'QUEUED'" },
          { name: "jobId", type: "varchar", length: "36", isNullable: true },
          { name: "statsTables", type: intType, default: "0" },
          { name: "statsColumns", type: intType, default: "0" },
          { name: "statsIndexes", type: intType, default: "0" },
          { name: "errorMessage", type: textType, isNullable: true },
          { name: "completedAt", type: dateType, isNullable: true },
          { name: "createdAt", type: dateType, default: nowDefault },
          { name: "updatedAt", type: dateType, default: nowDefault },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: "snapshotTables",
        columns: [
          { name: "id", type: "varchar", length: "36", isPrimary: true },
          { name: "snapshotId", type: "varchar", length: "36" },
          { name: "tableKey", type: "varchar", length: "256" },
          { name: "schema", type: "varchar", length: "128" },
          { name: "name", type: "varchar", length: "128" },
          { name: "isView", type: boolType, default: "0" },
          { name: "comment", type: textType, isNullable: true },
          { name: "storageJson", type: textType, isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      "snapshotTables",
      new TableIndex({
        name: "idx_snapshotTables_snapshot_tableKey",
        columnNames: ["snapshotId", "tableKey"],
        isUnique: true,
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "snapshotColumns",
        columns: [
          { name: "id", type: "varchar", length: "36", isPrimary: true },
          { name: "snapshotId", type: "varchar", length: "36" },
          { name: "tableKey", type: "varchar", length: "256" },
          { name: "columnKey", type: "varchar", length: "384" },
          { name: "name", type: "varchar", length: "128" },
          { name: "ordinalPosition", type: intType },
          { name: "canonicalType", type: "varchar", length: "32" },
          { name: "nativeType", type: "varchar", length: "256" },
          { name: "length", type: intType, isNullable: true },
          { name: "precision", type: intType, isNullable: true },
          { name: "scale", type: intType, isNullable: true },
          { name: "nullable", type: boolType, default: "1" },
          { name: "defaultRaw", type: textType, isNullable: true },
          { name: "comment", type: textType, isNullable: true },
          { name: "charset", type: "varchar", length: "64", isNullable: true },
          { name: "collation", type: "varchar", length: "128", isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      "snapshotColumns",
      new TableIndex({
        name: "idx_snapshotColumns_snapshot_table",
        columnNames: ["snapshotId", "tableKey"],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "snapshotIndexes",
        columns: [
          { name: "id", type: "varchar", length: "36", isPrimary: true },
          { name: "snapshotId", type: "varchar", length: "36" },
          { name: "tableKey", type: "varchar", length: "256" },
          { name: "indexKey", type: "varchar", length: "384" },
          { name: "name", type: "varchar", length: "128" },
          { name: "unique", type: boolType, default: "0" },
          { name: "indexType", type: "varchar", length: "64" },
          { name: "columnsJson", type: textType },
          { name: "whereClause", type: textType, isNullable: true },
          { name: "tablespace", type: "varchar", length: "128", isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      "snapshotIndexes",
      new TableIndex({
        name: "idx_snapshotIndexes_snapshot_table",
        columnNames: ["snapshotId", "tableKey"],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "compareRuns",
        columns: [
          { name: "compareRunId", type: "varchar", length: "36", isPrimary: true },
          { name: "baselineSnapshotId", type: "varchar", length: "36" },
          { name: "snapshotIdsJson", type: textType },
          { name: "optionsJson", type: textType },
          { name: "status", type: "varchar", length: "16", default: "'READY'" },
          { name: "createdAt", type: dateType, default: nowDefault },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: "changeSets",
        columns: [
          { name: "changeSetId", type: "varchar", length: "36", isPrimary: true },
          { name: "title", type: "varchar", length: "256" },
          { name: "description", type: textType, isNullable: true },
          { name: "sourceCompareRunId", type: "varchar", length: "36", isNullable: true },
          { name: "status", type: "varchar", length: "16", default: "'DRAFT'" },
          { name: "createdAt", type: dateType, default: nowDefault },
          { name: "updatedAt", type: dateType, default: nowDefault },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: "changeSetSteps",
        columns: [
          { name: "stepId", type: "varchar", length: "36", isPrimary: true },
          { name: "changeSetId", type: "varchar", length: "36" },
          { name: "stepOrder", type: intType },
          { name: "action", type: "varchar", length: "32" },
          { name: "targetJson", type: textType },
          { name: "tableJson", type: textType, isNullable: true },
          { name: "columnJson", type: textType, isNullable: true },
          { name: "indexJson", type: textType, isNullable: true },
          { name: "optionsJson", type: textType, isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      "changeSetSteps",
      new TableIndex({
        name: "idx_changeSetSteps_changeSet_order",
        columnNames: ["changeSetId", "stepOrder"],
        isUnique: true,
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "executions",
        columns: [
          { name: "executionId", type: "varchar", length: "36", isPrimary: true },
          { name: "changeSetId", type: "varchar", length: "36" },
          { name: "instanceId", type: "varchar", length: "36" },
          { name: "jobId", type: "varchar", length: "36" },
          { name: "startedBy", type: "varchar", length: "128" },
          { name: "status", type: "varchar", length: "16", default: "'QUEUED'" },
          { name: "crmExecutionId", type: "varchar", length: "36", isNullable: true },
          { name: "rawStatusJson", type: textType, isNullable: true },
          { name: "submittedAt", type: dateType, default: nowDefault },
          { name: "startedAt", type: dateType, isNullable: true },
          { name: "endedAt", type: dateType, isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: "executionLogs",
        columns: [
          { name: "id", type: "varchar", length: "36", isPrimary: true },
          { name: "executionId", type: "varchar", length: "36" },
          { name: "time", type: dateType },
          { name: "level", type: "varchar", length: "12" },
          { name: "message", type: textType },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      "executionLogs",
      new TableIndex({
        name: "idx_executionLogs_execution_time",
        columnNames: ["executionId", "time"],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "auditEvents",
        columns: [
          { name: "id", type: "varchar", length: "36", isPrimary: true },
          { name: "userId", type: "varchar", length: "128" },
          { name: "action", type: "varchar", length: "64" },
          { name: "tableKey", type: "varchar", length: "256", isNullable: true },
          { name: "payloadJson", type: textType, isNullable: true },
          { name: "correlationId", type: "varchar", length: "36" },
          { name: "createdAt", type: dateType, default: nowDefault },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      "auditEvents",
      new TableIndex({
        name: "idx_auditEvents_tableKey_createdAt",
        columnNames: ["tableKey", "createdAt"],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("auditEvents", true);
    await queryRunner.dropTable("executionLogs", true);
    await queryRunner.dropTable("executions", true);
    await queryRunner.dropTable("changeSetSteps", true);
    await queryRunner.dropTable("changeSets", true);
    await queryRunner.dropTable("compareRuns", true);
    await queryRunner.dropTable("snapshotIndexes", true);
    await queryRunner.dropTable("snapshotColumns", true);
    await queryRunner.dropTable("snapshotTables", true);
    await queryRunner.dropTable("snapshots", true);
    await queryRunner.dropTable("instances", true);
  }
}
