#!/usr/bin/env bash
# Run one shard of a sharded run on one machine (CREW.md, "Parallelism"). A shard is a set of whole cells of one
# preregistration run at one commit: this script refuses a dirty checkout, builds the harness images the cells need (with
# QM's sandbox image, harness-eval/qm-sandbox:dev from harnesses/qm/Dockerfile.sandbox, when a qm cell is in the shard; such a
# shard refuses a QM_SANDBOX_IMAGE naming another tag, so the trials run the image it records) and
# the gbrain sidecar image from this checkout, runs plan (once), preflight and run for exactly those cells under one lease,
# trials sequential, with a prune loop that deletes graded trials' harness caches every five minutes, and writes
# <out>/shard.json naming the shard, the machine, the commit and the image ids for scripts/merge-shards.ts.
#
#   scripts/run-shard.sh --prereg docs/benchmarks/<run>/prereg.json --name <shard> --cells a,b --lease-usd <n>
#                        [--out results/<run-id>] [--embedded] [--gbrain-image <tag>] [--skip-build] [--resume]
#                        [--amendment <commit>] [--max-output-tokens <n>] [--sealed-root <dir> --opening-receipt <file>]
#
# --max-output-tokens (default 128000, what Hermes states on every call) is passed to the runner's proxy: a call that states
# more is refused and a call that states none gets it, and the proxy reserves input plus that many output tokens against the
# lease before forwarding, so a call that states the default or none reserves about $1.50 per Sonnet call. Amendment 2 to
# v02-heldout-2026-10 added the flag on the premise that QM's Pi loop states no max_tokens; it states 128000 on every
# call, so a QM shard that passes a smaller figure has every call refused (the v02-heldout smoke at facd960f showed it) and the
# flag only helps a harness that states none or less than the figure. Size the lease for the reservation instead.
#
# --resume (after an interruption) keeps <out>/shard.json as the record of the first launch and appends a resume entry to
# its "resumes" list; it refuses a HEAD other than the recorded commit unless --amendment names HEAD (a dated amendment in
# the preregistration, committed before the cells it affects), and it skips preflight when <out>/preflight.log already
# says PREFLIGHT: ok, because the $0.05 preflight lease is closed in the ledger and a closed lease is never reopened
# (HE-PROXY-003). preflight itself is scoped to this shard's cells (--cells), so a shard builds only its own images.
#
# The embedded image build and preflight's embedded probe need OPENAI_API_KEY in this shell for the metering proxy only;
# the run needs ANTHROPIC_API_KEY the same way. No key reaches a container or an image.
#
# When the preregistration names a top-level gbrain_commit (a full sha), the gbrain image is built at that commit
# (build-gbrain-image.sh --gbrain <sha>) in place of gbrain/pin.json's, which stays the earlier run's pin; preflight and run
# refuse an image that records another commit (HE-GBRAIN-016). The ubicloud wrappers pass the preregistration through, so
# they need no flag for it.
#
# --sealed-root and --opening-receipt (docs/sealed-custody.md; both or neither) run a sealed heldout set from a
# custodian's root outside the checkout. The shard works on its own private copy of the root (in a mktemp -d directory
# under TMPDIR, mode 0700, refused inside a git work tree), made after the checks and removed on every exit bash can trap
# (success, failure, INT and TERM), so the custodian's root is never written by a shard and stays as it was for export; the
# copy's logs/ (the sealed image build log) is kept at <out>/sealed-root-logs/ first. Each launch appends the copy's
# directory to <out>/sealed-root-copy.path, so scripts/sealed/cleanup.ts can remove a copy a SIGKILL or a machine stop left.
# The gbrain image is built from the copy with build-gbrain-image.sh --sealed-root (tagged harness-eval/gbrain:sealed-<run_id> in place of the public
# harness-eval/gbrain:dev), plan, preflight and run get the copy and the receipt, and shard.json records "sealed": true
# and the receipt's sha256. Raw sealed results must stay
# outside the checkout too, so --out is required and refused (HE-SEALED-002) inside this checkout or any other git work
# tree before anything is written there, and a failed step prints its log's path, never its
# last lines (docs/sealed-custody.md, "What may print"). --embedded is refused (not supported for sealed
# sets yet).
set -euo pipefail

