import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow } from "@/ui/components";
import { DeleteForm } from "./DeleteForm";

export const metadata: Metadata = {
  title: "Удаление аккаунта",
  // В адресе страницы — токен удаления, и он не должен уходить в Referer. Next отдаёт
  // этот meta после ссылок на стили и скрипты, так что их запросы его не застают;
  // в логах Caddy токен в Referer всё равно заменяется на REDACTED (deploy/vps/Caddyfile).
  referrer: "no-referrer",
};

/**
 * Сюда ведёт ссылка из письма об удалении (src/lib/auth.ts). Сама ссылка ничего не
 * удаляет: почтовые сканеры открывают ссылки из писем сами, а удаление необратимо.
 * Удаляет кнопка — обычная форма GET на /api/auth/delete-user/callback (DeleteForm,
 * hooks.before в auth.ts); формы сканеры не отправляют. Страница открыта без входа (proxy): ссылку
 * часто открывают в Safari, а вошли — в приложении.
 */
export default async function DeleteAccountPage({ searchParams }: PageProps<"/delete-account">) {
  const { token } = await searchParams;
  const t = Array.isArray(token) ? token[0] : token;
  return (
    <main className="mx-auto flex min-h-app max-w-md flex-col justify-center px-6 pt-10 pb-[calc(40px+env(safe-area-inset-bottom))]">
      <Eyebrow>Calo</Eyebrow>
      <h1 className="mt-2 font-display text-[34px] leading-tight font-extrabold">Удалить аккаунт?</h1>
      {t ? (
        <>
          <p className="mt-4 text-[17px] leading-relaxed text-ink-2">
            Удалятся все записи дневника, блюда, свои продукты, вес и настройки. Восстановить их будет нельзя.
          </p>
          <DeleteForm token={t} />
          <Link href="/" className="mt-6 block text-center text-[16px] font-semibold text-ink-3">
            Не удалять
          </Link>
        </>
      ) : (
        <p className="mt-4 text-[17px] leading-relaxed text-ink-2">
          Ссылка неполная. Откройте её из письма целиком или запросите удаление ещё раз в Профиле.
        </p>
      )}
    </main>
  );
}
