import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("snapshotTables")
@Index("idx_snapshotTables_snapshot_tableKey", ["snapshotId", "tableKey"], { unique: true })
export class SnapshotTableEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  id!: string;

  @Column({ type: "varchar", length: 36 })
  snapshotId!: string;

  @Column({ type: "varchar", length: 256 })
  tableKey!: string;

  @Column({ type: "varchar", length: 128 })
  schema!: string;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  @Column({ type: "boolean", default: false })
  isView!: boolean;

  @Column({ type: "text", nullable: true })
  comment!: string | null;

  @Column({ type: "text", nullable: true })
  storageJson!: string | null;
}
