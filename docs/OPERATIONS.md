# Рутинные операции

Шпаргалка по всему, что делается руками. Устройство сервера, стек и история
переезда — [deploy/VPS.md](../deploy/VPS.md); локальная разработка — [README](../README.md).

Файлы `scripts/*.command` запускаются двойным щелчком в Finder: секреты вводятся
скрыто (окошко macOS или `read -s`) и не попадают ни на экран, ни в историю команд.

## Деплой

Отдельной команды нет — деплой идёт сам при попадании коммита в `main`:

```bash
git push origin main
```

GitHub Actions (`.github/workflows/deploy.yml`): `pnpm lint` → `pnpm typecheck` →
`pnpm test` → сборка образа `calc:<sha>` → `docker save | ssh deploy@calc load` →
`ssh deploy@calc "deploy <sha>"` → `deploy/vps/deploy.sh`: checkout, бэкап,
`docker compose up -d`, healthcheck `/api/health`, при провале — откат на прошлую
версию. Миграции БД применяет само приложение при старте (`src/instrumentation.ts`).

На PR выполняются только проверки, без деплоя. Повторить деплой без нового коммита —
Actions → «CI / Deploy» → Run workflow (ветка `main`).

Перед пушем полезно прогнать то же, что CI:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## Откат и передеплой вручную

На сервере хранятся три последних образа.

```bash
ssh calc 'docker images calc'                          # какие версии есть
ssh calc '/opt/calc/deploy/vps/deploy.sh <sha>'        # откатиться (полный 40-символьный sha)
ssh calc 'cat /opt/calc/.version.env'                  # какая версия запущена сейчас
```

Передеплой текущей версии (например, после ручной правки `.env`):

```bash
ssh calc '/opt/calc/deploy/vps/deploy.sh $(grep APP_VERSION= /opt/calc/.version.env | cut -d= -f2)'
```

## Состояние и логи

```bash
ssh calc 'cd /opt/calc && . deploy/vps/lib.sh && $COMPOSE ps'                     # контейнеры
ssh calc 'cd /opt/calc && . deploy/vps/lib.sh && $COMPOSE logs -f calc-web'       # лог приложения
ssh calc 'cd /opt/calc && . deploy/vps/lib.sh && $COMPOSE logs --tail=100 caddy'  # HTTPS, сертификаты
ssh calc 'tail -n 20 /opt/calc/data/logs/backup.log'   # ночные бэкапы
ssh calc 'tail -n 20 /opt/calc/data/logs/cron.log'     # ежечасный cron (напоминания)
ssh calc 'df -h / && docker system df'                 # диск
curl -s https://calc.egor.am/api/health                # жив ли прод снаружи
```

## Вход в приложение

Письмо со ссылкой приходит с `no-reply@egor.am`. Если не пришло — ошибка в логе
приложения строкой `[mail] …`, а ссылку можно достать из лога (после нажатия
«Прислать ссылку» на calc.egor.am/login, работает, пока `SMTP_URL` пуст):

```bash
ssh calc /opt/calc/deploy/vps/login-link.sh
```

Кому разрешён вход — `ALLOWED_EMAILS` в `/opt/calc/.env` (через запятую).

## Секреты и настройки сервера

Всё лежит в `/opt/calc/.env` (не в git). Секреты — только через скрипты со скрытым
вводом; каждый проверяет значение и перезапускает приложение.

| Что | Как |
|---|---|
| Ключ Gemini | `scripts/set-gemini-key.command` |
| Почта (пароль ящика no-reply@egor.am) | `scripts/set-smtp.command` — пишет `SMTP_URL`, `MAIL_FROM`, шлёт тестовое письмо |
| Любой другой секрет | `read -rs -p "Значение: " V; echo; printf '%s\n' "$V" \| ssh calc /opt/calc/deploy/vps/set-secret.sh ИМЯ; unset V` |
| Несекретные переменные | `ssh calc`, `nano /opt/calc/.env`, затем передеплой текущей версии (выше) |
| Ключи VAPID и `CRON_SECRET` (разово, уже сделано) | `ssh calc /opt/calc/deploy/vps/gen-push-keys.sh` |

Необязательные переменные: `GEMINI_MODEL` (по умолчанию `gemini-3.1-flash-lite`),
`AI_DAILY_LIMIT` (запросов ИИ на пользователя в день, 60), `RETENTION_DAYS`
(сколько дней хранить бэкапы, 14).

