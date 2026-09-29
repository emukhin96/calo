#!/usr/bin/env bash
# Раз в час (crontab.example): напоминания о разборе недели. Секрет CRON_SECRET
# берётся из окружения контейнера — в аргументы командной строки не попадает.
set -euo pipefail
source "$(dirname "$(readlink -f "$0")")/lib.sh"
$COMPOSE exec -T calc-web sh -c '
  printf "Authorization: Bearer %s\r\n" "$CRON_SECRET" > /tmp/cron-auth
  wget -qO- --header="$(cat /tmp/cron-auth)" --post-data="" http://127.0.0.1:3000/api/cron/weekly
  rm -f /tmp/cron-auth
'
echo
