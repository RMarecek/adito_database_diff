import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { AppDataSource } from "../../config/data-source";
import { badRequest, notFound } from "../../common/errors";
import { InstanceEntity } from "./instance.entity";
import { SnapshotEntity } from "../snapshots/snapshot.entity";

const createSchema = z.object({
  name: z.string().min(1).max(128),
  environment: z.string().min(1).max(32),
  crmBaseUrl: z.string().url(),
  dbType: z.enum(["oracle", "mariadb"]),
  defaultSchema: z.string().min(1).max(128),
  capabilities: z.object({
    read: z.boolean(),
    write: z.boolean(),
  }),
  authRef: z.string().max(1024).nullable().optional(),
});

const updateSchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    environment: z.string().min(1).max(32).optional(),
    crmBaseUrl: z.string().url().optional(),
    dbType: z.enum(["oracle", "mariadb"]).optional(),
    defaultSchema: z.string().min(1).max(128).optional(),
    capabilities: z
      .object({
        read: z.boolean(),
        write: z.boolean(),
      })
      .optional(),
    authRef: z.string().max(1024).nullable().optional(),
  })
  .refine(
    (value) =>
      typeof value.name !== "undefined" ||
      typeof value.environment !== "undefined" ||
      typeof value.crmBaseUrl !== "undefined" ||
      typeof value.dbType !== "undefined" ||
      typeof value.defaultSchema !== "undefined" ||
      typeof value.capabilities !== "undefined" ||
      typeof value.authRef !== "undefined",
    {
      message: "At least one field must be provided",
      path: [],
    },
  );

export type CreateInstanceInput = z.infer<typeof createSchema>;
export type UpdateInstanceInput = z.infer<typeof updateSchema>;

export class InstanceService {
  private readonly repo = AppDataSource.getRepository(InstanceEntity);
  private readonly snapshotRepo = AppDataSource.getRepository(SnapshotEntity);

  async list(): Promise<Array<InstanceEntity & { lastSnapshotAt: Date | null }>> {
    const items = await this.repo.find({
      order: { name: "ASC" },
    });
    const ids = items.map((x) => x.instanceId);
    if (ids.length === 0) return [];

    const latestRows = await this.snapshotRepo
      .createQueryBuilder("s")
      .select("s.instanceId", "instanceId")
      .addSelect("MAX(s.createdAt)", "lastSnapshotAt")
      .where("s.instanceId IN (:...ids)", { ids })
      .andWhere("s.status = :status", { status: "READY" })
      .groupBy("s.instanceId")
      .getRawMany<{ instanceId: string; lastSnapshotAt: string | null }>();

    const latestMap = new Map(
      latestRows.map((row) => [
        row.instanceId,
        row.lastSnapshotAt ? new Date(row.lastSnapshotAt) : null,
      ]),
    );
    return items.map((item) => ({
      ...item,
      lastSnapshotAt: latestMap.get(item.instanceId) ?? null,
    }));
  }

  async getOrFail(instanceId: string): Promise<InstanceEntity> {
    const item = await this.repo.findOne({ where: { instanceId } });
    if (!item) throw notFound(`Instance not found: ${instanceId}`);
    return item;
  }

  async create(input: unknown): Promise<InstanceEntity> {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      throw badRequest("Invalid request payload", { issues: parsed.error.issues });
    }

    const value = parsed.data;
    const entity = this.repo.create({
      instanceId: uuidv4(),
      name: value.name,
      environment: value.environment,
      crmBaseUrl: value.crmBaseUrl,
      dbType: value.dbType,
      defaultSchema: value.defaultSchema,
      capabilitiesRead: value.capabilities.read,
      capabilitiesWrite: value.capabilities.write,
      authRef: value.authRef ?? null,
    });
    return this.repo.save(entity);
  }

  async update(instanceId: string, input: unknown): Promise<InstanceEntity> {
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) {
      throw badRequest("Invalid request payload", { issues: parsed.error.issues });
    }

    const current = await this.getOrFail(instanceId);
    const value = parsed.data;

    current.name = value.name ?? current.name;
    current.environment = value.environment ?? current.environment;
    current.crmBaseUrl = value.crmBaseUrl ?? current.crmBaseUrl;
    current.dbType = value.dbType ?? current.dbType;
    current.defaultSchema = value.defaultSchema ?? current.defaultSchema;
    if (value.capabilities) {
      current.capabilitiesRead = value.capabilities.read;
      current.capabilitiesWrite = value.capabilities.write;
    }
    if (typeof value.authRef !== "undefined") {
      current.authRef = value.authRef;
    }

    return this.repo.save(current);
  }
}