## Бэкапы

Cron делает бэкап ежедневно в 01:45 UTC, `deploy.sh` — перед каждым деплоем.
Лежат в `/opt/calc/data/backups`: `db-<время>.sql.gz` (pg_dump) и
`photos-<время>.tar.gz`, хранятся 14 дней. Копии пока только на сервере (TODO — вынести наружу).

```bash
ssh calc /opt/calc/deploy/vps/backup.sh                     # бэкап сейчас
ssh calc 'ls -lh /opt/calc/data/backups | tail'             # список
scp 'calc:/opt/calc/data/backups/db-*.sql.gz' ~/Backups/calc/   # забрать к себе
```

### Восстановление

На Hetzner ещё не отрабатывалось — сначала проверить на свежем бэкапе. На сервере
(`ssh calc`), `<STAMP>` — время из имени файла:

```bash
cd /opt/calc && . deploy/vps/lib.sh
./deploy/vps/backup.sh                         # страховка: текущее состояние
$COMPOSE stop calc-web
$COMPOSE exec -T calc-db dropdb -U calc calc
$COMPOSE exec -T calc-db createdb -U calc calc
gunzip -c data/backups/db-<STAMP>.sql.gz | $COMPOSE exec -T calc-db psql -U calc -d calc -v ON_ERROR_STOP=1 -q
tar -xzf data/backups/photos-<STAMP>.tar.gz -C data   # фото, если нужны
$COMPOSE start calc-web
```

## Cron на сервере

Уже установлен из `deploy/vps/crontab.example` (пользователь `deploy`, время UTC):
бэкап в 01:45 и `cron-hourly.sh` каждый час в :07 (напоминания о недельном разборе).
После правки файла:

```bash
ssh calc 'crontab /opt/calc/deploy/vps/crontab.example && crontab -l'
```

## База и справочник продуктов

```bash
pnpm db:generate     # миграция в drizzle/ из изменений src/db/schema — закоммитить вместе со схемой
pnpm auth:schema     # перегенерировать таблицы Better Auth после смены плагинов
pnpm foods:usda      # пересобрать seed/foods/usda.json (USDA FoodData Central)
pnpm foods:staples   # пересобрать seed/foods/staples.json (медианы Open Food Facts)
```

Миграции и изменившиеся файлы `seed/foods/` применяются при старте сервера — и
локально, и на проде после деплоя. Руками ничего запускать не нужно.
Русские названия — `seed/foods/usda.ru.json`, правятся вручную.

## ИИ (Gemini)

```bash
scripts/ai-eval.command    # 30 эталонных фраз через Gemini, печатает качество разбора
```

Ключ спрашивается скрыто и живёт только в этом процессе. Запускать после смены
модели, промпта или matcher'а. Если Gemini отвечает «User location is not supported» —
Google снова считает IP сервера не тем; проверка страны:
`curl -s https://www.youtube.com | grep -o '"GL":"[A-Z]*"'` (на сервере должно быть `DE`).

## iOS-приложение

| Что | Как |
|---|---|
| Подготовить проект (cap sync + xcodegen) | `pnpm ios`, затем `open ios/App/App.xcodeproj` → Run |
| Против локального сервера в симуляторе | `CALO_URL=http://localhost:3000 pnpm ios` |
| Собрать и поставить на iPhone по кабелю | `scripts/ios-install.command` — **раз в 7 дней** (бесплатный Apple ID) |
| Журнал iPhone за 15 минут (разбор виджета) | `scripts/ios-logs.command` → `~/Library/Caches/calo/device.logarchive` |
| Симулятор не видит iOS (`supportedRuntimes=[]`) | `scripts/fix-simulator.command` |
| Xcode после установки/обновления | `scripts/xcode-setup.command` |

Сборка для устройства идёт в DerivedData вне Dropbox — атрибуты Dropbox ломают подпись.

## Разовые операции (уже сделаны, для нового сервера)

`bootstrap.sh` → `harden-ssh.sh` → ключ CI в `~deploy/.ssh/authorized_keys` →
deploy key GitHub и клон в `/opt/calc` → `.env` → `deploy.sh <sha>` → `gen-push-keys.sh` →
crontab → DNS, `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS`. Подробно — [deploy/VPS.md](../deploy/VPS.md).
