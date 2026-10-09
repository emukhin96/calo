#!/usr/bin/env bash
###############################################################################
# Деплой calc на VPS. Обычно запускает GitHub Actions (через ci-entry.sh)
# после того, как загрузил образ calc:<sha> через `docker load`:
#   ssh calc '/opt/calc/deploy/vps/deploy.sh <git-sha>'
# Вручную — откат на прошлую версию, если её образ ещё есть (docker images calc).
#
# checkout → .env (при первом запуске) → бэкап → up -d → Caddy (если сменился
# Caddyfile) → healthcheck → чистка.
# Миграции БД применяет само приложение при старте (src/instrumentation.ts).
###############################################################################
set -euo pipefail

SHA="${1:?укажите git sha}"
source "$(dirname "$(readlink -f "$0")")/lib.sh"
cd "$APP_DIR"

if [ -z "${DEPLOY_REEXEC:-}" ]; then
  echo "==> Checkout $SHA"
  git fetch -q origin
  git checkout -q -f --detach "$SHA"
  chmod +x deploy/vps/*.sh
  # bash держит открытым старый deploy.sh — перезапускаемся из нового кода.
  DEPLOY_REEXEC=1 exec "$APP_DIR/deploy/vps/deploy.sh" "$SHA"
fi
echo "==> At $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"

docker image inspect "calc:$SHA" >/dev/null 2>&1 || { echo "!! нет образа calc:$SHA — сначала docker load"; exit 1; }

mkdir -p "$DATA_DIR"/{postgres,photos,backups,logs}

if [ ! -f "$ENV_FILE" ]; then
  echo "==> Первый запуск: создаю $ENV_FILE со случайными секретами"
  umask 077
  cat > "$ENV_FILE" <<EOF
# Создано deploy.sh $(date -u +%F). Секреты не в git. Правка → повторный deploy.sh.
BETTER_AUTH_URL=https://calc.egor.am
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
# Владельцы через запятую (раньше ALLOWED_EMAILS): общий дневной лимит ИИ их не касается
OWNER_EMAILS=${CALC_OWNER_EMAIL:-}
# Регистрация открыта всем; closed — аварийно закрыть (входят только существующие)
SIGNUP=open
# Почта для ссылок входа; пока пусто — ссылка в логе (deploy/vps/login-link.sh)
SMTP_URL=
MAIL_FROM=Calo <no-reply@egor.am>
# Этап 6
ANTHROPIC_API_KEY=
EOF
fi

PREV="$(grep -E '^APP_VERSION=' "$VERSION_FILE" 2>/dev/null | cut -d= -f2 || true)"
echo "APP_VERSION=$SHA" > "$VERSION_FILE"

if [ -n "$PREV" ] && $COMPOSE ps --status running --services 2>/dev/null | grep -qx calc-db; then
  echo "==> Backup before deploy"
  "$APP_DIR/deploy/vps/backup.sh" || echo "!! backup failed, continuing"
fi

echo "==> Starting services"
$COMPOSE up -d --remove-orphans

# Caddyfile смонтирован в контейнер одним файлом: git checkout кладёт новый файл
# (новый inode), а Caddy видит старый, и `up -d` его не пересоздаёт. Сверяем по
# sha256 и при отличии пересоздаём — сначала проверив новый конфиг отдельно.
CADDY_BROKEN=0
want="$(sha256sum deploy/vps/Caddyfile | cut -d' ' -f1)"
have="$($COMPOSE exec -T caddy sha256sum /etc/caddy/Caddyfile 2>/dev/null | cut -d' ' -f1 || true)"
if [ "$want" != "$have" ]; then
  echo "==> Caddyfile changed — validating"
  if out="$(docker run --rm -v "$APP_DIR/deploy/vps/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1)"; then
    # Новый контейнер заодно выбрасывает старый json-лог (в нём были токены).
    if $COMPOSE up -d --force-recreate caddy; then
      echo "==> Caddy recreated with the new Caddyfile"
    else
      echo "!! caddy не пересоздан"
      CADDY_BROKEN=1
    fi
  else
    printf '%s\n' "$out" | tail -n 20
    echo "!!!!! Caddyfile НЕ прошёл проверку — работает старый Caddy, деплой завершится ошибкой"
    CADDY_BROKEN=1
  fi
fi

echo "==> Health"
for _ in $(seq 1 30); do
  if $COMPOSE exec -T calc-web wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"ok":true'; then
    echo "===== Deploy OK ($(git rev-parse --short HEAD)) ====="
    # Храним три последних образа для отката.
    docker images calc --format '{{.Tag}} {{.CreatedAt}}' | sort -k2 -r | awk 'NR>3 {print $1}' \
      | while read -r tag; do [ "$tag" != "$SHA" ] && docker rmi "calc:$tag" >/dev/null 2>&1 || true; done
    docker image prune -f >/dev/null 2>&1 || true
    # Приложение обновлено, но красный CI напомнит про Caddyfile.
    [ "$CADDY_BROKEN" = 0 ] || { echo "!!!!! Caddy работает со старым Caddyfile — см. ошибку выше"; exit 1; }
    exit 0
  fi
  sleep 2
done

echo "!! healthcheck failed"
$COMPOSE logs --tail=60 calc-web
if [ -n "$PREV" ] && [ "$PREV" != "$SHA" ]; then
  echo "==> Rollback to $PREV"
  echo "APP_VERSION=$PREV" > "$VERSION_FILE"
  $COMPOSE up -d calc-web
fi
exit 1
