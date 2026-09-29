#!/bin/bash
# Двойной щелчок после установки Xcode из App Store: делает Xcode инструментом
# по умолчанию для командной строки, принимает лицензию и ставит компоненты.
# Спросит пароль от Mac (sudo) — символы при вводе не видны, так и должно быть.
echo "Calo — настройка Xcode"
echo
if [ ! -d /Applications/Xcode.app ]; then
  echo "Xcode не найден в «Программах». Установите его из App Store и запустите этот файл снова."
else
  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer &&
    sudo xcodebuild -license accept &&
    xcodebuild -runFirstLaunch &&
    echo && echo "✓ Xcode готов: $(xcodebuild -version | head -1)"
  echo
  echo "Симуляторы iOS: $(xcrun simctl list runtimes 2>/dev/null | grep -c iOS) шт."
  echo "Если 0 — откройте Xcode → Settings → Components и скачайте iOS."
fi
echo
read -n 1 -s -r -p "Нажмите любую клавишу, чтобы закрыть окно…"
