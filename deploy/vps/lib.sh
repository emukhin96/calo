# Общие переменные скриптов deploy/vps/*.sh (source, не запускать).
APP_DIR=/opt/calc
DATA_DIR="$APP_DIR/data"
ENV_FILE="$APP_DIR/.env"
VERSION_FILE="$APP_DIR/.version.env"
COMPOSE="docker compose --env-file $ENV_FILE --env-file $VERSION_FILE -f $APP_DIR/deploy/vps/compose.yaml"

# `|| true`: при set -e -o pipefail отсутствие переменной (grep → 1) не должно валить скрипт —
# без этого backup.sh молча падал на RETENTION_DAYS и бэкапы не делались.
env_get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- || true; }
