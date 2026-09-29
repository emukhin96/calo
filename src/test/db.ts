import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { DB } from "@/db";
import * as schema from "@/db/schema";

/** Чистая БД в памяти со всеми миграциями — для интеграционных тестов. */
export async function createTestDb(): Promise<{ db: DB; close: () => Promise<void> }> {
  const client = await PGlite.create({ extensions: { pg_trgm } });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  return { db: db as unknown as DB, close: () => client.close() };
}
