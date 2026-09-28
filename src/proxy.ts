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
  // Всё, кроме входа, API, статики, иконок, манифеста и service worker.
  matcher: ["/((?!login|api|_next/static|_next/image|pwa-icon|icon|apple-icon|manifest.webmanifest|sw.js).*)"],
};
