#!/bin/bash
# Двойной щелчок в Finder: переносит файл секретов /opt/calc/.env со старого
# сервера calc (Timeweb, 72.56.93.77) на новый (Hetzner, 167.233.67.102).
# Содержимое не показывается на экране — только имена переменных для сверки.
OLD=calc
NEW=deploy@167.233.67.102
echo "Calo — перенос секретов на новый сервер"
echo
echo "Читаю .env со старого сервера и записываю на новый…"
if ssh "$OLD" 'cat /opt/calc/.env' | ssh -o StrictHostKeyChecking=accept-new "$NEW" 'umask 077; cat > /opt/calc/.env.tmp && mv /opt/calc/.env.tmp /opt/calc/.env'; then
  echo "✓ записано. Переменные на новом сервере:"
  ssh "$NEW" 'grep -E "^[A-Z_]+=" /opt/calc/.env | cut -d= -f1 | sed "s/^/  /"'
else
  echo "!! не удалось — напишите Claude, что именно вывелось выше"
fi
echo
read -n 1 -s -r -p "Готово. Нажмите любую клавишу, чтобы закрыть окно…"
