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
#                        [--clean-arm-preflight] [--cursor-offline] [--skill-root <dir>]
#
# Cursor shards (harness cursor, harnesses/cursor/README.md): a shard whose cells run the Cursor CLI runs only Cursor cells
# (scripted cells aside) and needs CURSOR_API_KEY in this shell; without it the shard stops with exit 2 before any build.
# First it runs bun scripts/cursor/key-scan.ts selfcheck (CURSOR_API_KEY in the public export's KEY_NAMES and in every
# keyless list; exit 2 on a miss). The key is taken out of this shell's exported environment at once, so the builds, plan
# and preflight never see it, and given to the runner's run step alone (as an environment assignment, never an argument),
# which hands it to the Cursor containers only. After the run, bun scripts/cursor/key-scan.ts scans <out> for the key's
# literal value and prints a verdict only; a hit is exit 5 and a line naming <out>, and nothing under <out> may be
# copied, published or put on a drive until it is cleaned. --cursor-offline is the keyless rehearsal (runner/run.ts run
# --cursor-offline): no key needed, a canary stands in for it, no egress host is admitted, and <out>/cursor-offline.json
# must say ok (exit 4 otherwise).
# --skill-root (internal-task) is required when any of the shard's cells has a skill_arm: the directory holding the frozen skill
# kit (kit/), the musl build of the pinned resolver (gbrain-linux-x64-musl) and the inputs the cells read under .skill-resolver/
# (inputs/). After the harness images, scripts/skill-resolver/shard-kit.ts checks all of it against the preregistration's
# inputs, stages .skill-resolver/, builds each skill-arm cell's image (harness-eval/<h>:skills-kit, QM's arm images; under
# --skip-build only the missing ones, such as the arms a first-cell smoke did not run) and runs the per-shard skill preflight; any failure stops the shard with exit 2 before plan.
# The arm images' ids join the others in shard.json. The runner picks each skill-arm cell's image itself
# (runner/trial/set-t.ts skillArmImage).
#
# --clean-arm-preflight (internal-task, v0.4; CREW.md "Clean no-gstack and no-brain arms") runs scripts/v04/clean-arm-audit.ts
# preflight before plan: no Capy drive mounted and no gstack installed on this machine or inside the shard's harness images.
# It writes <out>/preflight-clean-arm.json (merge-shards.ts keeps it as <shard>.preflight-clean-arm.json) and stops the
# shard with exit 2, before any trial, when anything is found. A shard with gbrain first-wow cells runs it without the flag,
# and also checks each plain-arm image (and for QM the sandbox image) for gbrain (--plain-image). The gbrain-arm images are
# not checked: gbrain's own source names gstack files.
#
# gbrain first-wow cells (slice gbrain-first-wow): after the harness images the shard builds the gbrain-arm images with
# bash harnesses/_first-wow/build.sh <gbrain_commit> <gbrain_version> <harnesses> from the cells' first_wow fields (QM's
# qm-native arm adds harness-eval/claude-code:dev and its gbrain image, the brain host), and records their ids in shard.json.
# A first-wow shard with no gbrain sidecar cell (no gbrain field) and no sealed root skips the gbrain sidecar image build;
# the runner checks that image only for gbrain cells. Other shards build it as before.
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
# the run needs ANTHROPIC_API_KEY the same way, and a Particle or OpenRouter cell PARTICLE_API_KEY or OPENROUTER_API_KEY.
# No key reaches a container or an image, except that a Cursor shard's containers get CURSOR_API_KEY (above); no image
# ever does.
#
# When the preregistration names a top-level gbrain_commit (a full sha), the gbrain image is built at that commit
# (build-gbrain-image.sh --gbrain <sha>) in place of gbrain/pin.json's, which stays the earlier run's pin; preflight and run
# refuse an image that records another commit (HE-GBRAIN-016). The ubicloud wrappers pass the preregistration through, so
# they need no flag for it.
#
# When the shard's gbrain cells are dev cells of a task set with its own world (tasks/multiuser/<task_set>/world/world.json,
# docs/tasks.md "A set with its own world"), the gbrain image is built with build-gbrain-image.sh --world <that file> and
# tagged harness-eval/gbrain:world-<first 12 of its sha256> in place of harness-eval/gbrain:dev, and preflight and run get
# that tag, the one the runner expects for those cells. gbrain cells that read different worlds are refused (HE-GBRAIN-002).
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
sealed_root="" opening_receipt="" clean_arm=0 cursor_offline=0 skill_root=""
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
    --clean-arm-preflight) clean_arm=1; shift ;;
    --cursor-offline) cursor_offline=1; shift ;;
    --skill-root) skill_root="$2"; shift 2 ;;
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
shard_resume=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("shard_resume", ""))' "$prereg")
if [ "$shard_resume" = refused ] && { [ "$resume" -eq 1 ] || [ -f "$out/shard.json" ] || [ -s "$out/trials.jsonl" ]; }; then
  echo "run-shard: run $run_id's preregistration sets shard_resume refused: an interrupted shard ends its cell as incomplete and is never resumed or rerun into $out" >&2; exit 2
