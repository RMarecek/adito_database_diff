import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("changeSetSteps")
@Index("idx_changeSetSteps_changeSet_order", ["changeSetId", "stepOrder"], { unique: true })
export class ChangeSetStepEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  stepId!: string;

  @Column({ type: "varchar", length: 36 })
  changeSetId!: string;

  @Column({ type: "int" })
  stepOrder!: number;

  @Column({ type: "varchar", length: 32 })
  action!: string;

  @Column({ type: "text" })
  targetJson!: string;

  @Column({ type: "text", nullable: true })
  tableJson!: string | null;

  @Column({ type: "text", nullable: true })
  columnJson!: string | null;

  @Column({ type: "text", nullable: true })
  indexJson!: string | null;

  @Column({ type: "text", nullable: true })
  optionsJson!: string | null;
}