prereg="" name="" cells="" lease="" out="" embedded=0 gbrain_image="harness-eval/gbrain:dev" skip_build=0 resume=0 amendment="" max_output_tokens=128000
sealed_root="" opening_receipt=""
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
    --max-output-tokens) max_output_tokens="$2"; shift 2 ;;
    --sealed-root) sealed_root="$2"; shift 2 ;;
    --opening-receipt) opening_receipt="$2"; shift 2 ;;
    *) echo "run-shard: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$prereg" ] && [ -n "$name" ] && [ -n "$cells" ] && [ -n "$lease" ] || { echo "run-shard: --prereg, --name, --cells and --lease-usd are required" >&2; exit 2; }
[ -f "$prereg" ] || { echo "run-shard: $prereg does not exist" >&2; exit 2; }
sealed=()
if [ -n "$sealed_root" ] || [ -n "$opening_receipt" ]; then
  [ -n "$sealed_root" ] && [ -n "$opening_receipt" ] || { echo "run-shard: --sealed-root and --opening-receipt go together; give both or neither" >&2; exit 2; }
  [ -d "$sealed_root" ] || { echo "run-shard: --sealed-root $sealed_root is not a directory" >&2; exit 2; }
  [ -f "$opening_receipt" ] || { echo "run-shard: --opening-receipt $opening_receipt does not exist" >&2; exit 2; }
  [ "$embedded" -eq 0 ] || { echo "run-shard: --embedded is not supported for sealed sets yet (docs/sealed-custody.md)" >&2; exit 2; }
  [ -n "$out" ] || { echo "run-shard: a sealed shard needs --out outside the checkout; the default results/<run_id> is inside it and raw sealed results stay out of every checkout" >&2; exit 2; }
  sealed_root=$(cd "$sealed_root" && pwd -P)
  opening_receipt=$(realpath "$opening_receipt")
  checkout=$(cd "$(dirname "$0")/.." && pwd -P)
  out=$(cd "$checkout" && realpath -m "$out")
  case "$out/" in "$checkout/"*) echo "HE-SEALED-002 run-shard: --out $out is inside the checkout $checkout; raw sealed results stay out of every checkout" >&2; exit 2 ;; esac
  probe=$out
  while [ ! -d "$probe" ]; do probe=$(dirname "$probe"); done
  if git -C "$probe" rev-parse --is-inside-work-tree > /dev/null 2>&1; then echo "HE-SEALED-002 run-shard: --out $out is inside a git work tree; raw sealed results and the copy's logs stay out of every checkout, so nothing was written" >&2; exit 2; fi
  # The sealed image gets its own tag (build-gbrain-image.sh refuses the public one), and preflight and run use that tag.
  [ "$gbrain_image" != harness-eval/gbrain:dev ] || gbrain_image="harness-eval/gbrain:sealed-$(jq -r '.run_id // empty' "$opening_receipt")"
