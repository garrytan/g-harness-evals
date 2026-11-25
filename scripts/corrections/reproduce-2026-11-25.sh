#!/usr/bin/env bash
# Rebuilds docs/corrections/2026-11-25/sensitivity.json: the R126 third-model check of review-real-bugs' judges. It scores
# the committed Gemini 4 Neon labels (docs/corrections/2026-11-25/third-model/) against the judges' rulings and the
# labellers' answers in the run's private raw archive (raw-review-real-bugs-2026-11-stage2-grading, unpacked). Keyless.
#
#   bash scripts/corrections/reproduce-2026-11-25.sh <unpacked archive dir> <scratch dir> [--check]
#
# With --check it rebuilds into a fresh temporary directory, compares that with the committed sensitivity.json and exits 1
# when they differ; it never writes into the scratch dir. Without --check it refuses a scratch dir or output file that is
# the committed one, symlinks included.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
REF="$ROOT/docs/corrections/2026-11-25/sensitivity.json"
A=$(cd "$1" && pwd)
S=$(mkdir -p "$2" && cd "$2" && pwd)
CHECK=${3:-}
run() { env -i PATH="$PATH" HOME="$HOME" bun "$@"; }
cd "$ROOT"
if [ "$CHECK" = --check ]; then
  T=$(mktemp -d)
  trap 'rm -rf "$T"' EXIT
  run scripts/corrections/r126-review-bugs-2026-11-25.ts --archive "$A" --out "$T/sensitivity.json"
  cmp "$T/sensitivity.json" "$REF"
  exit 0
fi
if [ "$S" -ef "$(dirname "$REF")" ] || [ "$S/sensitivity.json" -ef "$REF" ]; then echo "the scratch dir must not be the correction dir, or hold a link to its sensitivity.json" >&2; exit 2; fi
run scripts/corrections/r126-review-bugs-2026-11-25.ts --archive "$A" --out "$S/sensitivity.json"
echo "wrote $S/sensitivity.json"
