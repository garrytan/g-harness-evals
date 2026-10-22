#!/usr/bin/env bash
# Called by harnesses/run-trial.sh after the task container exits and before
# the stack is torn down, with the trial's output directory. QM's agent works
# inside a per-scope sandbox container (not in /workspace), so this copies the
# sandbox's workspace into the trial workspace for grading, then removes the
# sandbox container, its home volume and its network. Sandbox names derive
# from the scope, not the trial, so without this removal the next trial would
# inherit this one's files (methodology item 2: fresh sandbox per trial).
set -euo pipefail
out=$1
org=harness-eval
mapfile -t boxes < <(docker ps -aq --filter label=qm.sandbox=1 --filter "label=qm.org=$org")
for c in "${boxes[@]}"; do
  name=$(docker inspect -f '{{.Name}}' "$c" | sed 's#^/##')
  echo "capture: sandbox $name -> $out/workspace" >&2
  docker cp "$c:/root/workspace/." "$out/workspace/" 2>/dev/null || echo "capture: $name has no /root/workspace" >&2
  docker rm -f "$c" >/dev/null
  docker volume rm -f "qm-home-${name#qm-sbx-}" >/dev/null 2>&1 || true
  docker network rm "qm-net-${name#qm-sbx-}" >/dev/null 2>&1 || true
done
[ "${#boxes[@]}" -gt 0 ] || echo "capture: no sandbox container was created" >&2
