#!/bin/bash
# Двойной щелчок: перезапускает службу образов симуляторов (simdiskimaged),
# когда платформа iOS скачана, но не подключается («supportedRuntimes=[]»).
# Спросит пароль от Mac — символы при вводе не видны, так и должно быть.
echo "Calo — перезапуск симулятора iOS"
echo
sudo killall -9 simdiskimaged com.apple.CoreSimulator.CoreSimulatorService 2>/dev/null
echo "Служба перезапущена, жду подключения iOS (до минуты)…"
for i in $(seq 1 12); do
  if xcrun simctl list runtimes 2>/dev/null | grep -q "iOS 26"; then break; fi
  sleep 5
done
echo
if xcrun simctl list runtimes 2>/dev/null | grep -q "iOS 26"; then
  echo "✓ Симулятор iOS подключён — напишите Claude «готово»."
else
  echo "Не подключился. Перезагрузите Mac (меню  → Перезагрузить) и напишите Claude."
fi
echo
read -n 1 -s -r -p "Нажмите любую клавишу, чтобы закрыть окно…"
