import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";
import { dateTimeColumnType } from "../../config/column-types";

export type ExecutionStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

@Entity("executions")
export class ExecutionEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  executionId!: string;

  @Column({ type: "varchar", length: 36 })
  changeSetId!: string;

  @Column({ type: "varchar", length: 36 })
  instanceId!: string;

  @Column({ type: "varchar", length: 36 })
  jobId!: string;

  @Column({ type: "varchar", length: 128 })
  startedBy!: string;

  @Column({ type: "varchar", length: 16, default: "QUEUED" })
  status!: ExecutionStatus;

  @Column({ type: "varchar", length: 36, nullable: true })
  crmExecutionId!: string | null;

  @Column({ type: "text", nullable: true })
  rawStatusJson!: string | null;

  @CreateDateColumn({ type: dateTimeColumnType })
  submittedAt!: Date;

  @Column({ type: dateTimeColumnType, nullable: true })
  startedAt!: Date | null;

  @Column({ type: dateTimeColumnType, nullable: true })
  endedAt!: Date | null;
}
