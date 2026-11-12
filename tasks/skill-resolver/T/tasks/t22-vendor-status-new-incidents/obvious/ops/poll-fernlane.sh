#!/usr/bin/env bash
# Prints Fernlane status incidents we have not seen before; prints nothing otherwise.
# crontab: */15 * * * * /srv/ops/poll-fernlane.sh
set -euo pipefail

URL="https://status.fernlane.io/api/v2/incidents.json"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/fernlane"
SEEN="$STATE_DIR/seen-ids.txt"
mkdir -p "$STATE_DIR"

json=$(curl -fsS --max-time 20 "$URL")

first_run=0
[[ -f "$SEEN" ]] || { first_run=1; touch "$SEEN"; }

new=$(jq -r '.data.incidents[] | [.incident_id, .title, .url] | @tsv' <<<"$json" |
  while IFS=$'\t' read -r id title url; do
    if ! grep -qxF "$id" "$SEEN"; then
      echo "$id" >> "$SEEN"
      [[ $first_run -eq 1 ]] || printf 'New Fernlane incident: %s\n%s\n\n' "$title" "$url"
    fi
  done)

# keep the seen list from growing forever
tail -n 1000 "$SEEN" > "$SEEN.tmp" && mv "$SEEN.tmp" "$SEEN"

[[ -z "$new" ]] || printf '%s\n' "$new"
