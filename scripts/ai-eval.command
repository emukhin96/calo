#!/bin/bash
# Двойной щелчок в Finder: прогоняет 30 эталонных фраз через Gemini и печатает
# качество разбора. Ключ спрашивается скрыто и живёт только в этом процессе.
cd "$(dirname "$0")/.." || exit 1
echo "Calo — проверка разбора текста через Gemini"
echo
KEY="$(osascript \
  -e 'display dialog "Вставьте ключ Gemini (Cmd+V) и нажмите OK:" default answer "" with hidden answer with title "Calo — ключ Gemini"' \
  -e 'text returned of result' 2>/dev/null)"
if [ -z "$KEY" ]; then
  read -rs -p "Ключ Gemini (ввод скрыт): " KEY
  echo
fi
if [ -z "$KEY" ]; then
  echo "Ключ не введён."
else
  # --conditions=react-server: пакет server-only вне Next иначе бросает ошибку при импорте
  GEMINI_API_KEY="$KEY" pnpm exec tsx --conditions=react-server scripts/ai-eval.ts
fi
unset KEY
echo
read -n 1 -s -r -p "Готово. Нажмите любую клавишу, чтобы закрыть окно…"
