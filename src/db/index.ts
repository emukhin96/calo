import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

/**
 * DATABASE_URL — Postgres: в проде контейнер calc-db, локально — PGlite,
 * который поднимает `pnpm dev` (scripts/dev.ts). Pool не подключается до
 * первого запроса, поэтому next build без базы проходит.
 */
function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  });
}

// Один пул на процесс: next dev перезагружает модули.
const globalForDb = globalThis as unknown as { __calcPool?: Pool };
const pool = (globalForDb.__calcPool ??= createPool());

export const db = drizzle(pool, { schema });
