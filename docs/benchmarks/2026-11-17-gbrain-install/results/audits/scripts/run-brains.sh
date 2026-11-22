#!/usr/bin/env bash
# Audit 1 driver: for each shard with recalled trials, locate (or extract) each recalled trial's state/.gbrain and dump where the
# brain holds the nonce. Archives are extracted one shard at a time into scratch and deleted after.
# Usage: PGLITE_TOOLS=<dir with node_modules/@electric-sql/pglite 0.4.3> run-brains.sh <run dir> <audits dir> <shard>...
# <run dir> is the run/ folder of the raw archive raw-2026-11-17-gbrain-install--run; recall-events.ts must have written
# <audits dir>/scratch/recall-events.json first.
set -euo pipefail
[ "$#" -ge 3 ] || { echo "usage: PGLITE_TOOLS=<dir> run-brains.sh <run dir> <audits dir> <shard>..." >&2; exit 2; }
TOOLS=${PGLITE_TOOLS:?set PGLITE_TOOLS to a folder holding node_modules/@electric-sql/pglite 0.4.3}
BUN=$(command -v bun) || { echo "run-brains.sh: bun is not on PATH" >&2; exit 2; }
RUN=$(cd "$1" && pwd); mkdir -p "$2"; A=$(cd "$2" && pwd); TOOLS=$(cd "$TOOLS" && pwd); shift 2
HERE=$(cd "$(dirname "$0")" && pwd)
S=$A/scratch
OUT=$S/brains.json
mkdir -p "$S/work" "$S/tools"
ln -sfn "$TOOLS/node_modules" "$S/tools/node_modules"
cp "$HERE/brain-dump.ts" "$S/tools/brain-dump.ts"
for shard in "$@"; do
  python3 - "$shard" "$RUN" "$A" <<'EOF'
import json, sys
shard, RUN, A = sys.argv[1:4]
o = [t for t in json.load(open(A + '/scratch/recall-events.json')) if t['shard'] == shard]
plain = shard in ('s01', 's02', 's09')
base = f"{RUN}/dest/{shard}/results/trials" if plain else f"{A}/scratch/x/{shard}/trials"
items = [{'trial_id': t['trial_id'], 'nonce': t['nonce'], 'gbrain_dir': f"{base}/{t['cell']}/gbrain-install/{t['rn']}/state/.gbrain"} for t in o]
json.dump(items, open(f"{A}/scratch/list-{shard}.json", 'w'))
open(f"{A}/scratch/pat-{shard}.txt", 'w').write('\n'.join(f"trials/{t['cell']}/gbrain-install/{t['rn']}/state/.gbrain/*" for t in o) + '\n')
print(shard, len(items), 'plain' if plain else 'archive')
EOF
  [ -s "$S/list-$shard.json" ] && [ "$(cat "$S/list-$shard.json")" != "[]" ] || { echo "$shard: no recalled trials, skipped"; continue; }
  if [ "$shard" != s01 ] && [ "$shard" != s02 ] && [ "$shard" != s09 ]; then
    mkdir -p "$S/x/$shard"
    tar -I zstd -xf "$RUN/dest/$shard/results/trials.tar.zst" -C "$S/x/$shard" --wildcards --exclude='*/.gbrain-ipc-secret' --exclude='*/secret/*' -T "$S/pat-$shard.txt"
    df -h "$S" | tail -1
  fi
  (cd "$S/tools" && env -i PATH="$(dirname "$BUN"):/usr/bin:/bin" HOME="$HOME" "$BUN" brain-dump.ts "$S/list-$shard.json" "$OUT" "$S/work")
  rm -rf -- "$S/x/$shard"
done
df -h "$S" | tail -1
