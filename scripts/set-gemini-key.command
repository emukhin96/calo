#!/bin/bash
# Двойной щелчок в Finder: спрашивает ключ Gemini (ввод скрыт), отправляет его
# на сервер calc и проверяет. Ключ не попадает ни на экран, ни в историю команд.
echo "Calo — установка ключа Gemini"
echo

# 1) окошко macOS; 2) если окошко недоступно — ввод прямо здесь.
KEY="$(osascript \
  -e 'display dialog "Вставьте ключ Gemini (Cmd+V) и нажмите OK:" default answer "" with hidden answer with title "Calo — ключ Gemini"' \
  -e 'text returned of result' 2>/dev/null)"

if [ -z "$KEY" ]; then
  echo "Вставьте ключ сюда (Cmd+V) и нажмите Enter."
  echo "Символы не отображаются — так и должно быть."
  read -rs -p "Ключ Gemini: " KEY
  echo
fi

if [ -z "$KEY" ]; then
  echo "Ключ не введён — ничего не изменено."
else
  echo "Отправляю на сервер и проверяю…"
  printf '%s\n' "$KEY" | ssh calc /opt/calc/deploy/vps/set-secret.sh GEMINI_API_KEY
fi
unset KEY
echo
read -n 1 -s -r -p "Готово. Нажмите любую клавишу, чтобы закрыть окно…"
