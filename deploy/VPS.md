# Сервер calc

| | |
|---|---|
| Адрес | `calc.egor.am` → 167.233.67.102 (Hetzner Cloud CX23, Фалькенштайн; IPv6 2a01:4f8:c016:6791::/64) |
| Машина | Ubuntu 24.04, 2 vCPU, 4 ГБ RAM + 2 ГБ swap, 40 ГБ диск |
| Доступ | `ssh calc` (пользователь `deploy`, только ключ; root и пароли закрыты) |
| Каталог | `/opt/calc` — git-чекаут репозитория (deploy key только на чтение) |
| Данные | `/opt/calc/data/{postgres,photos,backups,logs}` |
| Секреты | `/opt/calc/.env` (создаётся deploy.sh при первом запуске, не в git) |

Стек (`deploy/vps/compose.yaml`): `caddy` (80/443, HTTPS) → `calc-web`
(Next.js, 384 МБ) → `calc-db` (Postgres 17, 256 МБ, наружу закрыт).

## Как устроен деплой

1. Push в `main` → GitHub Actions: lint, typecheck, тесты.
2. Actions собирает образ `calc:<sha>` (на сервере сборка не поместится в память).
3. `docker save | gzip | ssh deploy@calc load` — образ уезжает на сервер.
4. `ssh deploy@calc "deploy <sha>"` → `deploy/vps/deploy.sh`: checkout,
   бэкап, `docker compose up -d`, healthcheck `/api/health`; если приложение не
   поднялось — откат на прошлую версию.

Ключ CI в `~deploy/.ssh/authorized_keys` привязан к `deploy/vps/ci-entry.sh`
(`command=…,restrict`): им можно только загрузить образ и запустить деплой.
Секреты репозитория: `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`; переменная `DEPLOY_HOST`.

## Ручные операции

Полная шпаргалка (восстановление из бэкапа, cron, iOS, справочник) — [docs/OPERATIONS.md](../docs/OPERATIONS.md).

```bash
ssh calc 'cd /opt/calc && . deploy/vps/lib.sh && $COMPOSE ps'          # состояние
ssh calc 'cd /opt/calc && . deploy/vps/lib.sh && $COMPOSE logs -f calc-web'
ssh calc /opt/calc/deploy/vps/login-link.sh                            # ссылка входа, если SMTP не настроен
ssh calc /opt/calc/deploy/vps/backup.sh                                # бэкап сейчас
ssh calc 'docker images calc'                                          # версии для отката
ssh calc '/opt/calc/deploy/vps/deploy.sh <sha>'                        # откат на версию
```

Секреты (ключ Claude, SMTP) — со скрытым вводом, без правки файла руками.
Скрипт записывает значение в `/opt/calc/.env`, проверяет ключ Claude и
перезапускает приложение:

```bash
read -rs -p "Ключ Claude API: " KEY; echo; printf '%s\n' "$KEY" | ssh calc /opt/calc/deploy/vps/set-secret.sh ANTHROPIC_API_KEY; unset KEY
```

То же для `GEMINI_API_KEY` (`scripts/set-gemini-key.command`) и почты. Необязательные
переменные ИИ: `GEMINI_MODEL` (по умолчанию `gemini-3.1-flash-lite`; модели 2.5 для новых
ключей закрыты) и `AI_DAILY_LIMIT` (запросов на пользователя в день, по умолчанию 60).
Остальное в `.env` — `ssh calc`, `nano /opt/calc/.env`,
затем `deploy.sh` с текущим sha (`cat /opt/calc/.version.env`).

## Почта (письма со ссылкой входа)

Ящик `no-reply@egor.am` в почте Timeweb (домен egor.am: MX, SPF и DKIM — у Timeweb).
Настройка — двойной щелчок по `scripts/set-smtp.command`: спрашивает пароль ящика
(ввод скрыт), проверяет вход в SMTP с сервера, пишет `SMTP_URL` и `MAIL_FROM` в
`/opt/calc/.env`, перезапускает приложение и просит его прислать письмо со ссылкой
входа владельцу (первый адрес `ALLOWED_EMAILS`).

- `SMTP_URL=smtp://no-reply%40egor.am:<пароль>@smtp.timeweb.ru:587` — логин и пароль
  в процентной кодировке. У Hetzner исходящие **25 и 465 закрыты**: `smtps://…:465`
  не соединится, только 587 (запасной у Timeweb — 2525) со STARTTLS — приложение
  без него не отправит (`src/lib/mail.ts`, `requireTLS`).
- `MAIL_FROM=Calo <no-reply@egor.am>` — тот же ящик, иначе письмо не пройдёт SPF/DKIM.
- Ошибка отправки — в логе строкой `[mail] письмо со ссылкой входа не отправлено: …`.
  Пока `SMTP_URL` пуст, ссылка пишется в лог (`login-link.sh`).

## Первичная настройка (уже сделано)

- `deploy/vps/bootstrap.sh` (root): обновления, swap, Docker, пользователь
  `deploy`, ufw (22, 80, 443), каталоги.
- `deploy/vps/harden-ssh.sh`: вход только по ключу и только `deploy`.
- Push: `deploy/vps/gen-push-keys.sh` — ключи VAPID и CRON_SECRET в `.env`.
- Cron (`crontab deploy/vps/crontab.example`): бэкап ежедневно 01:45 UTC (14 дней);
  каждый час `cron-hourly.sh` — напоминания о разборе недели (пн 9–12 по местному).
  Копии пока только на сервере — вынести наружу (TODO).

## Переезд Timeweb → Hetzner (2026-09-30)

Причина: Google относил IP Timeweb (72.56.93.77, Амстердам) к России, Gemini API
отвечал «User location is not supported». С Hetzner (Фалькенштайн) YouTube отдаёт
`"GL":"DE"` по IPv4 и IPv6 — проверять так с любого нового сервера до настройки:

```bash
curl -s https://www.youtube.com | grep -o '"GL":"[A-Z]*"'
```

Порядок, которым переезжали: bootstrap.sh + harden-ssh.sh → ключ CI в
`~deploy/.ssh/authorized_keys` → новый read-only deploy key GitHub (`calc-hetzner-readonly`)
и клон в `/opt/calc` → образ `docker save | ssh docker load` со старого сервера →
`.env` через `scripts/migrate-env-to-hetzner.command` → дамп Postgres в пустую базу →
`deploy.sh <sha>` → A-запись, `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS` → выключение Timeweb.
