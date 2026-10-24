#!/usr/bin/env bash
# Called by the runner (runner/trial/docker.ts), harnesses/run-trial.sh and
# harnesses/serve-smoke.ts after the task container exits and before the stack
# is torn down, with the trial's output directory. QM's agent works inside a
# per-scope sandbox container (not in /workspace), so this copies each
# sandbox's workspace into the trial workspace for grading, writes a
# scope-keyed manifest of those files, then removes the sandbox container, its
# home volume and its network. Sandbox names derive from the scope, not the
# trial, so without this removal the next trial would inherit this one's files
# (methodology item 2: fresh sandbox per trial). Afterwards it dumps QM's
# Postgres (sessions, runs, tool results including command denials, memory
# revisions) into the trial's logs so probe evidence survives the stack; the
# dump holds per-trial tokens and stays out of the repository with the other
# logs (internal-task, harnesses/qm/README.md).
set -uo pipefail
out=$1
org=harness-eval
logs=${HE_LOGS:-$out/logs}
mkdir -p "$logs"
mapfile -t boxes < <(docker ps -aq --filter label=qm.sandbox=1 --filter "label=qm.org=$org")
manifest="$logs/qm-sandboxes.json"
printf '[' > "$manifest"; first=1
for c in "${boxes[@]}"; do
  name=$(docker inspect -f '{{.Name}}' "$c" | sed 's#^/##')
  labels=$(docker inspect -f '{{json .Config.Labels}}' "$c")
  echo "capture: sandbox $name -> $out/workspace" >&2
  docker cp "$c:/root/workspace/." "$out/workspace/" 2>/dev/null || echo "capture: $name has no /root/workspace" >&2
  # The orchestrator parks a sandbox with docker stop at the end of a turn, so the files are hashed host-side
  # from a fresh copy rather than inside the container.
  tmp=$(mktemp -d)
  files='[]'
  if docker cp "$c:/root/workspace/." "$tmp/" 2>/dev/null; then
    files=$(cd "$tmp" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum | python3 -c 'import json,sys; print(json.dumps([{"path": l[66:].rstrip("\n").removeprefix("./"), "sha256": l[:64]} for l in sys.stdin]))')
  fi
  rm -rf "$tmp"
  [ $first -eq 1 ] || printf ',' >> "$manifest"; first=0
  printf '{"container":"%s","labels":%s,"files":%s}' "$name" "$labels" "$files" >> "$manifest"
  docker rm -f "$c" >/dev/null
  docker volume rm -f "qm-home-${name#qm-sbx-}" >/dev/null 2>&1 || true
  docker network rm "qm-net-${name#qm-sbx-}" >/dev/null 2>&1 || true
done
printf ']\n' >> "$manifest"
[ "${#boxes[@]}" -gt 0 ] || echo "capture: no sandbox container was created" >&2

# The database dump. run-trial.sh and serve-smoke.ts bring the stack up with --abort-on-container-exit, so pg
# may already be stopped; start it again for the dump. COMPOSE_PROJECT_NAME comes from the caller.
compose_file="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/compose.yaml"
if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
  dc() { docker compose -f "$compose_file" -p "$COMPOSE_PROJECT_NAME" "$@"; }
  if dc start pg >/dev/null 2>&1; then
    for _ in $(seq 1 30); do dc exec -T pg pg_isready -U postgres -d qm >/dev/null 2>&1 && break; sleep 1; done
    if dc exec -T pg pg_dump -U postgres qm 2>>"$logs/stderr.log" | gzip > "$logs/qm-db.sql.gz" && [ -s "$logs/qm-db.sql.gz" ]; then
      echo "capture: pg_dump -> $logs/qm-db.sql.gz ($(stat -c %s "$logs/qm-db.sql.gz") bytes)" >&2
    else
      echo "capture: pg_dump failed" >&2
    fi
  else
    echo "capture: pg_dump failed (pg service not started under project $COMPOSE_PROJECT_NAME)" >&2
  fi
else
  echo "capture: pg_dump skipped (COMPOSE_PROJECT_NAME unset)" >&2
fi
exit 0
