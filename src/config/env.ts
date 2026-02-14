import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  AUTH_REQUIRED: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  JWT_SECRET: z.string().default("change-me"),
  JWT_AUDIENCE: z.string().default("schema-compare"),
  JWT_ISSUER: z.string().default("schema-compare-api"),
  DB_TYPE: z.enum(["sqlite", "mariadb", "oracle"]).default("sqlite"),
  DB_LOGGING: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  DB_SYNCHRONIZE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USERNAME: z.string().default("root"),
  DB_PASSWORD: z.string().default(""),
  DB_DATABASE: z.string().default("schema_compare"),
  DB_SID: z.string().default("ORCLCDB"),
  DB_SERVICE_NAME: z.string().default(""),
  SQLITE_PATH: z.string().default("./local.db"),
  CRM_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  CRM_METADATA_PAGE_SIZE: z.coerce.number().int().positive().default(200),
  CRM_METADATA_DETAIL_LEVEL: z.enum(["fast", "full"]).default("fast"),
  CRM_METADATA_INCLUDE_COLUMN_DEFAULTS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  CRM_METADATA_INCLUDE_COLUMN_COMMENTS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  CRM_METADATA_INCLUDE_INDEX_EXPRESSIONS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  CRM_METADATA_USE_CACHE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  CRM_METADATA_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  CRM_METADATA_MAX_OBJECTS_PER_PAGE: z.coerce.number().int().positive().default(80),
});

export const env = schema.parse(process.env);
