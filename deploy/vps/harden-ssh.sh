#!/usr/bin/env bash
###############################################################################
# Закрывает вход по паролю и под root. Запускать ТОЛЬКО после проверки, что
# deploy входит по ключу и у него работает sudo:
#   ssh deploy@<ip> 'sudo -n true && echo ok'
#   scp deploy/vps/harden-ssh.sh deploy@<ip>: && ssh deploy@<ip> 'sudo bash harden-ssh.sh'
###############################################################################
set -euo pipefail

test -s /home/deploy/.ssh/authorized_keys || { echo "!! у deploy нет ключей — остановлено"; exit 1; }

# sshd берёт ПЕРВОЕ значение параметра, файлы в sshd_config.d читаются по
# алфавиту — поэтому 00-, чтобы перебить 50-cloud-init.conf (PasswordAuthentication yes).
cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers deploy
EOF
sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config.d/50-cloud-init.conf 2>/dev/null || true

sshd -t
systemctl reload ssh
sshd -T | grep -Ei '^(permitrootlogin|passwordauthentication|allowusers) '
