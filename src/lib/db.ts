import { Pool } from "pg";
import { postgresConnectionString } from "./postgres-connection.mjs";
let pool: Pool | undefined;
export function databaseConfigured() {
    return Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET && process.env.VERCEL_ENV !== "preview");
}
export function getPool() {
    if (!databaseConfigured())
        throw new Error("Database accounts are unavailable in this environment.");
    return pool ??= new Pool({ connectionString: postgresConnectionString(process.env.DATABASE_URL), max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000, statement_timeout: 15000 });
}