fi
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
# Cursor: the key list check, the key's presence, and the key out of the exported environment until the run step.
cursor=0
case " $harnesses " in *" cursor "*) cursor=1 ;; esac
if [ "$cursor" -eq 1 ]; then
  [ "$harnesses" = cursor ] || { log "refused: harness cursor calls Cursor's backend through its egress allowlist and the other harnesses here ($harnesses) call the metering proxy; one runner invocation does one or the other. fix: shard the Cursor cells on their own"; exit 2; }
  env -u CURSOR_API_KEY bun scripts/cursor/key-scan.ts selfcheck 2>&1 | tee -a "$out/run-shard.log" >&2; [ "${PIPESTATUS[0]}" -eq 0 ] || { log "refused: the key-list selfcheck failed (above); a list that misses CURSOR_API_KEY could carry it into a keyless step"; exit 2; }
  if [ "$cursor_offline" -eq 1 ]; then
    unset CURSOR_API_KEY
    log "cursor: --cursor-offline, the keyless rehearsal: a canary stands in for CURSOR_API_KEY and the egress allowlist admits no host"
  else
    [ -n "${CURSOR_API_KEY:+x}" ] || { log "refused: cells $cells run the Cursor CLI and CURSOR_API_KEY is not set in this shell; nothing was built or run. fix: run this from the machine that holds the key, or pass --cursor-offline for the keyless rehearsal"; exit 2; }
    export -n CURSOR_API_KEY
    log "cursor: CURSOR_API_KEY is set; it goes to the runner's run step only, which passes it by name to the Cursor containers"
  fi
elif [ "$cursor_offline" -eq 1 ]; then
  log "refused: --cursor-offline rehearses Cursor cells, and this shard has none"; exit 2
