import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

/** Проверка живости для deploy.sh и Docker healthcheck: приложение + база. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, version: process.env.APP_VERSION ?? "dev" });
  } catch (e) {
    console.error("[health]", e);
    return Response.json({ ok: false }, { status: 503 });
  }
}
