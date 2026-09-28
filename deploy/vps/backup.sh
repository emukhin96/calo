#!/usr/bin/env bash
# Бэкап calc: дамп Postgres + архив фото в data/backups, старше RETENTION_DAYS
# удаляются. Запускается из cron (crontab.example) и из deploy.sh перед деплоем.
set -euo pipefail
source "$(dirname "$(readlink -f "$0")")/lib.sh"
RETENTION_DAYS="$(env_get RETENTION_DAYS)"; RETENTION_DAYS="${RETENTION_DAYS:-14}"
DIR="$DATA_DIR/backups"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$DIR"

echo "==> pg_dump -> backups/db-$STAMP.sql.gz"
$COMPOSE exec -T calc-db pg_dump -U calc -d calc --no-owner | gzip > "$DIR/db-$STAMP.sql.gz.part"
mv "$DIR/db-$STAMP.sql.gz.part" "$DIR/db-$STAMP.sql.gz"

echo "==> photos -> backups/photos-$STAMP.tar.gz"
tar -czf "$DIR/photos-$STAMP.tar.gz" -C "$DATA_DIR" photos

find "$DIR" -type f -mtime +"$RETENTION_DAYS" -delete
ls -lh "$DIR" | tail -n 4
