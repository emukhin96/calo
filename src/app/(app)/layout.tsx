import type { ReactNode } from "react";
import { TabBar } from "@/ui/TabBar";

/**
 * Экраны приложения с нижней панелью вкладок. Панель сама прячется там, где
 * она не нужна (добавление, первый запуск, редактор блюда); страницы с ней
 * отступают снизу на pb-tabbar (globals.css).
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <TabBar />
    </>
  );
}
