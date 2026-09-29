import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_TZ, isValidTimeZone } from "@/domain/day";

/**
 * Часовой пояс пользователя. Пока — из cookie tz, которую ставит браузер
 * (ui/TimeZoneSync); на этапе 3 его заменит profiles.timezone.
 */
export async function userTimeZone(): Promise<string> {
  const tz = (await cookies()).get("tz")?.value;
  return isValidTimeZone(tz) ? tz : DEFAULT_TZ;
}
