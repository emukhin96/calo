#!/usr/bin/env bash
# Разово: ключи VAPID для Web Push и секрет для cron — прямо в /opt/calc/.env
# (генерирует контейнер приложения, значения на экран не выводятся).
#   ssh calc /opt/calc/deploy/vps/gen-push-keys.sh
set -euo pipefail
source "$(dirname "$(readlink -f "$0")")/lib.sh"
if grep -q '^VAPID_PRIVATE_KEY=.' "$ENV_FILE"; then
  echo "ключи VAPID уже есть — ничего не меняю"
else
  umask 077
  $COMPOSE exec -T calc-web node -e '
    const k = require("web-push").generateVAPIDKeys();
    process.stdout.write(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\nVAPID_SUBJECT=mailto:admin@calc.egor.am\n`);
  ' >>"$ENV_FILE"
  echo "✓ ключи VAPID записаны"
fi
if ! grep -q '^CRON_SECRET=.' "$ENV_FILE"; then
  printf 'CRON_SECRET=%s\n' "$(openssl rand -hex 24)" >>"$ENV_FILE"
  echo "✓ CRON_SECRET записан"
fi
$COMPOSE up -d --force-recreate calc-web >/dev/null 2>&1 && echo "✓ приложение перезапущено"
