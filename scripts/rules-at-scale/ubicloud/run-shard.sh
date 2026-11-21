#!/usr/bin/env bash
# The rules-at-scale Ubicloud lane's run-shard.sh (scripts/rules-at-scale/ubicloud/README.md): scripts/ubicloud/run-shard.sh as it stands
# in this checkout, with --workload rules-at-scale added by lane.py, run with that workload. Every flag of
# scripts/ubicloud/run-shard.sh is taken except --workload, which this lane fixes.
# Use it for --attach and --resume of a rules-at-scale shard, so the pull, the mirror and the teardown keep this workload.
#
#   scripts/rules-at-scale/ubicloud/run-shard.sh <the flags of scripts/ubicloud/run-shard.sh, without --workload>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
for a in "$@"; do
  [ "$a" != -- ] || break
  [ "$a" != --workload ] || { echo "rules-at-scale run-shard.sh: --workload is always rules-at-scale here; drop it (scripts/ubicloud/run-shard.sh runs the other workloads)" >&2; exit 2; }
done
lane=$(python3 "$here/lane.py" "$(cd "$here/../../.." && pwd)") || exit 2
exec bash "$lane/run-shard.sh" --workload rules-at-scale "$@"
