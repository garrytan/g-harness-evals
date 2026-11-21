#!/usr/bin/env bash
# The rules-at-scale Ubicloud lane's fanout.sh (scripts/rules-at-scale/ubicloud/README.md): scripts/ubicloud/fanout.sh as it stands
# in this checkout, with --workload rules-at-scale added by lane.py, run with that workload. Every flag of
# scripts/ubicloud/fanout.sh is taken except --workload, which this lane fixes.
# The manifest is the one scripts/rules-at-scale/plan.ts plan --manifest writes.
#
#   scripts/rules-at-scale/ubicloud/fanout.sh <the flags of scripts/ubicloud/fanout.sh, without --workload>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
for a in "$@"; do
  [ "$a" != -- ] || break
  [ "$a" != --workload ] || { echo "rules-at-scale fanout.sh: --workload is always rules-at-scale here; drop it (scripts/ubicloud/fanout.sh runs the other workloads)" >&2; exit 2; }
done
lane=$(python3 "$here/lane.py" "$(cd "$here/../../.." && pwd)") || exit 2
exec bash "$lane/fanout.sh" --workload rules-at-scale "$@"
