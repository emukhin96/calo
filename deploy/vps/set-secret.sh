#!/usr/bin/env bash
###############################################################################
# Записать секрет в /opt/calc/.env. Значение читается из stdin — не попадает
# ни в историю команд, ни в список процессов (только встроенные команды bash).
# С Mac, со скрытым вводом (см. deploy/VPS.md):
#   read -rs -p "Ключ: " KEY; echo; printf '%s\n' "$KEY" | ssh calc /opt/calc/deploy/vps/set-secret.sh ANTHROPIC_API_KEY; unset KEY
# Для ANTHROPIC_API_KEY сразу проверяет ключ. В конце перезапускает приложение.
###############################################################################
set -euo pipefail
source "$(dirname "$(readlink -f "$0")")/lib.sh"
ENV_FILE="${CALC_ENV_FILE:-$ENV_FILE}"

NAME="${1:?укажите имя переменной, например ANTHROPIC_API_KEY}"
[[ "$NAME" =~ ^[A-Z_][A-Z0-9_]*$ ]] || { echo "!! недопустимое имя: $NAME" >&2; exit 2; }
IFS= read -r VALUE || true
VALUE="${VALUE%$'\r'}"
VALUE="${VALUE#"${VALUE%%[![:space:]]*}"}" # без пробелов по краям — частая ошибка при вставке
VALUE="${VALUE%"${VALUE##*[![:space:]]}"}"
[ -n "$VALUE" ] || { echo "!! пустое значение — ничего не изменено" >&2; exit 1; }

umask 077
tmp="$ENV_FILE.tmp"
found=0
while IFS= read -r line || [ -n "$line" ]; do
  if [[ "$line" == "$NAME="* ]]; then
    printf '%s=%s\n' "$NAME" "$VALUE"
    found=1
  else
    printf '%s\n' "$line"
  fi
done <"$ENV_FILE" >"$tmp"
[ "$found" = 1 ] || printf '%s=%s\n' "$NAME" "$VALUE" >>"$tmp"
mv "$tmp" "$ENV_FILE"
echo "✓ $NAME записан в $ENV_FILE"

if [ "$NAME" = ANTHROPIC_API_KEY ]; then
  # Ключ — в заголовке из временного файла, а не в аргументах curl.
  hdr="$(mktemp)"
  printf 'x-api-key: %s\nanthropic-version: 2023-06-01\n' "$VALUE" >"$hdr"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H @"$hdr" https://api.anthropic.com/v1/models || true)"
  rm -f "$hdr"
  case "$code" in
    200) echo "✓ ключ работает" ;;
    401) echo "!! Anthropic не принял ключ (401) — проверьте, что скопирован целиком" ;;
    403) echo "!! доступ запрещён (403) — проверьте страну аккаунта и оплату" ;;
    *) echo "!! не удалось проверить ключ (HTTP ${code:-нет ответа})" ;;
  esac
fi

if [ -z "${CALC_ENV_FILE:-}" ]; then
  $COMPOSE up -d --force-recreate calc-web >/dev/null 2>&1 && echo "✓ приложение перезапущено с новым значением"
fi
