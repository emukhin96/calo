import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

// Быстрый отсев без сессии → /login. Это только проверка наличия cookie;
// настоящую проверку сессии делает каждая страница и API через auth.api.getSession.
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Всё, кроме входа, страницы о данных (её читают до входа), подтверждения удаления
  // (ссылку из письма открывают и там, где не входили), API, статики, иконок,
  // манифеста, service worker и распознавателя штрихкодов.
  matcher: ["/((?!login|privacy|delete-account|api|_next/static|_next/image|pwa-icon|icon|apple-icon|manifest.webmanifest|sw.js|wasm/).*)"],
};
