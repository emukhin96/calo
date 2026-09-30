"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/ui/components";

/**
 * «Понятно» под разбором, который открылся сам, — назад к дневнику. Просмотренным
 * разбор отмечает сама страница (week/page.tsx), ещё до показа: уйти можно и
 * вкладкой, а не только этой кнопкой.
 */
export function UnderstoodButton() {
  const router = useRouter();
  return (
    <Button
      onClick={() => {
        router.replace("/");
        router.refresh();
      }}
    >
      Понятно
    </Button>
  );
}
