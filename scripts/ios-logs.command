#!/bin/bash
# Двойной щелчок: снимает системный журнал подключённого iPhone за последние 15 минут —
# чтобы Claude разобрал, что происходит с виджетом Calo. Журнал остаётся на этом Mac
# (~/Library/Caches/calo/device.logarchive), никуда не отправляется.
# Спросит пароль от Mac — символы при вводе не видны, так и должно быть.
OUT="$HOME/Library/Caches/calo/device.logarchive"
echo "Calo — журнал iPhone"
echo
mkdir -p "$(dirname "$OUT")"
sudo rm -rf "$OUT"
J=$(mktemp)
xcrun devicectl list devices --json-output "$J" >/dev/null 2>&1
UDID=$(python3 -c 'import json,sys
d=json.load(open(sys.argv[1]))["result"]["devices"]
p=[x["hardwareProperties"]["udid"] for x in d if x["hardwareProperties"].get("deviceType")=="iPhone"]
print(p[0] if p else "")' "$J" 2>/dev/null)
rm -f "$J"
if [ -z "$UDID" ]; then
  echo "✗ iPhone не найден — подключите его кабелем и разблокируйте."
else
  sudo log collect --device-udid "$UDID" --last 15m --output "$OUT" &&
    sudo chown -R "$USER" "$OUT" &&
    echo && echo "✓ Готово — напишите Claude «собрал»."
fi
echo
read -n 1 -s -r -p "Нажмите любую клавишу, чтобы закрыть окно…"
