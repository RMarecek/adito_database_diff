import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import { dateTimeColumnType } from "../../config/column-types";

export type InstanceDbType = "oracle" | "mariadb";

@Entity("instances")
export class InstanceEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  instanceId!: string;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  @Column({ type: "varchar", length: 32 })
  environment!: string;

  @Column({ type: "varchar", length: 1024 })
  crmBaseUrl!: string;

  @Column({ type: "varchar", length: 16 })
  dbType!: InstanceDbType;

  @Column({ type: "varchar", length: 128 })
  defaultSchema!: string;

  @Column({ type: "boolean", default: true })
  capabilitiesRead!: boolean;

  @Column({ type: "boolean", default: false })
  capabilitiesWrite!: boolean;

  @Column({ type: "varchar", length: 1024, nullable: true })
  authRef!: string | null;

  @CreateDateColumn({ type: dateTimeColumnType })
  createdAt!: Date;

  @UpdateDateColumn({ type: dateTimeColumnType })
  updatedAt!: Date;
}
