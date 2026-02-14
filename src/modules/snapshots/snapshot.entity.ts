import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import { dateTimeColumnType } from "../../config/column-types";

export type SnapshotStatus = "QUEUED" | "RUNNING" | "READY" | "FAILED";

@Entity("snapshots")
export class SnapshotEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  snapshotId!: string;

  @Column({ type: "varchar", length: 36 })
  instanceId!: string;

  @Column({ type: "varchar", length: 128 })
  schema!: string;

  @Column({ type: "varchar", length: 16, default: "QUEUED" })
  status!: SnapshotStatus;

  @Column({ type: "varchar", length: 36, nullable: true })
  jobId!: string | null;

  @Column({ type: "int", default: 0 })
  statsTables!: number;

  @Column({ type: "int", default: 0 })
  statsColumns!: number;

  @Column({ type: "int", default: 0 })
  statsIndexes!: number;

  @Column({ type: "text", nullable: true })
  errorMessage!: string | null;

  @Column({ type: dateTimeColumnType, nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ type: dateTimeColumnType })
  createdAt!: Date;

  @UpdateDateColumn({ type: dateTimeColumnType })
  updatedAt!: Date;
}
