import type { Metadata, Viewport } from "next";
import { NativeBridge } from "@/ui/NativeBridge";
import { OfflineSync } from "@/ui/OfflineSync";
import { ServiceWorker } from "@/ui/ServiceWorker";
// Шрифты лежат в node_modules (Fontsource), сборка не ходит в Google Fonts.
// Файлы разбиты по unicode-range: браузер качает только кириллицу и латиницу.
import "@fontsource-variable/unbounded";
import "@fontsource-variable/manrope";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Calo",
  description: "Дневник питания: калории, белок, витамины и недельный разбор",
  applicationName: "Calo",
  appleWebApp: { capable: true, title: "Calo", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#f7f7fa",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className="min-h-dvh">
        {children}
        <OfflineSync />
        <NativeBridge />
        <ServiceWorker />
      </body>
    </html>
  );
}
