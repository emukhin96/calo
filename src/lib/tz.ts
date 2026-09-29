import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { DEFAULT_TZ, isValidTimeZone } from "@/domain/day";

/**
 * Часовой пояс пользователя: из профиля (его обновляет ui/TimeZoneSync, когда
 * телефон в другой зоне), до онбординга — из cookie tz браузера.
 */
export async function userTimeZone(ownerId?: string): Promise<string> {
  if (ownerId) {
    const [p] = await db.select({ tz: profiles.timezone }).from(profiles).where(eq(profiles.ownerId, ownerId));
    if (p && isValidTimeZone(p.tz)) return p.tz;
  }
  const tz = (await cookies()).get("tz")?.value;
  return isValidTimeZone(tz) ? tz : DEFAULT_TZ;
}
