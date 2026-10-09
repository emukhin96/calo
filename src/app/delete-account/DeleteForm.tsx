"use client";

import { useState } from "react";

/**
 * Кнопка удаления — обычная форма GET (без JS тоже работает). После первого нажатия
 * кнопка гаснет: второй запрос с тем же токеном пришёл бы уже на удалённый аккаунт
 * и показал «ссылка устарела» вместо «аккаунт удалён».
 */
export function DeleteForm({ token }: { token: string }) {
  const [sent, setSent] = useState(false);
  return (
    <form method="get" action="/api/auth/delete-user/callback" onSubmit={() => setSent(true)} className="mt-8">
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={sent}
        className="h-[60px] w-full rounded-[var(--radius-button)] bg-warn text-[17px] font-bold text-white disabled:opacity-60"
      >
        {sent ? "Удаляю…" : "Удалить навсегда"}
      </button>
    </form>
  );
}
