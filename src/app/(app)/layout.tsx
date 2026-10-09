import type { ReactNode } from "react";
import { requireSession } from "@/lib/session";
import { OwnerGuard } from "@/ui/OwnerGuard";
import { TabBar } from "@/ui/TabBar";

/**
 * Экраны приложения с нижней панелью вкладок. Панель сама прячется там, где
 * она не нужна (добавление, первый запуск, редактор блюда); страницы с ней
 * отступают снизу на pb-tabbar (globals.css).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  return (
    <>
      <OwnerGuard userId={session.user.id} />
      {children}
      <TabBar />
    </>
  );
}
