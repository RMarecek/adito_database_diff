import { Column, Entity, Index, PrimaryColumn } from "typeorm";
import { dateTimeColumnType } from "../../config/column-types";

@Entity("executionLogs")
@Index("idx_executionLogs_execution_time", ["executionId", "time"])
export class ExecutionLogEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  id!: string;

  @Column({ type: "varchar", length: 36 })
  executionId!: string;

  @Column({ type: dateTimeColumnType })
  time!: Date;

  @Column({ type: "varchar", length: 12 })
  level!: string;

  @Column({ type: "text" })
  message!: string;
}
