// Вызывается один раз при старте сервера Next.js, до первого запроса.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // next build тоже вызывает register в каждом из параллельных воркеров — БД там не нужна.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { runMigrations } = await import("@/db/migrate");
  await runMigrations();
  // Справочник продуктов из seed/foods — только если файлы изменились.
  const [{ db }, { seedFoods }] = await Promise.all([import("@/db"), import("@/db/seed-foods")]);
  await seedFoods(db);
}
