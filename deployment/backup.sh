#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
exec 9>.deployment.lock
flock -w 300 9 || { echo 'LastPeek deployment lock unavailable' >&2; exit 1; }

compose=(docker compose -p "${COMPOSE_PROJECT_NAME:-lastpeek}" --env-file .env --env-file images.env -f compose.yaml)
if [[ -f compose.override.yaml ]]; then
  compose+=(-f compose.override.yaml)
elif [[ -f compose.override.yml ]]; then
  compose+=(-f compose.override.yml)
fi
compose+=(-f compose.blue-green.yaml --profile blue-green)
unset BLUE_IMAGE GREEN_IMAGE MAINTENANCE_IMAGE

case "$(cat routing/active.conf)" in
  'upstream lastpeek { server blue:3000; }') active=blue ;;
  'upstream lastpeek { server green:3000; }') active=green ;;
  *) echo 'Unrecognised active LastPeek slot' >&2; exit 1 ;;
esac
running=()
for service in "$active" maintenance; do
  ids=$("${compose[@]}" ps --status running -q "$service")
  if [[ -n "$ids" ]]; then running+=("$service"); fi
done
# Resolve the actual private volume; never substitute an empty/wrong volume.
container=$("${compose[@]}" ps --all -q "$active")
[[ -n "$container" ]] || { echo 'Active app container is missing' >&2; exit 1; }
media=$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/app/data/media"}}{{.Name}}{{end}}{{end}}')
[[ -n "$media" ]] || { echo 'Private media must be a named volume' >&2; exit 1; }

resume() {
  status=$?
  trap - EXIT INT TERM
  resumed_app=0
  # Resume independently: one failed startup must not skip the other service.
  for service in "${running[@]}"; do
    if ! "${compose[@]}" up -d --no-deps --no-build --wait --wait-timeout 180 "$service"; then
      echo "Failed to resume LastPeek $service" >&2
      if (( status == 0 )); then status=1; fi
    elif [[ "$service" == "$active" ]]; then
      resumed_app=1
    fi
  done
  # Docker can assign a different address after stop/start; refresh nginx's DNS.
  if (( resumed_app )); then
    if ! { "${compose[@]}" exec -T proxy nginx -c /etc/lastpeek/nginx.conf -s reload &&
      "${compose[@]}" exec -T "$active" node --input-type=module -e '
        for (let attempt = 0; attempt < 20; attempt++) {
          try {
            const response = await fetch("http://proxy:3000/health", {signal: AbortSignal.timeout(3000)});
            if (response.ok) process.exit(0);
          } catch {}
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        process.exit(1);
      '; }; then
      echo 'Failed to restore LastPeek proxy routing' >&2
      if (( status == 0 )); then status=1; fi
    fi
  fi
  exit "$status"
}
trap resume EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"${compose[@]}" stop blue green maintenance

mkdir -p "$HOME/lastpeek-backups"
partial=$(mktemp -d "$HOME/lastpeek-backups/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX.partial")
"${compose[@]}" exec -T db pg_dump -U lastpeek -d lastpeek -Fc >"$partial/database.dump"
docker run --rm --network none --user 0:0 \
  --mount "type=volume,source=$media,target=/media,readonly,volume-nocopy" postgres:16-bookworm \
  tar -C /media -czf - . >"$partial/media.tar.gz"
"${compose[@]}" images --format json >"$partial/images.json"
for file in compose.yaml compose.override.yaml compose.override.yml compose.blue-green.yaml \
  .web-template.json images.env routing/active.conf routing/nginx.conf update.py backup.sh; do
  if [[ -f "$file" ]]; then cp --parents -- "$file" "$partial/"; fi
done
(
  cd "$partial"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS
)
destination=${partial%.partial}
mv -- "$partial" "$destination"
echo "LastPeek backup saved to $destination (local disk only)"
