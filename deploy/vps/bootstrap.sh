#!/usr/bin/env bash
###############################################################################
# Разовая настройка чистого VPS (Ubuntu 24.04) под calc. Запуск от root:
#   scp deploy/vps/bootstrap.sh calc:/root/ && ssh calc 'bash /root/bootstrap.sh'
#
# Идемпотентен: повторный запуск ничего не ломает.
# Вход по SSH НЕ трогает — это отдельный harden-ssh.sh, после проверки,
# что пользователь deploy входит по ключу.
###############################################################################
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

DEPLOY_USER=deploy
APP_DIR=/opt/calc
SWAP_SIZE=2G
# Агент мониторинга Timeweb (zabbix_agentd) — его сервера из /etc/zabbix/zabbix_agentd.conf
ZABBIX_SERVERS="92.53.116.12 92.53.116.111 92.53.116.119"

echo "==> Система"
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get -y -q install ca-certificates curl gnupg ufw unattended-upgrades
systemctl enable --now unattended-upgrades

echo "==> Swap $SWAP_SIZE"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l "$SWAP_SIZE" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
# Память маленькая: в swap уходить только под давлением.
cat > /etc/sysctl.d/90-calc.conf <<'EOF'
vm.swappiness=10
vm.vfs_cache_pressure=50
EOF
sysctl -q --system

echo "==> Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Ротация логов контейнеров по умолчанию — диск 15 ГБ.
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl enable docker
systemctl restart docker

echo "==> Пользователь $DEPLOY_USER"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
# Пароля у deploy нет, root по SSH будет закрыт — sudo без пароля нужен для
# обслуживания. Группа docker и так даёт права уровня root.
echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$DEPLOY_USER"
chmod 440 "/etc/sudoers.d/90-$DEPLOY_USER"
visudo -cq

echo "==> Каталоги $APP_DIR"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR/data" "$APP_DIR/data/backups" "$APP_DIR/data/photos" "$APP_DIR/data/logs"

echo "==> Файрвол"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment ssh
ufw allow 80/tcp comment http
ufw allow 443/tcp comment https
ufw allow 443/udp comment http3
for ip in $ZABBIX_SERVERS; do
  ufw allow from "$ip" to any port 10050 proto tcp comment timeweb-monitoring
done
ufw --force enable
ufw status verbose

echo "==> Готово. Дальше: проверить 'ssh deploy@<ip>' и запустить harden-ssh.sh"
