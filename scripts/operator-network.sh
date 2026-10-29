#!/usr/bin/env bash
# Optional orb-only enrollment. Never print credentials or snapshot node state.
set -euo pipefail
[[ -n ${LASTPEEK_TS_OAUTH_SECRET:-} ]] || exit 0
command -v tailscale >/dev/null || { echo 'Run .agents/setup to install Tailscale.' >&2; exit 1; }
# E2B's only uplink is link-local. Give Tailscale's network detector a usable
# address without changing the default route or assigning a routable host address.
if ! ip link show lastpeek-uplink >/dev/null 2>&1; then
  sudo -n ip link add lastpeek-uplink type dummy
  sudo -n ip address add 192.0.2.254/32 dev lastpeek-uplink
fi
sudo -n ip link set lastpeek-uplink up
socket=/run/lastpeek-tailscale.sock
amp orb service start lastpeek-network --command 'exec sudo -n /usr/sbin/tailscaled --state=mem: --socket=/run/lastpeek-tailscale.sock --tun=lastpeek-ts' >/dev/null
for attempt in {1..20}; do
  [[ -S $socket ]] && break
  sleep 0.2
done
if sudo -n tailscale --socket="$socket" status --json 2>/dev/null | node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;process.exit(JSON.parse(s).BackendState==="Running"?0:1)'; then
  sudo -n tailscale --socket="$socket" set --netfilter-mode=off --shields-up >/dev/null
  exit 0
fi
key_file=$(mktemp)
chmod 600 "$key_file"
trap 'rm -f "$key_file"' EXIT
printf '%s?ephemeral=true&preauthorized=true' "$LASTPEEK_TS_OAUTH_SECRET" > "$key_file"
sudo -n tailscale --socket="$socket" up --timeout=8s --auth-key="file:$key_file" \
  --advertise-tags=tag:lastpeek-operator --accept-dns=false --accept-routes=false \
  --netfilter-mode=off --shields-up \
  --hostname="lastpeek-orb-$(cat /proc/sys/kernel/random/uuid | cut -c1-8)" >/dev/null 2>&1 || {
    echo 'Tailscale enrollment failed; check OAuth scope, tag, approval and network.' >&2
    exit 1
  }
echo 'Restricted LastPeek operator network connected.'
