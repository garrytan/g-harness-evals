#!/usr/bin/env bash
# internal-task: run one shard of a sharded run on one machine (CREW.md, "Parallelism"). A shard is a set of whole cells of one
# preregistration run at one commit: this script refuses a dirty checkout, builds the harness images the cells need and
# the gbrain sidecar image from this checkout, runs plan (once), preflight and run for exactly those cells under one lease,
# trials sequential, with a prune loop that deletes graded trials' harness caches every five minutes, and writes
# <out>/shard.json naming the shard, the machine, the commit and the image ids for scripts/merge-shards.ts.
#
#   scripts/run-shard.sh --prereg docs/benchmarks/<run>/prereg.json --name <shard> --cells a,b --lease-usd <n>
#                        [--out results/<run-id>] [--embedded] [--gbrain-image <tag>] [--skip-build] [--resume]
#                        [--amendment <commit>]
#
# --resume (after an interruption) keeps <out>/shard.json as the record of the first launch and appends a resume entry to
# its "resumes" list; it refuses a HEAD other than the recorded commit unless --amendment names HEAD (a dated amendment in
# the preregistration, committed before the cells it affects), and it skips preflight when <out>/preflight.log already
# says PREFLIGHT: ok, because the $0.05 preflight lease is closed in the ledger and a closed lease is never reopened
# (HE-PROXY-003). preflight itself is scoped to this shard's cells (--cells), so a shard builds only its own images.
#
# The embedded image build and preflight's embedded probe need OPENAI_API_KEY in this shell for the metering proxy only;
# the run needs ANTHROPIC_API_KEY the same way. No key reaches a container or an image.
set -euo pipefail

prereg="" name="" cells="" lease="" out="" embedded=0 gbrain_image="harness-eval/gbrain:dev" skip_build=0 resume=0 amendment=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prereg) prereg="$2"; shift 2 ;;
    --name) name="$2"; shift 2 ;;
    --cells) cells="$2"; shift 2 ;;
    --lease-usd) lease="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --embedded) embedded=1; shift ;;
    --gbrain-image) gbrain_image="$2"; shift 2 ;;
    --skip-build) skip_build=1; shift ;;
    --resume) resume=1; shift ;;
    --amendment) amendment="$2"; shift 2 ;;
    *) echo "run-shard: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$prereg" ] && [ -n "$name" ] && [ -n "$cells" ] && [ -n "$lease" ] || { echo "run-shard: --prereg, --name, --cells and --lease-usd are required" >&2; exit 2; }
[ -f "$prereg" ] || { echo "run-shard: $prereg does not exist" >&2; exit 2; }
export PATH="$HOME/.bun/bin:$PATH"
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then echo "run-shard: the checkout is not clean; a shard runs the preregistration commit exactly" >&2; git status --short >&2; exit 2; fi
commit=$(git rev-parse HEAD)
run_id=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['run_id'])" "$prereg")
out="${out:-results/$run_id}"
mkdir -p "$out"
harnesses=$(python3 - "$prereg" "$cells" <<'PY'
import json, sys
p = json.load(open(sys.argv[1])); want = set(sys.argv[2].split(','))
ids = {c['id'] for c in p['cells']}
missing = want - ids
if missing: sys.exit("run-shard: cells not in the preregistration: " + ", ".join(sorted(missing)))
print(" ".join(sorted({c['harness'] for c in p['cells'] if c['id'] in want and c['harness'] != 'scripted'})))
PY
)
log() { printf '%s run-shard[%s]: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "$*" | tee -a "$out/run-shard.log" >&2; }
log "commit $commit, cells $cells, harnesses $harnesses, lease $lease, out $out"

if [ "$skip_build" -eq 0 ]; then
  for h in $harnesses; do
    log "building harness-eval/$h:dev from harnesses/$h"
    docker build -q -t "harness-eval/$h:dev" "harnesses/$h" > "$out/build-$h.log" 2>&1 || { tail -20 "$out/build-$h.log" >&2; log "harness image build failed for $h"; exit 2; }
  done
  log "building $gbrain_image from gbrain/ (embedded=$embedded)"
  args=(--tag "$gbrain_image" --out "$out/gbrain-image")
  [ "$embedded" -eq 1 ] && args+=(--embedded)
  scripts/build-gbrain-image.sh "${args[@]}" > "$out/build-gbrain.log" 2>&1 || { tail -20 "$out/build-gbrain.log" >&2; log "gbrain image build failed"; exit 2; }
fi

images=$(for h in $harnesses; do printf '"%s": "%s", ' "harness-eval/$h:dev" "$(docker image inspect -f '{{.Id}}' "harness-eval/$h:dev")"; done; printf '"%s": "%s"' "$gbrain_image" "$(docker image inspect -f '{{.Id}}' "$gbrain_image")")
if [ "$resume" -eq 1 ] && [ -f "$out/shard.json" ]; then
  recorded=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['commit'])" "$out/shard.json")
  if [ "$recorded" != "$commit" ] && [ "$amendment" != "$commit" ]; then
    log "resume refused: shard.json records commit $recorded and HEAD is $commit; a resume loads the recorded commit, or names HEAD with --amendment <commit> under a dated amendment"; exit 2
  fi
  python3 - "$out" "$commit" "$images" "$amendment" <<'PY'
