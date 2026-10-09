#!/bin/bash
# Двойной щелчок в Finder: почта для писем со ссылкой входа — ящик на egor.am в Timeweb.
# Спрашивает пароль ящика (ввод скрыт), проверяет вход в SMTP с сервера calc,
# записывает SMTP_URL и MAIL_FROM в /opt/calc/.env и просит приложение прислать
# настоящее письмо со ссылкой входа. Пароль не попадает ни на экран, ни в историю
# команд, ни в список процессов.
#
# Порт 587 (STARTTLS): у Hetzner исходящие 25 и 465 закрыты — smtps://…:465 не
# соединится. Запасной порт Timeweb — 2525.

HOST="smtp.timeweb.ru"
PORTS="587 2525"
SITE="https://calc.egor.am"

echo "Calo — почта для писем со ссылкой входа"
echo

# Процентная кодировка для логина и пароля в SMTP_URL — средствами bash, без
# внешних программ (значение не уходит в аргументы процессов).
urlencode() {
  local LC_ALL=C s="$1" out="" c h n i
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    case "$c" in
      [a-zA-Z0-9._~-]) out+="$c" ;;
      # Байт ≥ 0x80 bash 3.2 отдаёт со знаком (−47) — маска 255 даёт 0xD1.
      *) printf -v n '%d' "'$c"; printf -v h '%%%02X' $((n & 255)); out+="$h" ;;
    esac
  done
  printf '%s' "$out"
}

LOGIN="$(osascript \
  -e 'display dialog "Ящик, с которого уходят письма:" default answer "no-reply@egor.am" with title "Calo — почта"' \
  -e 'text returned of result' 2>/dev/null)"
[ -n "$LOGIN" ] || read -r -p "Ящик [no-reply@egor.am]: " LOGIN
LOGIN="${LOGIN:-no-reply@egor.am}"

PASS="$(osascript \
  -e "display dialog \"Пароль от ящика $LOGIN (Cmd+V) — из панели Timeweb:\" default answer \"\" with hidden answer with title \"Calo — почта\"" \
  -e 'text returned of result' 2>/dev/null)"
if [ -z "$PASS" ]; then
  echo "Вставьте пароль ящика $LOGIN (Cmd+V) и нажмите Enter."
  echo "Символы не отображаются — так и должно быть."
  read -rs -p "Пароль: " PASS
  echo
fi

finish() {
  unset PASS URL
  echo
  read -n 1 -s -r -p "Нажмите любую клавишу, чтобы закрыть окно…"
  exit "${1:-0}"
}

if [ -z "$PASS" ]; then
  echo "Пароль не введён — ничего не изменено."
  finish 1
fi

# 1) Вход в SMTP с сервера (тот же путь, что у приложения). Адрес с паролем —
#    в конфиге curl из stdin, не в аргументах.
URL=""
for PORT in $PORTS; do
  echo "Проверяю вход в $HOST:$PORT с сервера…"
  candidate="smtp://$(urlencode "$LOGIN"):$(urlencode "$PASS")@$HOST:$PORT"
  out="$(printf 'url = "%s"\n' "$candidate" | ssh calc 'curl -sS --ssl-reqd --max-time 20 -K - -o /dev/null 2>&1; echo "exit=$?"')"
  code="${out##*exit=}"
  case "$code" in
    0) echo "✓ вход в почту работает"; URL="$candidate"; break ;;
    67) echo "!! Timeweb не принял логин или пароль. Проверьте пароль ящика $LOGIN в панели Timeweb."; finish 1 ;;
    *) echo "   порт $PORT не подошёл: ${out%exit=*}" ;;
  esac
done
if [ -z "$URL" ]; then
  echo "!! Не удалось соединиться с $HOST ни на одном порту — ничего не изменено."
  finish 1
fi

# 2) Отправитель — тот же ящик (иначе письма уйдут в спам или не уйдут вовсе);
#    без перезапуска (CALC_ENV_FILE), приложение перезапустит запись SMTP_URL.
printf '%s\n' "Calo <$LOGIN>" | ssh calc 'CALC_ENV_FILE=/opt/calc/.env /opt/calc/deploy/vps/set-secret.sh MAIL_FROM' || finish 1
printf '%s\n' "$URL" | ssh calc /opt/calc/deploy/vps/set-secret.sh SMTP_URL || finish 1
unset PASS URL candidate

# 3) Настоящее письмо со ссылкой входа — через само приложение.
echo "Жду, пока приложение поднимется…"
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$SITE/api/health")" = 200 ] && break
  sleep 2
done
OWNER="$(ssh calc "grep -E '^OWNER_EMAILS=' /opt/calc/.env | cut -d= -f2 | cut -d, -f1 | tr -d ' \"'")"
[ -n "$OWNER" ] || OWNER="$(ssh calc "grep -E '^ALLOWED_EMAILS=' /opt/calc/.env | cut -d= -f2 | cut -d, -f1 | tr -d ' \"'")"
if [ -z "$OWNER" ]; then
  echo "Почта настроена. Проверьте вход по ссылке на $SITE/login."
  finish 0
fi
echo "Прошу приложение прислать ссылку для входа на $OWNER…"
status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -X POST "$SITE/api/auth/sign-in/magic-link" \
  -H 'content-type: application/json' -H "origin: $SITE" \
  -d "{\"email\":\"$OWNER\",\"callbackURL\":\"/\"}")"
if [ "$status" = 200 ]; then
  echo "✓ Письмо отправлено — проверьте $OWNER (и папку «Спам»)."
else
  echo "!! Приложение не смогло отправить письмо (HTTP ${status:-нет ответа}). Последние ошибки:"
  ssh calc 'cd /opt/calc && . deploy/vps/lib.sh && $COMPOSE logs --since 3m calc-web 2>&1 | grep -iE "mail|smtp|error" | tail -5'
fi
finish 0
