import "server-only";
import path from "node:path";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { db, dbDriver } from ".";

const migrationsFolder = path.join(process.cwd(), "drizzle");

export async function runMigrations(): Promise<void> {
  const started = Date.now();
  if (dbDriver === "pglite") {
    // @ts-expect-error — db создан через drizzle/pglite, тип объявлен как node-postgres
    await migratePglite(db, { migrationsFolder });
  } else {
    await migratePg(db, { migrationsFolder });
  }
  console.log(`[db] migrations applied (${dbDriver}) in ${Date.now() - started} ms`);
}
