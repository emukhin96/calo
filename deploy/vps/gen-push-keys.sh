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
  # VAPID — пара ключей ECDSA P-256 (base64url): публичный — несжатая точка
  # 0x04‖x‖y, приватный — d. Встроенный crypto Node, без зависимостей.
  keys="$($COMPOSE exec -T calc-web node -e '
    const { generateKeyPairSync } = require("node:crypto");
    const jwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" });
    const b = (s) => Buffer.from(s, "base64url");
    const pub = Buffer.concat([Buffer.from([4]), b(jwk.x), b(jwk.y)]).toString("base64url");
    process.stdout.write(`VAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_KEY=${jwk.d}\nVAPID_SUBJECT=mailto:admin@calc.egor.am\n`);
  ')"
  [ "$(printf '%s\n' "$keys" | grep -c '^VAPID_')" = 3 ] || { echo "!! ключи не сгенерировались — .env не изменён" >&2; exit 1; }
  printf '%s\n' "$keys" >>"$ENV_FILE"
  unset keys
  echo "✓ ключи VAPID записаны"
fi
if ! grep -q '^CRON_SECRET=.' "$ENV_FILE"; then
  printf 'CRON_SECRET=%s\n' "$(openssl rand -hex 24)" >>"$ENV_FILE"
  echo "✓ CRON_SECRET записан"
fi
$COMPOSE up -d --force-recreate calc-web >/dev/null 2>&1 && echo "✓ приложение перезапущено"
