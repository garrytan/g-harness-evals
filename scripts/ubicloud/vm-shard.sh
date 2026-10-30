#!/usr/bin/env bash
# The VM side of the Ubicloud shard lane (docs/ubicloud.md). scripts/ubicloud/run-shard.sh uploads this file to the VM
# and starts it detached, so a dropped SSH session or a sleeping Capy machine does not stop the shard. It pins the synced
# checkout at the commit, installs dependencies, runs the one-trial smoke under a scratch preregistration and ledger the
# way the Capy shards did (one dev task, one repetition, its own lease, never counted), then the repository's own
# scripts/run-shard.sh for the shard under its lease with --skip-build, and writes ~/shard/exit with the exit code.
#
#   vm-shard.sh --commit <sha> --prereg <path on the VM> --name <shard> --cells a,b --lease-usd <n>
#               [--smoke-lease-usd <n>] [--smoke-task <task id>] [--no-smoke] [--resume] [--amendment <sha>]
#               [--embedded] [--gbrain-image <tag>] [--sealed-root <path on the VM> --opening-receipt <path on the VM>]
#               [--workload harness|gstack-laneb] [-- <extra run-shard.sh arguments>]
#
# --workload gstack-laneb (internal-task, docs/gstack-laneb.md): the smoke is the bridge's keyless smoke
# (scripts/gstack-laneb/smoke.sh against the pinned fake upstream, no spend; it installs Harbor at its pin) and the shard
# runs scripts/gstack-laneb/vm-run.sh with the Lane B checkout and arms run-shard.sh uploaded to ~/laneb and the shard's
# lease. Sealed flags are refused for this workload (run-shard.sh refuses them first). The smoke's results go to ~/shard/smoke/results and the shard's to ~/shard/results.
#
# --sealed-root and --opening-receipt (internal-task, docs/sealed-custody.md) name the custodian's sealed root and receipt that
# scripts/ubicloud/run-shard.sh uploaded to ~/sealed, outside the checkout; both go to the counted scripts/run-shard.sh call
# only. The smoke's dev-only preregistration has no sealed cell, so it runs as a public run: without the sealed flags and
# with the public image harness-eval/gbrain:dev (the runner refuses a sealed image for a run with no sealed root,
# HE-SEALED-005). The counted run then builds the receipt-bound image harness-eval/gbrain:sealed-<run_id> from its own copy
# of the root (no --skip-build; the harness images it rebuilds are cached from the smoke's build).
#
# --smoke-lease-usd defaults to what smoke-lease.ts derives from the proxy's per-call reservation for the shard's cells (the
# output cap at the model's list price plus an input allowance, doubled, at least $1): a lease below one reservation refuses
# the smoke's first call. Pass a figure to override it.
#
# Phase timestamps go to ~/shard/phases.json (epoch seconds), the smoke's results to ~/shard/smoke/results and the shard's
# to ~/shard/results. The model keys are in this process's environment only (read from ~/.ubirun-env by the launcher,
# which deletes the file before this script starts); nothing here prints them, and run-shard.sh hands them only to the
# metering proxy. Exit codes: run-shard.sh's for the shard; 3 for a checkout or install failure; 4 when the smoke did not
# end with every trial completed.
set -uo pipefail
export PATH="$HOME/.bun/bin:$PATH"
cd "$HOME/work"/*/ 2>/dev/null || { echo "vm-shard: no checkout under ~/work" >&2; mkdir -p ~/shard; echo 3 > ~/shard/exit; exit 3; }
# Group membership from bootstrap.sh's usermod is not in this SSH session yet; re-enter with the docker group (as checks.sh does).
if [ -z "${HE_SHARD_IN_DOCKER_GROUP:-}" ] && getent group docker >/dev/null && ! id -nG | grep -qw docker && id -nG "$USER" | grep -qw docker; then
  export HE_SHARD_IN_DOCKER_GROUP=1
  exec sg docker -c "bash $(printf %q "$0") $(printf '%q ' "$@")"
fi

commit="" prereg="" name="" cells="" lease="" smoke_lease="" smoke_task="" smoke=1 resume=0 amendment="" workload=harness
extra=() image=() sealed=()
while [ $# -gt 0 ]; do
  case "$1" in
    --commit) commit="$2"; shift 2 ;;
    --prereg) prereg="$2"; shift 2 ;;
    --name) name="$2"; shift 2 ;;
    --cells) cells="$2"; shift 2 ;;
    --lease-usd) lease="$2"; shift 2 ;;
    --smoke-lease-usd) smoke_lease="$2"; shift 2 ;;
    --smoke-task) smoke_task="$2"; shift 2 ;;
    --no-smoke) smoke=0; shift ;;
    --resume) resume=1; shift ;;
    --amendment) amendment="$2"; shift 2 ;;
    --embedded) extra+=(--embedded); shift ;;
    --gbrain-image) image=(--gbrain-image "$2"); shift 2 ;;
    --sealed-root) sealed+=(--sealed-root "$2"); shift 2 ;;
    --opening-receipt) sealed+=(--opening-receipt "$2"); shift 2 ;;
    --workload) workload="$2"; shift 2 ;;
    --) shift; extra+=("$@"); break ;;
    *) echo "vm-shard: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$commit" ] && [ -n "$prereg" ] && [ -n "$name" ] && [ -n "$cells" ] && [ -n "$lease" ] || { echo "vm-shard: --commit, --prereg, --name, --cells and --lease-usd are required" >&2; exit 2; }

shard=$HOME/shard
mkdir -p "$shard"
phases="$shard/phases.json"
echo '{}' > "$phases"
phase() { python3 - "$phases" "$1" <<'PY'
import json, sys, time
p = sys.argv[1]; d = json.load(open(p)); d[sys.argv[2]] = int(time.time()); json.dump(d, open(p, 'w'))
PY
}
log() { printf '%s vm-shard[%s]: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "$*"; }
finish() { echo "$1" > "$shard/exit"; exit "$1"; }

phase checkout_start
log "pinning $(pwd) at $commit"
git checkout -q --detach "$commit" || { log "git checkout --detach $commit failed"; finish 3; }
[ "$(git rev-parse HEAD)" = "$commit" ] || { log "HEAD is $(git rev-parse HEAD), not $commit"; finish 3; }
if [ -n "$(git status --porcelain)" ]; then log "the checkout is not clean at $commit; a shard runs the preregistration commit exactly"; git status --short; finish 3; fi
bun install --frozen-lockfile > "$shard/bun-install.log" 2>&1 || { tail -20 "$shard/bun-install.log"; log "bun install --frozen-lockfile failed"; finish 3; }
log "bun $(bun --version), node $(node --version), docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo none), $(nproc) cpus"
phase checkout_end

if [ "$workload" = gstack-laneb ]; then
  if [ "$smoke" -eq 1 ]; then
    phase smoke_start
    log "smoke: scripts/gstack-laneb/smoke.sh (keyless, fake upstream)"
    env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY bash scripts/gstack-laneb/smoke.sh --laneb-root "$HOME/laneb" --out "$shard/smoke"
    rc=$?
    phase smoke_end
    [ "$rc" -eq 0 ] || { log "smoke failed (exit $rc); the counted run does not start"; finish 4; }
  fi
  [ ${#sealed[@]} -eq 0 ] || { log "held-out (sealed) Lane B runs are not supported yet (docs/gstack-laneb.md, Known limits)"; finish 2; }
  phase run_start
  log "run: scripts/gstack-laneb/vm-run.sh --name $name --cells $cells --lease-usd $lease"
  # The controller's SIGTERM reaches the whole process group; vm-run.sh traps it, drains its meter and writes its records.
  # This script keeps waiting for it instead of dying, so ~/shard/exit appears only once the records exist.
  trap 'log "signal received; waiting for vm-run.sh to write its records"' TERM HUP
  HE_LANEB_HARBOR_READY=$smoke bash scripts/gstack-laneb/vm-run.sh --prereg "$prereg" --name "$name" --cells "$cells" --lease-usd "$lease" --out "$shard/results" --laneb-root "$HOME/laneb" &
  child=$!
  while :; do wait "$child"; rc=$?; kill -0 "$child" 2>/dev/null || break; done
  trap - TERM HUP
  phase run_end
  log "vm-run.sh exited $rc"
  finish "$rc"
fi

# The one-trial smoke the Capy shards ran before every counted shard: a copy of the run's preregistration with only this
# shard's harness cells, each on one dev task with one repetition under its own lease and ledger, never counted.
# A sealed lane's smoke runs as a public dev run: no sealed flags and the public image (the runner refuses a sealed image for
# a run with no sealed root, HE-SEALED-005), so the counted run builds its receipt-bound sealed image itself.
smoke_image=(${image[@]+"${image[@]}"})
[ ${#sealed[@]} -eq 0 ] || smoke_image=(--gbrain-image harness-eval/gbrain:dev)
build_flag=()
if [ "$smoke" -eq 1 ]; then
  mkdir -p "$shard/smoke"
  smoke_prereg="$shard/smoke/prereg.json"
  if [ -z "$smoke_lease" ]; then
    max_out=128000
    for ((i = 0; i < ${#extra[@]}; i++)); do [ "${extra[$i]}" = "--max-output-tokens" ] && max_out=${extra[$((i + 1))]:-$max_out}; done
    # smoke-lease.ts prints the figure on stdout and its per-cell lines on stderr; the stderr goes through a file so the
    # relay's log lines cannot land in the captured figure (a process substitution inside $(...) writes into it).
    smoke_lease=$(bun "$(dirname "$0")/smoke-lease.ts" --prereg "$prereg" --cells "$cells" --max-output-tokens "$max_out" 2> "$shard/smoke/smoke-lease.log"); lease_rc=$?
    while IFS= read -r l; do log "$l"; done < "$shard/smoke/smoke-lease.log"
    [ "$lease_rc" -eq 0 ] && [ -n "$smoke_lease" ] || { log "smoke lease: could not be derived; pass --smoke-lease-usd"; finish 2; }
    log "smoke lease: \$$smoke_lease (derived from the proxy's reservation at $max_out output tokens; --smoke-lease-usd overrides)"
  fi
  python3 - "$prereg" "$cells" "$name" "$smoke_task" "$smoke_lease" "$smoke_prereg" <<'PY' || finish 2
import json, os, sys
src, cells, name, task, lease, out = sys.argv[1:7]
p = json.load(open(src)); want = set(cells.split(','))
cells_out = [dict(c) for c in p['cells'] if c['id'] in want and c.get('harness') != 'scripted' and c.get('harness_mode') != 'scripted']
if not cells_out:
    print('vm-shard: no harness cell to smoke (scripted cells are free); skipping the smoke'); open(out, 'w').write(''); sys.exit(0)
for c in cells_out:
    c['split'] = 'dev'
    c['repetitions'] = 1
    root = os.path.join('tasks', 'multiuser', c['task_set'], 'dev') if c.get('task_set') and c['task_set'] != 'v0.1' else os.path.join('tasks', 'multiuser', 'dev')
    t = task or sorted(d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d)))[0]
    if not os.path.isdir(os.path.join(root, t)): sys.exit(f'vm-shard: smoke task {t} is not under {root}')
    c['tasks'] = [t]
kept = {c['id'] for c in cells_out}
p['cells'] = cells_out
p['run_id'] = f"{p['run_id']}-smoke-{name}"
p['question'] = 'UNCOUNTED one-trial smoke of a shard at the preregistration commit, under a scratch ledger: proves the images, the adapter hash and the proxy wiring on this VM before the counted run. Never cited as a result. ' + p.get('question', '')
p['spend_cap_usd'] = float(lease)
for k in ('drop_order', 'minimum_v01'):
    if isinstance(p.get(k), list): p[k] = [x for x in p[k] if x in kept]
json.dump(p, open(out, 'w'), indent=2); open(out, 'a').write('\n')
print('vm-shard: smoke preregistration', out, 'run_id', p['run_id'], 'cells', ','.join(c['id'] for c in cells_out), 'tasks', ','.join(c['tasks'][0] for c in cells_out))
PY
  if [ -s "$smoke_prereg" ]; then
    smoke_cells=$(python3 -c "import json,sys; print(','.join(c['id'] for c in json.load(open(sys.argv[1]))['cells']))" "$smoke_prereg")
    phase smoke_start
    smoke_args=(--prereg "$smoke_prereg" --name "smoke-$name" --cells "$smoke_cells" --lease-usd "$smoke_lease" --out "$shard/smoke/results" ${smoke_image[@]+"${smoke_image[@]}"} ${extra[@]+"${extra[@]}"})
    log "smoke: run-shard.sh ${smoke_args[*]}"
    scripts/run-shard.sh "${smoke_args[@]}"
    rc=$?
    phase smoke_end
    python3 - "$shard/smoke/results/trials.jsonl" <<'PY'
import json, sys, os
p = sys.argv[1]
if not os.path.exists(p): print('smoke: no trials.jsonl'); sys.exit(1)
rows = [json.loads(l) for l in open(p) if l.strip()]
bad = [r for r in rows if r.get('termination') != 'completed']
usd = sum((r.get('usage') or {}).get('usd', 0) for r in rows)
for r in rows: print(f"smoke trial {r['trial_id']}: termination={r.get('termination')} grade={r.get('grade')} wall_ms={r.get('wall_ms')} usd={(r.get('usage') or {}).get('usd')}")
print(f'smoke: {len(rows)} trial(s), {len(bad)} not completed, ${usd:.4f}')
sys.exit(1 if bad or not rows else 0)
PY
    smoke_ok=$?
    if [ "$rc" -ne 0 ] || [ "$smoke_ok" -ne 0 ]; then
      log "smoke failed (run-shard exit $rc, trials check $smoke_ok); the counted run does not start"
      finish 4
    fi
    [ ${#sealed[@]} -gt 0 ] || build_flag=(--skip-build)
  fi
fi

if [ "$resume" -eq 1 ] && [ -f "$shard/results/shard.json" ]; then
  log "resume: $(wc -l < "$shard/results/trials.jsonl" 2>/dev/null || echo 0) trial lines already recorded"
fi
args=(--prereg "$prereg" --name "$name" --cells "$cells" --lease-usd "$lease" --out "$shard/results" ${build_flag[@]+"${build_flag[@]}"} ${image[@]+"${image[@]}"} ${sealed[@]+"${sealed[@]}"} ${extra[@]+"${extra[@]}"})
[ "$resume" -eq 1 ] && args+=(--resume)
[ -n "$amendment" ] && args+=(--amendment "$amendment")
phase run_start
log "run: scripts/run-shard.sh ${args[*]}"
scripts/run-shard.sh "${args[@]}"
rc=$?
phase run_end
log "run-shard.sh exited $rc"
finish "$rc"
