import "server-only";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

/**
 * DATABASE_URL:
 *   postgres://…      — настоящий Postgres (прод, docker compose);
 *   pglite:./.data/pg — встроенный Postgres для локальной разработки
 *                       и тестов, ставить ничего не нужно (по умолчанию).
 * Оба драйвера дают одинаковый API запросов drizzle.
 */
function createDb(): { db: DB; driver: "pg" | "pglite"; close: () => Promise<void> } {
  const url = process.env.DATABASE_URL ?? "pglite:./.data/pg";
  if (url.startsWith("pglite:")) {
    const client = new PGlite({ dataDir: url.slice("pglite:".length) || undefined, extensions: { pg_trgm } });
    const db = drizzlePglite(client, { schema }) as unknown as DB;
    return { db, driver: "pglite", close: () => client.close() };
  }
  const pool = new Pool({ connectionString: url, max: 5 });
  return { db: drizzlePg(pool, { schema }), driver: "pg", close: () => pool.end() };
}

// Один экземпляр на процесс: next dev перезагружает модули, а PGlite
// не переживает второе открытие того же каталога.
const globalForDb = globalThis as unknown as { __calcDb?: ReturnType<typeof createDb> };
const instance = (globalForDb.__calcDb ??= createDb());

export const db = instance.db;
export const dbDriver = instance.driver;
export const closeDb = instance.close;
