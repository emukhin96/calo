/**
 * pnpm dev: встроенный Postgres (PGlite) в этом процессе + next dev отдельным процессом.
 *
 * PGlite нельзя открывать из самого Next: dev-сервер при компиляции новых
 * маршрутов создаёт второй экземпляр на ту же папку, WASM падает (Aborted)
 * и портит данные. Здесь база одна, а Next ходит в неё по протоколу Postgres
 * через драйвер pg — ровно как в проде.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, ".data/pg");
const PORT = Number(process.env.DEV_DB_PORT ?? 5433);

async function main() {
  // Распознаватель штрихкодов в public/wasm (как в build).
  spawnSync("node", ["scripts/copy-wasm.mjs"], { cwd: ROOT, stdio: "inherit" });
  mkdirSync(path.dirname(DATA_DIR), { recursive: true });
  const db = await PGlite.create({ dataDir: DATA_DIR, extensions: { pg_trgm } });
  const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: PORT, maxConnections: 4 });
  await server.start();
  console.log(`[dev-db] PGlite ${DATA_DIR} → postgres://127.0.0.1:${PORT}`);

  const next = spawn("pnpm", ["exec", "next", "dev", ...process.argv.slice(2)], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: `postgres://postgres@127.0.0.1:${PORT}/postgres`,
      // PGlite — одна сессия: несколько соединений перемешали бы транзакции.
      DATABASE_POOL_MAX: "1",
    },
  });

  let closing = false;
  async function shutdown(code: number) {
    if (closing) return;
    closing = true;
    next.kill("SIGTERM");
    await server.stop().catch(() => {});
    await db.close().catch(() => {}); // сброс на диск — иначе данные можно потерять
    process.exit(code);
  }
  next.on("exit", (code) => shutdown(code ?? 0));
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => shutdown(0));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
