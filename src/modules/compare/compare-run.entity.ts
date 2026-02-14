import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";
import { dateTimeColumnType } from "../../config/column-types";

@Entity("compareRuns")
export class CompareRunEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  compareRunId!: string;

  @Column({ type: "varchar", length: 36 })
  baselineSnapshotId!: string;

  @Column({ type: "text" })
  snapshotIdsJson!: string;

  @Column({ type: "text" })
  optionsJson!: string;

  @Column({ type: "varchar", length: 16, default: "READY" })
  status!: "READY";

  @CreateDateColumn({ type: dateTimeColumnType })
  createdAt!: Date;
}
