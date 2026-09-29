"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Если часовой пояс телефона отличается от того, по которому сервер считает
 * «сегодня», — сообщает новый (cookie + профиль) и перерисовывает день.
 */
export function TimeZoneSync({ serverTz }: { serverTz: string }) {
  const router = useRouter();
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz || tz === serverTz) return;
    document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax; secure`;
    fetch("/api/profile/timezone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone: tz }),
    }).finally(() => router.refresh());
  }, [serverTz, router]);
  return null;
}
