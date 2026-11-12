#!/usr/bin/env bash
# New Fernlane status incidents, for cron. Prints "## <title>" and the URL per new incident, nothing otherwise.
# Uses the watchers skill's watch_http_json.py. The first run records a baseline and prints nothing.
# State (seen ids, capped at 500): $HERMES_HOME/watcher-state/fernlane-incidents.json; delete it to replay.
# crontab: */15 * * * * /srv/ops/poll-fernlane.sh
set -euo pipefail
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
exec python3 "$HERMES_HOME/skills/devops/watchers/scripts/watch_http_json.py" \
  --name fernlane-incidents \
  --url https://status.fernlane.io/api/v2/incidents.json \
  --items-path data.incidents \
  --id-field incident_id \
  --title-field title \
  --url-field url
