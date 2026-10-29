#!/usr/bin/env bash
# Run once as root on the official Pi, with reviewed source and two public keys.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
[[ $# == 3 ]] || { echo 'Usage: install-operator.sh gateway.py read.pub flags.pub' >&2; exit 1; }
gateway=$(realpath "$1")
read_key=$(cat "$2")
flags_key=$(cat "$3")
[[ $read_key == ssh-ed25519\ * && $flags_key == ssh-ed25519\ * && $read_key != "$flags_key" ]]
[[ $read_key != *$'\n'* && $flags_key != *$'\n'* ]]
id lastpeek-ops >/dev/null 2>&1 || useradd --system --home-dir /var/empty/lastpeek-ops --shell /bin/sh lastpeek-ops
install -d -o root -g root -m 755 /var/empty/lastpeek-ops /etc/lastpeek-operator /run/sshd
install -o root -g root -m 755 "$gateway" /usr/local/sbin/lastpeek-operator
printf 'restrict,command="sudo -n /usr/local/sbin/lastpeek-operator read" %s\nrestrict,command="sudo -n /usr/local/sbin/lastpeek-operator flags" %s\n' "$read_key" "$flags_key" > /etc/lastpeek-operator/authorized_keys
chmod 644 /etc/lastpeek-operator/authorized_keys
cat > /etc/sudoers.d/lastpeek-operator <<'SUDO'
Defaults:lastpeek-ops env_keep += "SSH_ORIGINAL_COMMAND"
lastpeek-ops ALL=(root) NOPASSWD: /usr/local/sbin/lastpeek-operator read, /usr/local/sbin/lastpeek-operator flags
SUDO
chmod 440 /etc/sudoers.d/lastpeek-operator
visudo -cf /etc/sudoers.d/lastpeek-operator
if [[ ! -f /etc/lastpeek-operator/host_key ]]; then
  ssh-keygen -q -t ed25519 -N '' -f /etc/lastpeek-operator/host_key </dev/null
fi
cat > /etc/lastpeek-operator/sshd_config <<'SSHD'
Port 2222
ListenAddress 100.124.28.78
HostKey /etc/lastpeek-operator/host_key
PidFile /run/lastpeek-operator-sshd.pid
AuthorizedKeysFile /etc/lastpeek-operator/authorized_keys
AllowUsers lastpeek-ops
PubkeyAuthentication yes
AuthenticationMethods publickey
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
PermitRootLogin no
PermitUserEnvironment no
DisableForwarding yes
PermitTTY no
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 20
StrictModes yes
SSHD
/usr/sbin/sshd -t -f /etc/lastpeek-operator/sshd_config
cat > /etc/systemd/system/lastpeek-operator.service <<'UNIT'
[Unit]
Description=Restricted LastPeek operator SSH over Tailscale
After=network-online.target tailscaled.service
Wants=network-online.target
[Service]
ExecStart=/usr/sbin/sshd -D -e -f /etc/lastpeek-operator/sshd_config
Restart=on-failure
RestartSec=10
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now lastpeek-operator.service
echo 'Pinned host public key:'
cat /etc/lastpeek-operator/host_key.pub
