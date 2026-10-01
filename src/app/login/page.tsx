import { cookies } from "next/headers";
import { callbackErrorText, DELETED_COOKIE, deletedFrom } from "@/lib/auth-errors";
import { signupClosed } from "@/lib/env";
import { LoginForm } from "./LoginForm";

/**
 * ?error= — ссылка из письма не сработала (код better-auth), ?deleted=1 — аккаунт только
 * что удалён: верим ему лишь вместе с cookie calo.deleted от /delete-user/callback (auth.ts).
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error, deleted } = await searchParams;
  const deletedCookie = (await cookies()).get(DELETED_COOKIE)?.value;
  return <LoginForm linkError={callbackErrorText(error)} deleted={deletedFrom(deleted, deletedCookie)} signupClosed={signupClosed} />;
}
