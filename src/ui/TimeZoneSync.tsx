"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Сообщает серверу часовой пояс браузера (cookie tz) и перерисовывает день, если он изменился. */
export function TimeZoneSync({ serverTz }: { serverTz: string }) {
  const router = useRouter();
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz || tz === serverTz) return;
    document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax; secure`;
    router.refresh();
  }, [serverTz, router]);
  return null;
}
