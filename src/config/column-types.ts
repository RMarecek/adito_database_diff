import { env } from "./env";

export const dateTimeColumnType = env.DB_TYPE === "sqlite" ? "datetime" : "timestamp";