fi
export PATH="$HOME/.bun/bin:$PATH"
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then echo "run-shard: the checkout is not clean; a shard runs the preregistration commit exactly" >&2; git status --short >&2; exit 2; fi
commit=$(git rev-parse HEAD)
run_id=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['run_id'])" "$prereg")
gbrain_commit=$(python3 - "$prereg" <<'PY'
import json, re, sys
c = json.load(open(sys.argv[1])).get('gbrain_commit')
if c is not None and not (isinstance(c, str) and re.fullmatch(r'[0-9a-f]{40}', c)):
    sys.exit("run-shard: HE-GBRAIN-016 the preregistration's gbrain_commit must be a full 40-character sha (got %s)" % json.dumps(c))
print(c or '')
PY
) || exit 2
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
# The last lines of a failed step's log, or for a sealed shard only its path: a sealed step's log can name sealed tasks.
show_tail() { if [ -n "$sealed_root" ]; then log "log: $1 (custody only; a sealed shard never prints its logs)"; else tail -"$2" "$1" >&2; fi; }
log "commit $commit, cells $cells, harnesses $harnesses, lease $lease, max_output_tokens $max_output_tokens, out $out"
[ -z "$gbrain_commit" ] || log "gbrain $gbrain_commit, the preregistration's gbrain_commit (not gbrain/pin.json's)"
qm_sandbox=harness-eval/qm-sandbox:dev
case " $harnesses " in *" qm "*) [ "${QM_SANDBOX_IMAGE:-$qm_sandbox}" = "$qm_sandbox" ] || { log "refused: QM_SANDBOX_IMAGE=$QM_SANDBOX_IMAGE; a shard builds and records $qm_sandbox, the tag harnesses/qm/prepare.sh uses when it is unset, so unset it"; exit 2; } ;; esac
export QM_SANDBOX_IMAGE="$qm_sandbox"

# One exit handler for the prune loop and a sealed shard's copy of the root, installed before the copy is made.
shard_dir="" shard_root="" prune_pid=""
on_exit() {
  [ -z "$prune_pid" ] || kill "$prune_pid" 2>/dev/null || true
  [ -n "$shard_dir" ] && [ -d "$shard_dir" ] || return 0
  [ ! -d "$shard_root/logs" ] || { mkdir -p "$out/sealed-root-logs" && cp -a "$shard_root/logs/." "$out/sealed-root-logs/"; } || true
  rm -rf "$shard_dir"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ -n "$sealed_root" ]; then
  # mktemp makes the parent 0700, so the copy is private while cp -a carries the root's own modes over
  shard_dir=$(mktemp -d "${TMPDIR:-/tmp}/harness-eval-sealed-shard.XXXXXXXX")
  # one line per launch, so scripts/sealed/cleanup.ts can remove a copy that a SIGKILL or a machine stop left behind
  printf '%s\n' "$shard_dir" >> "$out/sealed-root-copy.path"
  if git -C "$shard_dir" rev-parse --is-inside-work-tree > /dev/null 2>&1; then log "HE-SEALED-002 refused: the shard's copy of the sealed root would be under $shard_dir, inside a git work tree; set TMPDIR to a directory outside every checkout"; exit 2; fi
  shard_root="$shard_dir/root"
  # the receipt goes in first, so a copy killed partway is still bound to its run for scripts/sealed/cleanup.ts
  cp "$opening_receipt" "$shard_dir/opening-receipt.json" 2>>"$out/sealed-root-copy.log" || { log "refused: copying the opening receipt failed; its diagnostics are in $out/sealed-root-copy.log (custody only)"; exit 2; }
  # cp names the file it could not copy (a sealed task path), so its diagnostics go to a custody-only log under --out
  cp -a "$sealed_root" "$shard_root" 2>>"$out/sealed-root-copy.log" || { log "refused: copying the sealed root failed; its diagnostics are in $out/sealed-root-copy.log (custody only)"; exit 2; }
  chmod 700 "$shard_root"
  rm -rf "$shard_root/logs"
  sealed=(--sealed-root "$shard_root" --opening-receipt "$opening_receipt")
  log "sealed: this shard reads its own copy of the root at $shard_root (mode 0700, removed on exit); the custodian's root $sealed_root is not written"
fi

