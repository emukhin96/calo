"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/ui/components";

function markSeen(weekStart: string) {
  return fetch("/api/week/seen", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ weekStart }),
  }).catch(() => {});
}

/**
 * «Понятно» под разбором, который открылся сам. Разбор считается просмотренным,
 * как только он на экране: уйти можно и вкладкой, а не только этой кнопкой, —
 * иначе он открывался бы при каждом запуске. Кнопка — назад к дневнику.
 */
export function UnderstoodButton({ weekStart }: { weekStart: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void markSeen(weekStart);
  }, [weekStart]);

  return (
    <Button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await markSeen(weekStart); // вдруг первый запрос не дошёл
        router.replace("/");
        router.refresh();
      }}
    >
      Понятно
    </Button>
  );
}
