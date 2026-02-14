import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("snapshotIndexes")
@Index("idx_snapshotIndexes_snapshot_table", ["snapshotId", "tableKey"])
export class SnapshotIndexEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  id!: string;

  @Column({ type: "varchar", length: 36 })
  snapshotId!: string;

  @Column({ type: "varchar", length: 256 })
  tableKey!: string;

  @Column({ type: "varchar", length: 384 })
  indexKey!: string;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  @Column({ type: "boolean", default: false })
  unique!: boolean;

  @Column({ type: "varchar", length: 64 })
  indexType!: string;

  @Column({ type: "text" })
  columnsJson!: string;

  @Column({ type: "text", nullable: true })
  whereClause!: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  tablespace!: string | null;
}
