#!/bin/bash
# Двойной щелчок: собирает Calo и ставит на подключённый кабелем iPhone.
# С бесплатным Apple ID приложение живёт 7 дней — потом запустите этот файл снова.
# Сборка — вне Dropbox: его служебные атрибуты ломают подпись (codesign «detritus»).
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
DD="$HOME/Library/Developer/Xcode/DerivedData/calo-device"
APP="$DD/Build/Products/Debug-iphoneos/App.app"
echo "Calo — установка на iPhone"
echo
fail() { echo; echo "✗ $1"; echo; read -n 1 -s -r -p "Нажмите любую клавишу, чтобы закрыть окно…"; exit 1; }

J=$(mktemp)
xcrun devicectl list devices --json-output "$J" >/dev/null 2>&1
DEVICE=$(python3 -c 'import json,sys
d=json.load(open(sys.argv[1]))["result"]["devices"]
p=[x["identifier"] for x in d if x["hardwareProperties"].get("deviceType")=="iPhone"]
print(p[0] if p else "")' "$J" 2>/dev/null)
rm -f "$J"
[ -n "$DEVICE" ] || fail "iPhone не найден. Подключите его кабелем, разблокируйте и запустите файл снова."

pnpm ios >/dev/null || fail "Не удалось подготовить проект (pnpm ios)."
echo "Собираю… (пара минут)"; rm -rf "$APP"
(cd ios/App && xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
  -destination "id=$DEVICE" -allowProvisioningUpdates -derivedDataPath "$DD" build 2>&1 |
  grep -E "error:|BUILD" | sort -u)
[ -d "$APP" ] || fail "Сборка не удалась — пришлите Claude текст выше."

echo "Устанавливаю на iPhone…"
xcrun devicectl device install app --device "$DEVICE" "$APP" >/dev/null 2>&1 ||
  fail "Не удалось установить. iPhone разблокирован?"
xcrun devicectl device process launch --device "$DEVICE" am.egor.calo >/dev/null 2>&1
echo
echo "✓ Calo установлен. Работает 7 дней — потом запустите этот файл снова."
echo
read -n 1 -s -r -p "Нажмите любую клавишу, чтобы закрыть окно…"