fi
# The last lines of a failed step's log, or for a sealed shard only its path: a sealed step's log can name sealed tasks.
show_tail() { if [ -n "$sealed_root" ]; then log "log: $1 (custody only; a sealed shard never prints its logs)"; else tail -"$2" "$1" >&2; fi; }
log "commit $commit, cells $cells, harnesses $harnesses, lease $lease, max_output_tokens $max_output_tokens, out $out"
[ -z "$gbrain_commit" ] || log "gbrain $gbrain_commit, the preregistration's gbrain_commit (not gbrain/pin.json's)"
# The gbrain cells of a dev split whose task set carries its own world (tasks/multiuser/<task_set>/world/world.json, v0.4)
# read that world, as runner/run.ts setWorldPath decides, so their image is built with build-gbrain-image.sh --world and
# tagged harness-eval/gbrain:world-<first 12 of its sha256>, the tag the runner expects for them, unless --gbrain-image names one.
set_world=$(python3 - "$prereg" "$cells" <<'PY'
import hashlib, json, os, sys
p = json.load(open(sys.argv[1])); want = set(sys.argv[2].split(','))
paths = set()
for c in p['cells']:
    if c['id'] not in want or not c.get('gbrain'): continue
    s = c.get('task_set') or 'v0.1'
    w = os.path.join('tasks', 'multiuser', s, 'world', 'world.json')
    paths.add(w if c.get('split') == 'dev' and s != 'v0.1' and os.path.isfile(w) else '')
if len(paths) > 1: sys.exit('run-shard: HE-GBRAIN-002 this shard\'s gbrain cells read different worlds (%s); one gbrain image holds one world\'s brains' % ', '.join(sorted(x or 'the run world' for x in paths)))
w = paths.pop() if paths else ''
print(w and w + ' harness-eval/gbrain:world-' + hashlib.sha256(open(w, 'rb').read()).hexdigest()[:12])
PY
) || exit 2
world_file=${set_world% *}
if [ -n "$world_file" ]; then
  [ "$gbrain_image" != harness-eval/gbrain:dev ] || gbrain_image=${set_world#* }
  log "gbrain cells read the set world $world_file; gbrain image $gbrain_image"
fi
# gbrain first-wow cells (runner/trial/first-wow*.ts): the images their trials run. A gbrain arm runs
# harness-eval/<harness>-gbrain:<commit 12>, built from harness-eval/<harness>:dev by harnesses/_first-wow/build.sh with the
# cell's gbrain_commit and gbrain_version; QM's qm-native arm hosts its brain in the Claude Code one, so it needs
# harness-eval/claude-code:dev and that image too. The plain arm runs harness-eval/<harness>:dev (QM: and the sandbox image),
# which the clean-arm preflight below checks for gbrain as well as gstack. Lines: any first-wow cell (1 or 0), whether the
# gbrain sidecar image is built (0 only for a first-wow shard with no gbrain cell), extra base harnesses, first-wow image tags, plain-arm images, then one "<commit> <version> <harness>..."
# line per gbrain build.
mapfile -t first_wow < <(python3 - "$prereg" "$cells" <<'PY'
import json, re, sys
p = json.load(open(sys.argv[1])); want = set(sys.argv[2].split(','))
cs = [c for c in p['cells'] if c['id'] in want]
fw = [c for c in cs if c.get('slice') == 'gbrain-first-wow']
extra, tags, plain, builds = set(), [], [], {}
for c in fw:
    f, h = c.get('first_wow') or {}, c['harness']
    commit, version = f.get('gbrain_commit'), f.get('gbrain_version')
    if commit is not None and not (isinstance(commit, str) and re.fullmatch(r'[0-9a-f]{40}', commit) and isinstance(version, str) and re.fullmatch(r'\d+(\.\d+){2,3}', version)):
        sys.exit('run-shard: cell %s: first_wow needs a 40-character gbrain_commit and a gbrain_version (got %s, %s)' % (c['id'], json.dumps(commit), json.dumps(version)))
    if f.get('arm') == 'plain' or h == 'qm':
        tags.append(f.get('image') or 'harness-eval/%s:dev' % h)
        if f.get('arm') == 'plain': plain += [tags[-1]] + (['harness-eval/qm-sandbox:dev'] if h == 'qm' else [])
    if commit is None: continue
    built = 'claude-code' if h == 'qm' else h
    if h == 'qm': extra.add('claude-code')
    if f.get('image') and h != 'qm': tags.append(f['image']); continue
    builds.setdefault((commit, version), set()).add(built)
    tags.append('harness-eval/%s-gbrain:%s' % (built, commit[:12]))
uniq = lambda xs: ' '.join(dict.fromkeys(xs))
print(1 if fw else 0); print(0 if fw and not any(c.get('gbrain') for c in cs) else 1)
print(uniq(sorted(extra))); print(uniq(tags)); print(uniq(plain))
for (commit, version), hs in sorted(builds.items()): print(commit, version, ' '.join(sorted(hs)))
PY
) && [ ${#first_wow[@]} -ge 5 ] || exit 2
fw_extra=${first_wow[2]} fw_images=${first_wow[3]} fw_plain=${first_wow[4]}
fw_builds=("${first_wow[@]:5}")
gbrain_sidecar=${first_wow[1]}
[ -z "$sealed_root" ] || gbrain_sidecar=1
if [ "${first_wow[0]}" = 1 ]; then
  log "first-wow cells: images ${fw_images:-none}${fw_extra:+, base harnesses $fw_extra for the brain host}; plain-arm images ${fw_plain:-none}"
  [ "$clean_arm" -eq 1 ] || log "clean-arm preflight: on, as every shard with first-wow cells runs it (the plain arm has no Capy drive, gstack or gbrain)"
  clean_arm=1
fi
base_harnesses=$(printf '%s\n' $harnesses $fw_extra | sort -u | tr '\n' ' ')
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
  for h in $base_harnesses; do
    log "building harness-eval/$h:dev from harnesses/$h"
    docker build -q -t "harness-eval/$h:dev" "harnesses/$h" > "$out/build-$h.log" 2>&1 || { show_tail "$out/build-$h.log" 20; log "harness image build failed for $h"; exit 2; }
    [ "$h" = qm ] || continue
    log "building $qm_sandbox from harnesses/qm/Dockerfile.sandbox"
    docker build -q -f harnesses/qm/Dockerfile.sandbox -t "$qm_sandbox" harnesses/qm > "$out/build-qm-sandbox.log" 2>&1 || { show_tail "$out/build-qm-sandbox.log" 20; log "QM sandbox image build failed"; exit 2; }
  done
  for b in ${fw_builds[@]+"${fw_builds[@]}"}; do
    log "building first-wow images: bash harnesses/_first-wow/build.sh $b"
    bash harnesses/_first-wow/build.sh $b >> "$out/build-first-wow.log" 2>&1 || { show_tail "$out/build-first-wow.log" 20; log "first-wow image build failed ($b)"; exit 2; }
  done
  if [ "$gbrain_sidecar" -eq 1 ]; then
    log "building $gbrain_image from gbrain/ (embedded=$embedded)"
    args=(--tag "$gbrain_image" --out "$out/gbrain-image")
    [ "$embedded" -eq 1 ] && args+=(--embedded)
    [ -z "$gbrain_commit" ] || args+=(--gbrain "$gbrain_commit")
    [ -z "$shard_root" ] || args+=(--sealed-root "$shard_root")
    [ -z "$world_file" ] || args+=(--world "$world_file")
    scripts/build-gbrain-image.sh "${args[@]}" > "$out/build-gbrain.log" 2>&1 || { show_tail "$out/build-gbrain.log" 20; [ -z "$shard_root" ] || log "the sealed build log is kept at $out/sealed-root-logs/build-gbrain-image.log (custody only)"; log "gbrain image build failed"; exit 2; }
  else
    log "first-wow shard with no gbrain sidecar cell; $gbrain_image is not built"
  fi
fi

skill_images=""
if python3 -c "import json,sys; w=set(sys.argv[2].split(',')); sys.exit(0 if any(c['id'] in w and c.get('skill_arm') for c in json.load(open(sys.argv[1]))['cells']) else 1)" "$prereg" "$cells"; then
  skill_args=(--prereg "$prereg" --cells "$cells" --out "$out")
  [ -z "$skill_root" ] || skill_args+=(--skill-root "$skill_root")
  [ "$skip_build" -eq 0 ] || skill_args+=(--skip-build)
  log "skill kit: scripts/skill-resolver/shard-kit.ts (inputs, arm images, skill preflight)"
  bun scripts/skill-resolver/shard-kit.ts "${skill_args[@]}" > "$out/skill-kit.log" 2>&1 || { show_tail "$out/skill-kit.log" 30; log "skill kit or skill preflight failed ($out/skill-kit.log); no trial ran"; exit 2; }
  grep '^SKILL_KIT' "$out/skill-kit.log" | tee -a "$out/run-shard.log" >&2
  skill_images=$(python3 -c "import json,sys; print(' '.join(json.load(open(sys.argv[1])).get('images') or {}))" "$out/skill-kit.json")
fi

images="" seen=" "
sidecar_image=""
[ "$gbrain_sidecar" -eq 0 ] || sidecar_image=$gbrain_image
for tag in $(for h in $base_harnesses; do echo "harness-eval/$h:dev"; [ "$h" != qm ] || echo "$qm_sandbox"; done) $sidecar_image $fw_images $skill_images; do
  case "$seen" in *" $tag "*) continue ;; esac
  seen+="$tag "
  id=$(docker image inspect -f '{{.Id}}' "$tag" 2>/dev/null) && [ -n "$id" ] || { log "image $tag is missing; build it, or run without --skip-build"; exit 2; }
  images+="${images:+, }\"$tag\": \"$id\""
done
# first-wow gbrain-arm images: each image's /opt/first-wow/image.json (gbrain commit, bun.lock and dependency-tree sha256) and
# its image id, one line per image, so shards built hours apart can be shown to run the same gbrain dependencies.
if [ -n "$fw_images" ]; then
  : > "$out/first-wow-images.ndjson"
  for tag in $fw_images; do
    case "$tag" in *-gbrain:*) ;; *) continue ;; esac
    rec=$(docker run --rm --entrypoint cat "$tag" /opt/first-wow/image.json 2>/dev/null) && [ -n "$rec" ] || { log "image $tag has no /opt/first-wow/image.json; rebuild it with harnesses/_first-wow/build.sh"; exit 2; }
    printf '{"tag": "%s", "id": "%s", "image": %s}\n' "$tag" "$(docker image inspect -f '{{.Id}}' "$tag")" "$rec" >> "$out/first-wow-images.ndjson"
    log "first-wow image $tag: $rec"
  done
