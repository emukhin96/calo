import * as pageInfo from "next/dist/build/analysis/get-page-static-info";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";
import { describe, expect, it } from "vitest";
import { config } from "./proxy";

// Матчер собираем теми же функциями Next, что и сборка с сервером: регулярка
// с префиксами /_next/data и суффиксами .rsc, а не голая строка из config.
// getMiddlewareMatchers нет в .d.ts Next — тип описываем сами.
const { getMiddlewareMatchers } = pageInfo as unknown as {
  getMiddlewareMatchers: (matcher: string[], nextConfig: object) => Parameters<typeof getMiddlewareRouteMatcher>[0];
};
const match = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}));
const needsSession = (path: string) => match(path, {} as never, {});

describe("proxy matcher", () => {
  it("страница о данных, подтверждение удаления и вход открыты без сессии", () => {
    for (const p of ["/privacy", "/privacy/", "/privacy.rsc", "/delete-account", "/login", "/api/auth/magic-link/verify", "/sw.js"]) {
      expect(needsSession(p), p).toBe(false);
    }
  });

  it("экраны приложения требуют сессию", () => {
    for (const p of ["/", "/settings", "/week", "/onboarding", "/add", "/recipes/new", "/settings.rsc"]) {
      expect(needsSession(p), p).toBe(true);
    }
  });
});
