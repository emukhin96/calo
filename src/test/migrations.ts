import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const FOLDER = path.resolve(__dirname, "../../drizzle");

/**
 * PGlite с миграциями до tag (не включая) — БД «как до обновления» для тестов
 * миграций: client — заполнить старую схему, upgrade — применить остальные.
 */
export async function dbBefore(tag: string) {
  const journal = JSON.parse(fs.readFileSync(path.join(FOLDER, "meta/_journal.json"), "utf8"));
  const idx = journal.entries.findIndex((j: { tag: string }) => j.tag.startsWith(tag));
  if (idx < 0) throw new Error(`migration ${tag} not found`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "calo-mig-"));
  fs.mkdirSync(path.join(dir, "meta"));
  fs.writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, idx) }));
  for (const j of journal.entries.slice(0, idx)) fs.copyFileSync(path.join(FOLDER, `${j.tag}.sql`), path.join(dir, `${j.tag}.sql`));
  const client = await PGlite.create({ extensions: { pg_trgm } });
  const old = drizzle(client);
  await migrate(old, { migrationsFolder: dir });
  return {
    client,
    upgrade: () => migrate(old, { migrationsFolder: FOLDER }),
    close: async () => {
      await client.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