fi
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

if [ "$clean_arm" -eq 1 ] && [ -n "$harnesses" ]; then
  clean_args=()
  for h in $harnesses; do clean_args+=(--image "harness-eval/$h:dev"); done
  for i in $fw_plain; do clean_args+=(--plain-image "$i"); done
  log "clean-arm preflight: no Capy drive and no gstack on this machine or in harness images $harnesses${fw_plain:+, and no gbrain in plain-arm images $fw_plain}"
  bun scripts/v04/clean-arm-audit.ts preflight --out "$out/preflight-clean-arm.json" "${clean_args[@]}" 2>&1 | tee -a "$out/run-shard.log" >&2 || { rc=${PIPESTATUS[0]}; if [ "$rc" -eq 1 ]; then log "clean-arm preflight failed: gstack or a Capy drive is reachable, or a plain-arm image holds gbrain ($out/preflight-clean-arm.json); the shard does not start"; else log "clean-arm preflight could not run (exit $rc; see run-shard.log): the arms cannot be shown clean; the shard does not start"; fi; exit 2; }
fi

if [ ! -f "$out/manifest.json" ]; then
  bun runner/run.ts plan --prereg "$prereg" --out "$out" ${sealed[@]+"${sealed[@]}"} > "$out/plan.log" 2>&1 || { show_tail "$out/plan.log" 20; log "plan failed"; exit 2; }
