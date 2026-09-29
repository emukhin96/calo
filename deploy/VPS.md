# Сервер calc

| | |
|---|---|
| Адрес | `calc.egor.am` → 72.56.93.77 (Timeweb Cloud, Амстердам) |
| Машина | Ubuntu 24.04, 1 vCPU, 1 ГБ RAM + 2 ГБ swap, 15 ГБ диск |
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

```bash
ssh calc 'cd /opt/calc && . deploy/vps/lib.sh && $COMPOSE ps'          # состояние
ssh calc 'cd /opt/calc && . deploy/vps/lib.sh && $COMPOSE logs -f calc-web'
ssh calc /opt/calc/deploy/vps/login-link.sh                            # ссылка входа без SMTP
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

То же для `SMTP_URL`. Остальное в `.env` — `ssh calc`, `nano /opt/calc/.env`,
затем `deploy.sh` с текущим sha (`cat /opt/calc/.version.env`).

## Первичная настройка (уже сделано)

- `deploy/vps/bootstrap.sh` (root): обновления, swap, Docker, пользователь
  `deploy`, ufw (22, 80, 443 + мониторинг Timeweb), каталоги.
- `deploy/vps/harden-ssh.sh`: вход только по ключу и только `deploy`.
- Push: `deploy/vps/gen-push-keys.sh` — ключи VAPID и CRON_SECRET в `.env`.
- Cron (`crontab deploy/vps/crontab.example`): бэкап ежедневно 01:45 UTC (14 дней);
  каждый час `cron-hourly.sh` — напоминания о разборе недели (пн 9–12 по местному).
  Копии пока только на сервере — вынести наружу (TODO).