if [ "$skip_build" -eq 0 ]; then
  for h in $harnesses; do
    log "building harness-eval/$h:dev from harnesses/$h"
    docker build -q -t "harness-eval/$h:dev" "harnesses/$h" > "$out/build-$h.log" 2>&1 || { show_tail "$out/build-$h.log" 20; log "harness image build failed for $h"; exit 2; }
    [ "$h" = qm ] || continue
    log "building $qm_sandbox from harnesses/qm/Dockerfile.sandbox"
    docker build -q -f harnesses/qm/Dockerfile.sandbox -t "$qm_sandbox" harnesses/qm > "$out/build-qm-sandbox.log" 2>&1 || { show_tail "$out/build-qm-sandbox.log" 20; log "QM sandbox image build failed"; exit 2; }
  done
  log "building $gbrain_image from gbrain/ (embedded=$embedded)"
  args=(--tag "$gbrain_image" --out "$out/gbrain-image")
  [ "$embedded" -eq 1 ] && args+=(--embedded)
  [ -z "$gbrain_commit" ] || args+=(--gbrain "$gbrain_commit")
  [ -z "$shard_root" ] || args+=(--sealed-root "$shard_root")
  scripts/build-gbrain-image.sh "${args[@]}" > "$out/build-gbrain.log" 2>&1 || { show_tail "$out/build-gbrain.log" 20; [ -z "$shard_root" ] || log "the sealed build log is kept at $out/sealed-root-logs/build-gbrain-image.log (custody only)"; log "gbrain image build failed"; exit 2; }
fi

images=""
for tag in $(for h in $harnesses; do echo "harness-eval/$h:dev"; [ "$h" != qm ] || echo "$qm_sandbox"; done) "$gbrain_image"; do
  id=$(docker image inspect -f '{{.Id}}' "$tag" 2>/dev/null) && [ -n "$id" ] || { log "image $tag is missing; build it, or run without --skip-build"; exit 2; }
  images+="${images:+, }\"$tag\": \"$id\""
done
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
  sealed_json=""
  [ -z "$sealed_root" ] || sealed_json=$(printf ', "sealed": true, "opening_receipt_sha256": "%s"' "$(sha256sum "$opening_receipt" | cut -d' ' -f1)")
  printf '{"name": "%s", "machine": "%s", "commit": "%s", "cells": "%s", "lease_usd": %s, "started_at": "%s", "images": {%s}%s}\n' \
    "$name" "$(hostname)" "$commit" "$cells" "$lease" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$images" "$sealed_json" > "$out/shard.json"
fi

if [ ! -f "$out/manifest.json" ]; then
  bun runner/run.ts plan --prereg "$prereg" --out "$out" ${sealed[@]+"${sealed[@]}"} > "$out/plan.log" 2>&1 || { show_tail "$out/plan.log" 20; log "plan failed"; exit 2; }
fi
if [ "$resume" -eq 1 ] && grep -q '^PREFLIGHT: ok' "$out/preflight.log" 2>/dev/null; then
  log "preflight skipped: $out/preflight.log already says PREFLIGHT: ok and the preflight lease is closed (a resume reuses the images it passed)"
else
  log "preflight --cells $cells"
  bun runner/run.ts preflight --manifest "$out/manifest.json" --cells "$cells" --gbrain-image "$gbrain_image" ${sealed[@]+"${sealed[@]}"} > "$out/preflight.log" 2>&1 || { show_tail "$out/preflight.log" 30; log "preflight failed"; exit 2; }
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
    for rel in ('state/.cache', 'state/.local/bin/gbrain', 'state/hermes/bin', 'state/hermes/cache', 'state/hermes/skills', 'state/hermes/models_dev_cache.json'):
        p = os.path.join(d, rel)
        if os.path.isdir(p): shutil.rmtree(p, ignore_errors=True)
        elif os.path.isfile(p): os.remove(p)
PY
  done
}
prune &
prune_pid=$!

run_args=(run --manifest "$out/manifest.json" --cells "$cells" --lease-usd "$lease" --max-output-tokens "$max_output_tokens" --gbrain-image "$gbrain_image" ${sealed[@]+"${sealed[@]}"})
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