import json, sys, datetime
p = sys.argv[1] + '/shard.json'; s = json.load(open(p))
s.setdefault('resumes', []).append({'at': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'commit': sys.argv[2], 'images': json.loads('{' + sys.argv[3] + '}'), 'amendment': sys.argv[4] or None})
s.pop('exit', None); s.pop('finished_at', None)
json.dump(s, open(p, 'w'), indent=1); open(p, 'a').write('\n')
PY
  log "resume at $commit (recorded $recorded${amendment:+, amendment $amendment})"
else
  printf '{"name": "%s", "machine": "%s", "commit": "%s", "cells": "%s", "lease_usd": %s, "started_at": "%s", "images": {%s}}\n' \
    "$name" "$(hostname)" "$commit" "$cells" "$lease" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$images" > "$out/shard.json"
fi

if [ ! -f "$out/manifest.json" ]; then
  bun runner/run.ts plan --prereg "$prereg" --out "$out" > "$out/plan.log" 2>&1 || { tail -20 "$out/plan.log" >&2; log "plan failed"; exit 2; }
fi
if [ "$resume" -eq 1 ] && grep -q '^PREFLIGHT: ok' "$out/preflight.log" 2>/dev/null; then
  log "preflight skipped: $out/preflight.log already says PREFLIGHT: ok and the preflight lease is closed (a resume reuses the images it passed)"
else
  log "preflight --cells $cells"
  bun runner/run.ts preflight --manifest "$out/manifest.json" --cells "$cells" --gbrain-image "$gbrain_image" > "$out/preflight.log" 2>&1 || { tail -30 "$out/preflight.log" >&2; log "preflight failed"; exit 2; }
  grep -E '^(ADAPTER|GBRAIN|PREFLIGHT):' "$out/preflight.log" | tee -a "$out/run-shard.log" >&2
fi

prune() {
  while sleep 300; do
    [ -f "$out/trials.jsonl" ] || continue
    python3 - "$out" <<'PY' 2>/dev/null || true
import json, os, shutil, sys
out = sys.argv[1]
for line in open(os.path.join(out, 'trials.jsonl')):
    try: rec = json.loads(line)
    except Exception: continue
    d = (rec.get('paths') or {}).get('dir')
    if not d or not os.path.isdir(d): continue
    for rel in ('state/.cache', 'state/hermes/bin', 'state/hermes/cache', 'state/hermes/skills', 'state/hermes/models_dev_cache.json'):
        p = os.path.join(d, rel)
        if os.path.isdir(p): shutil.rmtree(p, ignore_errors=True)
        elif os.path.isfile(p): os.remove(p)
PY
  done
}
prune &
prune_pid=$!
trap 'kill "$prune_pid" 2>/dev/null || true' EXIT

run_args=(run --manifest "$out/manifest.json" --cells "$cells" --lease-usd "$lease" --max-output-tokens 128000 --gbrain-image "$gbrain_image")
[ "$resume" -eq 1 ] || [ -f "$out/trials.jsonl" ] && run_args+=(--resume)
log "run ${run_args[*]}"
set +e
bun runner/run.ts "${run_args[@]}" >> "$out/run.stdout.log" 2>&1
rc=$?
set -e
python3 - "$out" "$rc" <<'PY'
import json, sys, datetime
p = sys.argv[1] + '/shard.json'; s = json.load(open(p)); s['exit'] = int(sys.argv[2]); s['finished_at'] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
json.dump(s, open(p, 'w'), indent=1); open(p, 'a').write('\n')
PY
log "run exited $rc; $(wc -l < "$out/trials.jsonl" 2>/dev/null || echo 0) trial lines"
exit "$rc"
