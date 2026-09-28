#!/usr/bin/env bash
# Последняя ссылка для входа из лога, пока не настроен SMTP:
#   ssh calc /opt/calc/deploy/vps/login-link.sh
# Сначала нажмите «Прислать ссылку» на calc.egor.am/login.
set -euo pipefail
source "$(dirname "$(readlink -f "$0")")/lib.sh"
$COMPOSE logs --no-log-prefix --since 20m calc-web 2>/dev/null | grep '\[login-link\]' | tail -n 1 | awk '{print $3}'
