import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import { dateTimeColumnType } from "../../config/column-types";

export type ChangeSetStatus = "DRAFT" | "VALIDATED" | "EXECUTED";

@Entity("changeSets")
export class ChangeSetEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  changeSetId!: string;

  @Column({ type: "varchar", length: 256 })
  title!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "varchar", length: 36, nullable: true })
  sourceCompareRunId!: string | null;

  @Column({ type: "varchar", length: 16, default: "DRAFT" })
  status!: ChangeSetStatus;

  @CreateDateColumn({ type: dateTimeColumnType })
  createdAt!: Date;

  @UpdateDateColumn({ type: dateTimeColumnType })
  updatedAt!: Date;
}
