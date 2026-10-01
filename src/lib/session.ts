import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";

/**
 * Сессия для серверных страниц; без неё — на /login. cache — один запрос к базе
 * на рендер: сессию читают и layout приложения, и сама страница.
 */
export const requireSession = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session;
});
