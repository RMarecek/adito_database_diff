import { type FindOptionsWhere } from "typeorm";
import { v4 as uuidv4 } from "uuid";
import { AppDataSource } from "../../config/data-source";
import { AuditEventEntity } from "./audit-event.entity";

export class AuditService {
  private readonly repo = AppDataSource.getRepository(AuditEventEntity);

  async log(input: {
    userId: string;
    action: string;
    tableKey?: string | null;
    payload?: Record<string, unknown> | null;
    correlationId: string;
  }): Promise<void> {
    await this.repo.save(
      this.repo.create({
        id: uuidv4(),
        userId: input.userId,
        action: input.action,
        tableKey: input.tableKey ?? null,
        payloadJson: input.payload ? JSON.stringify(input.payload) : null,
        correlationId: input.correlationId,
      }),
    );
  }

  async search(query: {
    tableKey?: string | null;
    userId?: string | null;
    from?: string | null;
    to?: string | null;
    offset: number;
    limit: number;
  }): Promise<{ total: number; items: Array<Record<string, unknown>> }> {
    const where: FindOptionsWhere<AuditEventEntity> = {};
    if (query.tableKey) where.tableKey = query.tableKey.toUpperCase();
    if (query.userId) where.userId = query.userId;

    const qb = this.repo.createQueryBuilder("a");
    if (where.tableKey) qb.andWhere("a.tableKey = :tableKey", { tableKey: where.tableKey });
    if (where.userId) qb.andWhere("a.userId = :userId", { userId: where.userId });
    if (query.from) qb.andWhere("a.createdAt >= :from", { from: new Date(query.from) });
    if (query.to) qb.andWhere("a.createdAt <= :to", { to: new Date(query.to) });
    qb.orderBy("a.createdAt", "DESC").skip(query.offset).take(query.limit);

    const [rows, total] = await qb.getManyAndCount();

    return {
      total,
      items: rows.map((x) => ({
        id: x.id,
        userId: x.userId,
        action: x.action,
        tableKey: x.tableKey,
        payload: x.payloadJson ? JSON.parse(x.payloadJson) : null,
        correlationId: x.correlationId,
        time: x.createdAt.toISOString(),
      })),
    };
  }
}
