import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("snapshotColumns")
@Index("idx_snapshotColumns_snapshot_table", ["snapshotId", "tableKey"])
export class SnapshotColumnEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  id!: string;

  @Column({ type: "varchar", length: 36 })
  snapshotId!: string;

  @Column({ type: "varchar", length: 256 })
  tableKey!: string;

  @Column({ type: "varchar", length: 384 })
  columnKey!: string;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  @Column({ type: "int" })
  ordinalPosition!: number;

  @Column({ type: "varchar", length: 32 })
  canonicalType!: string;

  @Column({ type: "varchar", length: 256 })
  nativeType!: string;

  @Column({ type: "int", nullable: true })
  length!: number | null;

  @Column({ type: "int", nullable: true })
  precision!: number | null;

  @Column({ type: "int", nullable: true })
  scale!: number | null;

  @Column({ type: "boolean", default: true })
  nullable!: boolean;

  @Column({ type: "text", nullable: true })
  defaultRaw!: string | null;

  @Column({ type: "text", nullable: true })
  comment!: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  charset!: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  collation!: string | null;
}
