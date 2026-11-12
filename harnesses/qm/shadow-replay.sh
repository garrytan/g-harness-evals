#!/usr/bin/env bash
# internal-task QM side of the shadow replay preflight (scripts/skill-resolver/shadow-replay-check.ts, scripts/skill-resolver/ARMS.md):
#   harnesses/qm/shadow-replay.sh [--until-exhausted] [--out <file.json>]
# Runs the shared check with --gbrain pointing at a thin wrapper that runs the arm image's own resolver
# (/usr/local/bin/gbrain, the binary adapter.sh and the pull tool call) inside one throwaway container of the image with
# no network, so the check proves the binary QM actually ships. The check's scratch directory (its fixture catalog and
# GBRAIN_HOME) is mounted at the same path, and the wrapper passes only HOME, GBRAIN_HOME and GBRAIN_SKILLS_NO_AUTOREBUILD,
# the check's own environment for the binary (the check runs the wrapper with a fixed PATH, so it calls docker by the path
# found here). Prints the check's SHADOW_REPLAY_OK or SHADOW_REPLAY_FAIL line (with
# --until-exhausted, BUDGET_REPLAY_OK or BUDGET_REPLAY_FAIL) and exits with its code: 0 ok, 1 failed (INFRA for the shard),
# 2 usage. QM_IMAGE picks the image (default harness-eval/qm:harn52-arm-catalog, the native and emulated hook arms' build).
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
image=${QM_IMAGE:-harness-eval/qm:harn52-arm-catalog}
work=$(mktemp -d "${TMPDIR:-/tmp}/qm-shadow-replay.XXXXXX")
name="qm-shadow-replay-$$-$RANDOM"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
mkdir -p "$work/tmp" "$work/bin"
docker_bin=$(command -v docker)
docker run -d --rm --name "$name" --network none --user "$(id -u):$(id -g)" --entrypoint sleep -v "$work/tmp:$work/tmp" "$image" infinity >/dev/null
cat > "$work/bin/gbrain" <<EOF
#!/bin/sh
exec $docker_bin exec -i -e HOME="\$HOME" -e GBRAIN_HOME="\$GBRAIN_HOME" -e GBRAIN_SKILLS_NO_AUTOREBUILD="\$GBRAIN_SKILLS_NO_AUTOREBUILD" $name /usr/local/bin/gbrain "\$@"
EOF
chmod 0755 "$work/bin/gbrain"
set +e
TMPDIR="$work/tmp" bun "$root/scripts/skill-resolver/shadow-replay-check.ts" --gbrain "$work/bin/gbrain" --harness qm "$@"
code=$?
set -e
exit "$code"
