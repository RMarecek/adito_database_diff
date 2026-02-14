import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";
import { dateTimeColumnType } from "../../config/column-types";

@Entity("auditEvents")
@Index("idx_auditEvents_tableKey_createdAt", ["tableKey", "createdAt"])
export class AuditEventEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  id!: string;

  @Column({ type: "varchar", length: 128 })
  userId!: string;

  @Column({ type: "varchar", length: 64 })
  action!: string;

  @Column({ type: "varchar", length: 256, nullable: true })
  tableKey!: string | null;

  @Column({ type: "text", nullable: true })
  payloadJson!: string | null;

  @Column({ type: "varchar", length: 36 })
  correlationId!: string;

  @CreateDateColumn({ type: dateTimeColumnType })
  createdAt!: Date;
}
