#!/usr/bin/env bash
# Раз в час (crontab.example): напоминания о разборе недели. CRON_SECRET
# подставляется внутри контейнера из его окружения — на хост не выходит.
set -euo pipefail
source "$(dirname "$(readlink -f "$0")")/lib.sh"
printf '%s ' "$(date -u +%FT%TZ)"
$COMPOSE exec -T calc-web sh -c 'wget -qO- --header="Authorization: Bearer $CRON_SECRET" --post-data="" http://127.0.0.1:3000/api/cron/weekly'
echo
