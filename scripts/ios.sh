#!/usr/bin/env bash
# Подготовить iOS-проект: синхронизация Capacitor + генерация App.xcodeproj
# из ios/App/project.yml. Затем: open ios/App/App.xcodeproj → Run.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v xcodegen >/dev/null || brew install xcodegen
pnpm exec cap sync ios
(cd ios/App && xcodegen generate --quiet)
echo "✓ ios/App/App.xcodeproj готов"
