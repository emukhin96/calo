import "server-only";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from ".";

export async function runMigrations(): Promise<void> {
  const started = Date.now();
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  console.log(`[db] migrations applied in ${Date.now() - started} ms`);
}
