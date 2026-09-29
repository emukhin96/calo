import type { CapacitorConfig } from "@capacitor/cli";

// Нативная оболочка iOS (этап 9): WebView открывает сам сайт, а нативный код
// (HealthKit, виджет) подключается через мост Capacitor — ARCHITECTURE.md §11.
const config: CapacitorConfig = {
  appId: "am.egor.calo",
  appName: "Calo",
  // Запасная страница, если сайт недоступен (нет сети при первом запуске).
  webDir: "native/www",
  server: {
    url: "https://calc.egor.am",
    errorPath: "index.html",
  },
  ios: {
    contentInset: "never",
    scheme: "Calo",
  },
};

export default config;