fi
if [ "$resume" -eq 1 ] && grep -q '^PREFLIGHT: ok' "$out/preflight.log" 2>/dev/null; then
  log "preflight skipped: $out/preflight.log already says PREFLIGHT: ok and the preflight lease is closed (a resume reuses the images it passed)"
else
  log "preflight --cells $cells"
  bun runner/run.ts preflight --manifest "$out/manifest.json" --cells "$cells" --gbrain-image "$gbrain_image" ${sealed[@]+"${sealed[@]}"} > "$out/preflight.log" 2>&1 || { show_tail "$out/preflight.log" 30; log "preflight failed"; exit 2; }
  grep -E '^(ADAPTER|GBRAIN|FIRSTWOW|PREFLIGHT):' "$out/preflight.log" | tee -a "$out/run-shard.log" >&2
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
[ "$cursor_offline" -eq 0 ] || run_args+=(--cursor-offline)
log "run ${run_args[*]}"
set +e
if [ "$cursor" -eq 1 ] && [ "$cursor_offline" -eq 0 ]; then
  CURSOR_API_KEY=$CURSOR_API_KEY bun runner/run.ts "${run_args[@]}" >> "$out/run.stdout.log" 2>&1
else
  bun runner/run.ts "${run_args[@]}" >> "$out/run.stdout.log" 2>&1
fi
rc=$?
if [ "$cursor" -eq 1 ] && [ "$cursor_offline" -eq 0 ]; then
  CURSOR_API_KEY=$CURSOR_API_KEY bun scripts/cursor/key-scan.ts "$out" 2>&1 | tee -a "$out/run-shard.log" >&2
  scan_rc=${PIPESTATUS[0]}
  if [ "$scan_rc" -ne 0 ]; then log "HE-CURSOR-003 the key scan of $out exited $scan_rc (1: the CURSOR_API_KEY value is in a file there); keep $out off every copy, publication and drive until it is cleaned"; rc=5; fi
elif [ "$cursor_offline" -eq 1 ] && [ "$rc" -eq 0 ]; then
  python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get("ok") else 1)' "$out/cursor-offline.json" 2>/dev/null || { log "cursor offline rehearsal: $out/cursor-offline.json is missing or not ok"; rc=4; }
fi
set -e
python3 - "$out" "$rc" <<'PY'
import json, sys, datetime
p = sys.argv[1] + '/shard.json'; s = json.load(open(p)); s['exit'] = int(sys.argv[2]); s['finished_at'] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
json.dump(s, open(p, 'w'), indent=1); open(p, 'a').write('\n')
PY
log "run exited $rc; $(wc -l < "$out/trials.jsonl" 2>/dev/null || echo 0) trial lines"
exit "$rc"
