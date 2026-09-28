// Вызывается один раз при старте сервера Next.js, до первого запроса.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("@/db/migrate");
    await runMigrations();
  }
}
