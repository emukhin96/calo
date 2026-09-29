# Calo

Личный дневник питания: калории, белок, витамины и недельный разбор.
PWA на Next.js — работает в браузере и на iPhone («На экран Домой»).
Прод: https://calc.egor.am

- Архитектура — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- План по этапам — [docs/PLAN.md](docs/PLAN.md)
- Сервер и деплой — [deploy/VPS.md](deploy/VPS.md)

## Локально

```bash
pnpm install
cp .env.example .env.local   # задайте BETTER_AUTH_SECRET и ALLOWED_EMAILS
pnpm dev                     # http://localhost:3000
```

База для разработки — встроенная PGlite в `.data/pg`, ставить Postgres или
Docker не нужно. Миграции применяются при старте сервера.
Ссылка для входа, пока не настроен SMTP, печатается в консоль `pnpm dev`.

| Команда | Что делает |
|---|---|
| `pnpm test` | юнит-тесты (Vitest), доменная логика в `src/domain` |
| `pnpm typecheck` | типы Next.js + `tsc` |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | миграция из изменений `src/db/schema` |
| `pnpm auth:schema` | перегенерировать таблицы Better Auth после смены плагинов |
| `pnpm foods:usda` | пересобрать `seed/foods/usda.json` из USDA FoodData Central |
| `pnpm foods:staples` | пересобрать русские базовые продукты (медианы Open Food Facts) |

## Справочник продуктов

`seed/foods/` загружается в БД при старте сервера, если файлы изменились:

- `usda.json` — ~3900 продуктов USDA (Foundation 2026 + SR Legacy) с 24 нутриентами;
- `usda.ru.json` — русские названия и синонимы к ним (переведены один раз, правятся руками);
- `staples.json` — творог, кефир, сметана, пельмени, докторская… — медиана КБЖУ
  по нескольким реальным товарам из Open Food Facts; цифры не вписываются вручную.

Брендовые товары ищутся в Open Food Facts на лету и сохраняются при выборе.
Этикетки, где 4·Б + 9·Ж + 4·У не сходится с калориями, отбрасываются.

## Деплой

Push в `main` → GitHub Actions: проверки → сборка образа → `docker load` на
сервер → `deploy/vps/deploy.sh`. Подробности и ручные операции — [deploy/VPS.md](deploy/VPS.md).
