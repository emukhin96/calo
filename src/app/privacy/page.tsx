import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Eyebrow, SectionTitle } from "@/ui/components";

export const metadata: Metadata = { title: "Как Calo хранит данные" };

function Item({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <b className="font-semibold text-ink">{title}</b> — {children}
    </li>
  );
}

const list = "space-y-3 text-[16px] leading-[1.45] text-ink-2";
const text = "text-[16px] leading-[1.45] text-ink-2";

/**
 * Публичная страница (proxy пускает без входа): что Calo хранит и кому передаёт.
 * Каждое утверждение — по коду и деплою: схема src/db/schema, src/ai/gemini.ts,
 * src/lib/off.ts, src/lib/push.ts, src/lib/native.ts, deploy/vps/backup.sh.
 * Поменялось что-то из этого — поправить и здесь.
 */
export default function PrivacyPage() {
  // TODO: добавить адрес для вопросов о данных — владелец ещё не выбрал ящик.
  return (
    <main className="mx-auto max-w-md px-6 pt-6 pb-[calc(40px+env(safe-area-inset-bottom))]">
      <Link href="/" className="text-[16px] font-semibold text-accent">
        ← Назад
      </Link>
      <Eyebrow className="mt-6">Calo</Eyebrow>
      <h1 className="mt-2 font-display text-[28px] leading-tight font-extrabold">Как Calo хранит данные</h1>
      <p className={`mt-4 ${text}`}>Коротко: что хранится, где и кому передаётся.</p>

      <SectionTitle>Что хранится</SectionTitle>
      <ul className={list}>
        <Item title="Email">для входа и писем.</Item>
        <Item title="Дневник">записи о еде, приёмы пищи, свои продукты и блюда, недельные разборы.</Item>
        <Item title="Профиль">
          пол, год рождения, рост, активность, часовой пояс, цель, история веса, свои нормы и порядок приёмов пищи.
        </Item>
        <Item title="Face ID и Touch ID">только открытая часть ключа: лицо и отпечаток не покидают устройство.</Item>
        <Item title="Уведомления">адрес подписки и название браузера.</Item>
        <Item title="Входы">IP-адрес и браузер устройства, с которого вошли.</Item>
        <Item title="Запросы к ИИ">счётчик по дням — для лимитов.</Item>
      </ul>

      <SectionTitle>Где</SectionTitle>
      <p className={text}>
        На сервере в Германии: Hetzner, Фалькенштайн. Там же база данных и ежедневные резервные копии — копии хранятся
        две недели. Журнал запросов к серверу (IP-адрес, время, адрес запроса, браузер) перезаписывается по кругу.
      </p>

      <SectionTitle>Кому передаётся</SectionTitle>
      <ul className={list}>
        <Item title="Google Gemini">
          текст со вкладки «Текст» — чтобы разобрать его на продукты и граммы. Уходит только сам текст, без email и
          других данных аккаунта. Если у каждого продукта указано количество, ИИ не нужен и текст никуда не уходит.
          Calo пользуется бесплатным уровнем Gemini: по его условиям Google может использовать присланный текст для
          улучшения своих продуктов, а читать его могут люди-проверяющие, — поэтому не пишите в описании еды личных
          данных.
        </Item>
        <Item title="Open Food Facts">
          поисковый запрос или штрихкод товара. Запрос отправляет наш сервер, поэтому ваш IP-адрес и аккаунт туда не
          попадают. Камера только читает штрихкод, прямо на устройстве; снимки никуда не отправляются.
        </Item>
        <Item title="Почта Timeweb">
          отправляет письма со ссылками для входа и удаления аккаунта с адреса no-reply@egor.am: получает ваш email и
          текст письма.
        </Item>
        <Item title="Служба уведомлений браузера">
          Apple, Google, Mozilla или Microsoft: доставляет уведомления в зашифрованном виде. В них только напоминание о разборе
          недели.
        </Item>
        <Item title="«Здоровье» на iPhone">
          если подключить его в приложении: Calo записывает туда съеденное, а читает только вес — последнее
          взвешивание сохраняется в аккаунте. Остальное из «Здоровья» Calo не видит.
        </Item>
      </ul>
      <p className={`mt-4 ${text}`}>
        Больше никому. Нет рекламы и сторонней аналитики, данные не продаются. Страницы ничего не загружают со сторонних
        сайтов — даже шрифты.
      </p>

      <SectionTitle>Вход</SectionTitle>
      <p className={text}>
        Ссылка для входа действует 15 минут и срабатывает один раз. Вход на устройстве действует 90 дней и продлевается,
        пока вы пользуетесь Calo; «Выйти» в Профиле завершает его сразу.
      </p>

      <SectionTitle>Ваши права</SectionTitle>
      <ul className={list}>
        <Item title="Выгрузить">
          Профиль → «Скачать дневник (CSV)». В файле все записи дневника: дата, время, приём пищи, продукт, граммы,
          КБЖУ и витамины. Профиль, вес и блюда в выгрузку не входят.
        </Item>
        <Item title="Удалить аккаунт">
          Профиль → «Удалить аккаунт». Придёт письмо; после подтверждения аккаунт и все данные удаляются сразу, а из
          резервных копий исчезают примерно через две недели. Записи, которые Calo сохранил в «Здоровье», остаются
          там — их можно удалить в приложении «Здоровье».
        </Item>
      </ul>
    </main>
  );
}
