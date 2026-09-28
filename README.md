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

## Деплой

Push в `main` → GitHub Actions: проверки → сборка образа → `docker load` на
сервер → `deploy/vps/deploy.sh`. Подробности и ручные операции — [deploy/VPS.md](deploy/VPS.md).
