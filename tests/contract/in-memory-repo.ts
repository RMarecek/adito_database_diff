type SortDirection = "ASC" | "DESC";

type FindOptions<T> = {
  where?: Partial<T>;
  order?: Partial<Record<keyof T, SortDirection>>;
  skip?: number;
  take?: number;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  (value ?? {}) as Record<string, unknown>;

const matchesWhere = <T extends Record<string, unknown>>(row: T, where?: Partial<T>): boolean => {
  if (!where) return true;
  for (const [key, expected] of Object.entries(asRecord(where))) {
    const actual = row[key];
    if (expected && typeof expected === "object" && "_type" in (expected as Record<string, unknown>)) {
      // Partial support for TypeORM FindOperator(In).
      const marker = expected as Record<string, unknown>;
      if (marker._type === "in" && Array.isArray(marker._value)) {
        if (!marker._value.includes(actual)) return false;
        continue;
      }
    }
    if (actual !== expected) return false;
  }
  return true;
};

const sortRows = <T extends Record<string, unknown>>(
  rows: T[],
  order?: Partial<Record<keyof T, SortDirection>>,
): T[] => {
  if (!order) return rows;
  const entries = Object.entries(order) as Array<[keyof T, SortDirection]>;
  if (entries.length === 0) return rows;
  const [key, direction] = entries[0];
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === bv) return 0;
    if (av === undefined || av === null) return direction === "ASC" ? -1 : 1;
    if (bv === undefined || bv === null) return direction === "ASC" ? 1 : -1;
    if (av > bv) return direction === "ASC" ? 1 : -1;
    return direction === "ASC" ? -1 : 1;
  });
};

const clone = <T>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const now = (): Date => new Date();

export class InMemoryRepository<T extends Record<string, unknown>> {
  private rows: T[] = [];
  private readonly primaryKeys: string[];

  constructor(primaryKeys: string[]) {
    this.primaryKeys = primaryKeys;
  }

  create(input: Partial<T>): T {
    return clone(input as T);
  }

  async save(entity: T | T[]): Promise<T | T[]> {
    if (Array.isArray(entity)) {
      const saved: T[] = [];
      for (const item of entity) {
        saved.push((await this.saveOne(item)) as T);
      }
      return saved;
    }
    return this.saveOne(entity);
  }

  private async saveOne(entity: T): Promise<T> {
    const candidate = clone(entity);
    const index = this.findIndexByPrimaryKey(candidate);
    const candidateRecord = asRecord(candidate);

    if (!("createdAt" in candidateRecord) || !candidateRecord.createdAt) {
      candidateRecord.createdAt = now();
    }
    if (!("updatedAt" in candidateRecord) || !candidateRecord.updatedAt) {
      candidateRecord.updatedAt = now();
    }
    if (!("submittedAt" in candidateRecord) || !candidateRecord.submittedAt) {
      candidateRecord.submittedAt = now();
    }

    if (index >= 0) {
      this.rows[index] = {
        ...this.rows[index],
        ...candidate,
      };
    } else {
      this.rows.push(candidate);
    }
    return clone(candidate);
  }

  async find(options?: FindOptions<T>): Promise<T[]> {
    let output = this.rows.filter((row) => matchesWhere(row, options?.where));
    output = sortRows(output, options?.order);
    const skip = options?.skip ?? 0;
    const take = options?.take ?? output.length;
    output = output.slice(skip, skip + take);
    return clone(output);
  }

  async findOne(options: { where?: Partial<T>; order?: Partial<Record<keyof T, SortDirection>> }): Promise<T | null> {
    const found = await this.find({ where: options.where, order: options.order, take: 1 });
    return found[0] ?? null;
  }

  async findBy(where: Partial<T>): Promise<T[]> {
    return this.find({ where });
  }

  async update(criteria: Partial<T>, partialEntity: Partial<T>): Promise<void> {
    for (let i = 0; i < this.rows.length; i += 1) {
      if (!matchesWhere(this.rows[i], criteria)) continue;
      this.rows[i] = {
        ...this.rows[i],
        ...clone(partialEntity as T),
      };
      const rowRecord = asRecord(this.rows[i]);
      if ("updatedAt" in rowRecord) {
        rowRecord.updatedAt = now();
      }
    }
  }

  async delete(criteria: Partial<T>): Promise<void> {
    this.rows = this.rows.filter((row) => !matchesWhere(row, criteria));
  }

  async countBy(criteria: Partial<T>): Promise<number> {
    return this.rows.filter((row) => matchesWhere(row, criteria)).length;
  }

  async findAndCount(options: FindOptions<T>): Promise<[T[], number]> {
    const rows = await this.find(options);
    const total = this.rows.filter((row) => matchesWhere(row, options.where)).length;
    return [rows, total];
  }

  createQueryBuilder(): never {
    throw new Error("createQueryBuilder is not supported in InMemoryRepository for this test");
  }

  private findIndexByPrimaryKey(entity: T): number {
    return this.rows.findIndex((row) =>
      this.primaryKeys.every((key) => asRecord(row)[key] === asRecord(entity)[key]),
    );
  }
}
