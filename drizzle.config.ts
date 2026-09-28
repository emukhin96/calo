import { defineConfig } from "drizzle-kit";

// Миграции генерируются из схемы (pnpm db:generate) и применяются при старте
// сервера (src/instrumentation.ts) — отдельного шага в деплое нет.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  casing: "snake_case",
});
