#!/usr/bin/env bash
# Единственное, что может делать ключ GitHub Actions на сервере. В
# ~deploy/.ssh/authorized_keys ключ CI привязан к этому скрипту:
#   command="/opt/calc/deploy/vps/ci-entry.sh",restrict ssh-ed25519 … calc-ci
# Команды:
#   load          — docker load образа из stdin (gzip)
#   deploy <sha>  — deploy.sh для этого коммита
set -euo pipefail

cmd="${SSH_ORIGINAL_COMMAND:-}"
case "$cmd" in
  load)
    exec docker load
    ;;
  deploy\ *)
    sha="${cmd#deploy }"
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "bad sha" >&2; exit 2; }
    exec /opt/calc/deploy/vps/deploy.sh "$sha"
    ;;
  *)
    echo "denied: $cmd" >&2
    exit 1
    ;;
esac
