"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/ui/components";

/** «Понятно»: разбор этой недели больше не открывается сам; назад к дневнику. */
export function UnderstoodButton({ weekStart }: { weekStart: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/week/seen", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ weekStart }),
        }).catch(() => {});
        router.replace("/");
        router.refresh();
      }}
    >
      Понятно
    </Button>
  );
}
