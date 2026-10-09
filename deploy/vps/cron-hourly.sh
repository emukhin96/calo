#!/usr/bin/env bash
# Раз в час (crontab.example): напоминания о разборе недели и чистка просроченного
# (токены ссылок входа и т. п.). CRON_SECRET подставляется внутри контейнера из его
# окружения — на хост не выходит.
set -euo pipefail
source "$(dirname "$(readlink -f "$0")")/lib.sh"

# POST /api/cron/<имя> с таймаутом: зависший запрос не копит процессы cron.
post() {
  printf '%s %s ' "$(date -u +%FT%TZ)" "$1"
  local code=0
  $COMPOSE exec -T calc-web sh -c 'wget -qO- -T "$2" --header="Authorization: Bearer $CRON_SECRET" --post-data="" "http://127.0.0.1:3000/api/cron/$1"' _ "$1" "$2" || code=$?
  [ "$code" = 0 ] || printf '!! failed (%s)' "$code"
  echo
  return "$code"
}

# Упавший вызов не отменяет следующий (set -e), но код выхода — ошибка.
rc=0
post weekly 300 || rc=1
post cleanup 120 || rc=1
exit "$rc"
