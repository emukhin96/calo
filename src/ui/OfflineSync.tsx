"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { flushQueue, QUEUE_EVENT, queued } from "@/lib/offline";
import { plural } from "./format";

/** Отправляет офлайн-очередь при появлении сети и показывает, сколько ждёт. */
export function OfflineSync() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => {
      setCount(queued().length);
      setOnline(navigator.onLine);
    };
    const flush = async () => {
      update();
      if (!navigator.onLine || queued().length === 0) return;
      if ((await flushQueue()) > 0) router.refresh();
      update();
    };
    flush();
    const onVisible = () => document.visibilityState === "visible" && flush();
    window.addEventListener("online", flush);
    window.addEventListener("offline", update);
    window.addEventListener(QUEUE_EVENT, update);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(flush, 30_000);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("offline", update);
      window.removeEventListener(QUEUE_EVENT, update);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [router]);

  if (count === 0 && online) return null;
  return (
    <div className="fixed inset-x-0 top-[env(safe-area-inset-top)] z-40 flex justify-center px-4 pt-2">
      <div className="rounded-full bg-ink px-4 py-1.5 text-[13px] font-semibold text-white shadow-lg">
        {!online && "Нет сети"}
        {!online && count > 0 && " · "}
        {count > 0 && `${count} ${plural(count, ["запись ждёт", "записи ждут", "записей ждут"])} отправки`}
      </div>
    </div>
  );
}
