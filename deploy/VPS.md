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
   бэкап, `docker compose up -d`, пересоздание Caddy, если изменился `Caddyfile`
   (см. ниже), healthcheck `/api/health`; если приложение не поднялось — откат на
   прошлую версию.

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
ключей закрыты), `AI_DAILY_LIMIT` (запросов на пользователя в день, по умолчанию 60) и
`AI_GLOBAL_DAILY_LIMIT` (на всех, кроме владельцев, за сутки UTC, по умолчанию 600).
Остальное в `.env` — `ssh calc`, `nano /opt/calc/.env`,
затем `deploy.sh` с текущим sha (`cat /opt/calc/.version.env`).

## Регистрация и лимиты

Вход открыт всем: новый человек получает ссылку на почту, аккаунт создаётся при
первом входе, дальше — анкета. Удалить аккаунт можно в настройках (подтверждение
письмом; все данные удаляются вместе с ним).

- `OWNER_EMAILS` — владельцы через запятую: на них не действует общий лимит ИИ.
  Старое имя `ALLOWED_EMAILS` читается, пока `OWNER_EMAILS` не задан; списком допуска
  оно больше не служит.
- `SIGNUP=open|closed` (по умолчанию open). Аварийно закрыть регистрацию — войти
  смогут только те, у кого аккаунт уже есть; новому адресу письмо придёт (без
  обещания аккаунта), но по ссылке он увидит «Регистрация временно закрыта», а экран
  входа — «Регистрация новых пользователей временно закрыта»:

  ```bash
  printf 'closed\n' | ssh calc /opt/calc/deploy/vps/set-secret.sh SIGNUP   # открыть снова — open
  ```

- Лимиты писем (ссылки входа и удаления аккаунта; счёт в памяти приложения, после
  перезапуска — с нуля). Адрес считается без регистра, «+метки» и, у Gmail, без точек
  (googlemail.com = gmail.com); письмо уходит на адрес как введён. IP — как у
  ограничителя better-auth: из `X-Forwarded-For`, который ставит Caddy (IPv6 — по /64).
  - С одного IP на один адрес — не чаще раза в минуту и не больше 5 в час; на один
    адрес с любых IP — не больше 10 в час (вход и удаление считаются отдельно). Один
    чужой IP займёт из них не больше 5; с нескольких IP лимит адреса можно выбрать, и
    вход по почте на этот адрес подождёт до часа (Face ID на вебе не ограничен).
  - `MAIL_IP_DAILY_LIMIT` — писем с одного IP за сутки UTC на любые адреса (по
    умолчанию 30). Если IP определить не удалось, этот лимит не действует (в логе
    `[mail] не удалось определить IP`).
  - `MAIL_DAILY_LIMIT` — писем на регистрацию (ссылка на адрес, у которого аккаунта
    ещё нет) за сутки UTC на всех (по умолчанию 300): бан ящика за спам ударил бы по
    всем. Вход тех, у кого аккаунт уже есть, и удаление аккаунта этот лимит не
    считает и не держит — поток случайных адресов их не запрёт. Сверх лимита новичок
    видит «Регистрация новых пользователей на сегодня приостановлена».
- `AI_GLOBAL_DAILY_LIMIT` — запросов к ИИ на всех за сутки UTC (по умолчанию 600):
  ключ Gemini один, чужие аккаунты не должны съесть его квоту. Счётчик — в `app_meta`
  (`ai_requests:<дата>`), удаление аккаунта его не уменьшает.
- Push: подписки принимаются только на адреса push-сервисов браузеров (FCM, Apple,
  Mozilla, WNS), не больше 10 на человека — сверх этого вытесняются самые старые.

Задать или поменять — `set-secret.sh` (как выше), он же перезапускает приложение.

## Caddy

`deploy/vps/Caddyfile` смонтирован в контейнер одним файлом. `git checkout` кладёт
новый файл, а работающий Caddy продолжает видеть старый, и `up -d` его не
пересоздаёт. Поэтому `deploy.sh` сверяет sha256 файла в репозитории и в контейнере;
если отличаются — проверяет новый конфиг отдельным контейнером `caddy validate` и
пересоздаёт `caddy` (`up -d --force-recreate caddy`; старый json-лог уходит вместе с
контейнером). Конфиг с ошибкой не применяется: Caddy остаётся на старом, приложение
обновляется, но деплой завершается ошибкой (CI красный) — ошибка проверки в его логе.

В логе запросов токены не пишутся: `token` в адресе (ссылки входа и удаления
аккаунта) заменён на `REDACTED`, заголовок `Set-Auth-Token` (токен сессии от
плагина bearer, клиентам не нужен) снимается ещё на прокси. Тело запросов к
`/api/auth/*` — не больше 64 КБ, к остальному — 20 МБ (фото).

## Почта (письма со ссылкой входа)

Ящик `no-reply@egor.am` в почте Timeweb (домен egor.am: MX, SPF и DKIM — у Timeweb).
Настройка — двойной щелчок по `scripts/set-smtp.command`: спрашивает пароль ящика
(ввод скрыт), проверяет вход в SMTP с сервера, пишет `SMTP_URL` и `MAIL_FROM` в
`/opt/calc/.env`, перезапускает приложение и просит его прислать письмо со ссылкой
входа владельцу (первый адрес `OWNER_EMAILS`, если не задан — `ALLOWED_EMAILS`).

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
- Cron (`crontab deploy/vps/crontab.example`): бэкап ежедневно 01:45 UTC (14 дней;
  копии пока только на сервере — вынести наружу, TODO); каждый час `cron-hourly.sh` —
  напоминания о разборе недели (пн 9–12 по местному, `/api/cron/weekly`) и чистка
  просроченных токенов входа (`/api/cron/cleanup`). Вызовы независимы: упавший не
  отменяет другой (лог — `data/logs/cron.log`).

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
