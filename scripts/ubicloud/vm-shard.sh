#!/usr/bin/env bash
# The VM side of the Ubicloud shard lane (docs/ubicloud.md). scripts/ubicloud/run-shard.sh uploads this file to the VM
# and starts it detached, so a dropped SSH session or a sleeping Capy machine does not stop the shard. It pins the synced
# checkout at the commit, installs dependencies, runs the one-trial smoke under a scratch preregistration and ledger the
# way the Capy shards did (one dev task, one repetition, its own lease, never counted), then the repository's own
# scripts/run-shard.sh for the shard under its lease with --skip-build, and writes ~/shard/exit with the exit code.
#
#   vm-shard.sh --commit <sha> --prereg <path on the VM> --name <shard> --cells a,b --lease-usd <n>
#               [--smoke-lease-usd <n>] [--smoke-task <task id>] [--smoke-first-cell] [--no-smoke] [--resume] [--amendment <sha>]
#               [--embedded] [--gbrain-image <tag>] [--sealed-root <path on the VM> --opening-receipt <path on the VM>]
#               [--workload harness|gstack-laneb|qm-driver|frontier-harbor] [--install-check] [-- <extra run-shard.sh arguments>]
#
# --workload frontier-harbor (scripts/frontier-harbor/README.md): Terminal-Bench 2.1 is cloned at pin.json's commit into
# ~/terminal-bench-2-1. With --install-check the lane is the keyless install check and nothing else:
# scripts/frontier-harbor/install-check.sh ~/shard/results with every key unset (fake upstream, no spend), its output in
# ~/shard/results/run.stdout.log and its exit code the shard's. Otherwise the smoke is that same keyless install check
# into ~/shard/smoke (--no-smoke skips it; exit 4 when it fails), then scripts/frontier-harbor/vm-run.sh for the shard
# under its lease with --out ~/shard/results and the arguments after -- passed through (--stage <name>, --done <file>),
# its output in ~/shard/results/run.stdout.log.
# Sealed flags are refused.
#
# --workload qm-driver: the smoke is harnesses/qm/gstack/s1e-probe.ts --dry-run without any key (the S1 fakes behind the
# proxy in capture mode, no spend; it builds the rig images, so the counted run gets --skip-build), its output and results
# under ~/shard/smoke/results. The counted run creates ~/shard/results/ledger.sqlite with the shard's lease as its program
# cap when it is missing (a --resume brings the earlier one back), then runs s1e-probe.ts with --ledger, --lease-usd, --out
# ~/shard/results, --work ~/shard/work and the arguments after -- as given; its output goes to ~/shard/results/run.stdout.log.
# The driver enforces the stage caps (--stage, --shards). Sealed flags are refused.
#
# --workload gstack-laneb (docs/gstack-laneb.md): the smoke is the bridge's keyless smoke
# (scripts/gstack-laneb/smoke.sh against the pinned fake upstream, no spend; it installs Harbor at its pin) and the shard
# runs scripts/gstack-laneb/vm-run.sh with the Lane B checkout and arms run-shard.sh uploaded to ~/laneb and the shard's
# lease. Sealed flags are refused for this workload (run-shard.sh refuses them first). The smoke's results go to ~/shard/smoke/results and the shard's to ~/shard/results.
#
# --sealed-root and --opening-receipt (docs/sealed-custody.md) name the custodian's sealed root and receipt that
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
# --smoke-first-cell smokes only the first harness cell in --cells order (one trial) instead of every harness cell of the
# shard (one trial each, the default). Use it when every cell of a shard shares the harness, the arm and the smoke task,
# so the other smoke trials would prove the same images, adapter and proxy wiring again.
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

commit="" prereg="" name="" cells="" lease="" smoke_lease="" smoke_task="" smoke=1 smoke_first=0 resume=0 amendment="" workload=harness install_check=0
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
    --smoke-first-cell) smoke_first=1; shift ;;
    --no-smoke) smoke=0; shift ;;
    --resume) resume=1; shift ;;
    --amendment) amendment="$2"; shift 2 ;;
    --embedded) extra+=(--embedded); shift ;;
    --gbrain-image) image=(--gbrain-image "$2"); shift 2 ;;
    --sealed-root) sealed+=(--sealed-root "$2"); shift 2 ;;
    --opening-receipt) sealed+=(--opening-receipt "$2"); shift 2 ;;
    --workload) workload="$2"; shift 2 ;;
    --install-check) install_check=1; shift ;;
    --) shift; extra+=("$@"); break ;;
    *) echo "vm-shard: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$commit" ] && [ -n "$prereg" ] && [ -n "$name" ] && [ -n "$cells" ] && [ -n "$lease" ] || { echo "vm-shard: --commit, --prereg, --name, --cells and --lease-usd are required" >&2; exit 2; }
[ "$install_check" -eq 0 ] || [ "$workload" = frontier-harbor ] || { echo "vm-shard: --install-check applies only to --workload frontier-harbor" >&2; exit 2; }

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
    env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u PARTICLE_API_KEY bash scripts/gstack-laneb/smoke.sh --laneb-root "$HOME/laneb" --out "$shard/smoke"
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

if [ "$workload" = frontier-harbor ]; then
  [ ${#sealed[@]} -eq 0 ] || { log "frontier-harbor takes no sealed flags"; finish 2; }
  if [ "$install_check" -eq 1 ] && [ "$(realpath "$prereg")" != "$(realpath scripts/frontier-harbor/install-check-prereg.json)" ]; then log "--install-check runs scripts/frontier-harbor/install-check-prereg.json; the manifest names $prereg"; finish 2; fi
  planned=$(python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); print(",".join(next((s["cells"] for s in p["shards"] if s["name"] == sys.argv[2]), [])))' "$prereg" "$name")
  [ "$planned" = "$cells" ] || { log "shard $name of $prereg has cells '$planned', not the manifest's '$cells'"; finish 2; }
  read -r tb_repo tb_commit <<< "$(python3 -c 'import json,sys; t=json.load(open(sys.argv[1]))["terminal_bench"]; print(t["repo"], t["commit"])' scripts/frontier-harbor/pin.json)"
  tb21=$HOME/terminal-bench-2-1
  if [ "$(git -C "$tb21" rev-parse HEAD 2>/dev/null)" != "$tb_commit" ]; then
    rm -rf "$tb21"
    git clone --quiet --filter=blob:none "$tb_repo" "$tb21" > "$shard/tb21-clone.log" 2>&1 && git -C "$tb21" checkout --quiet "$tb_commit" || { log "cloning terminal-bench-2-1 at $tb_commit failed"; finish 3; }
  fi
  log "terminal-bench-2-1 at $(git -C "$tb21" rev-parse HEAD)"
  keyless=(env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u PARTICLE_API_KEY -u UBICLOUD_API_KEY)
  if [ "$install_check" -eq 1 ]; then
    mkdir -p "$shard/results"
    phase run_start
    log "install check: scripts/frontier-harbor/install-check.sh (keyless, fake upstream)"
    "${keyless[@]}" bash scripts/frontier-harbor/install-check.sh "$shard/results" ${extra[@]+"${extra[@]}"} > "$shard/results/run.stdout.log" 2>&1
    rc=$?
    phase run_end
    tail -3 "$shard/results/run.stdout.log"
    log "install-check.sh exited $rc"
    finish "$rc"
  fi
  if [ "$smoke" -eq 1 ]; then
    mkdir -p "$shard/smoke/results"
    phase smoke_start
    log "smoke: scripts/frontier-harbor/install-check.sh (keyless, fake upstream)"
    "${keyless[@]}" bash scripts/frontier-harbor/install-check.sh "$shard/smoke/results" > "$shard/smoke/results/run.stdout.log" 2>&1
    rc=$?
    phase smoke_end
    [ "$rc" -eq 0 ] || { tail -5 "$shard/smoke/results/run.stdout.log"; log "smoke failed (exit $rc); the counted run does not start"; finish 4; }
  fi
  phase run_start
  log "run: scripts/frontier-harbor/vm-run.sh --prereg $prereg --name $name --lease-usd $lease ${extra[*]-}"
  # The controller's SIGTERM reaches the whole process group; vm-run.sh traps it, drains its meter and writes its records.
  trap 'log "signal received; waiting for vm-run.sh to write its records"' TERM HUP
  mkdir -p "$shard/results"
  bash scripts/frontier-harbor/vm-run.sh --prereg "$prereg" --name "$name" --lease-usd "$lease" --out "$shard/results" --tb21 "$tb21" ${extra[@]+"${extra[@]}"} >> "$shard/results/run.stdout.log" 2>&1 &
  child=$!
  while :; do wait "$child"; rc=$?; kill -0 "$child" 2>/dev/null || break; done
  trap - TERM HUP
  phase run_end
  log "vm-run.sh exited $rc"
  finish "$rc"
fi

if [ "$workload" = qm-driver ]; then
  [ ${#sealed[@]} -eq 0 ] || { log "qm-driver takes no sealed flags"; finish 2; }
  mkdir -p "$shard/results"
  build_flag=()
  if [ "$smoke" -eq 1 ]; then
    mkdir -p "$shard/smoke/results"
    phase smoke_start
    log "smoke: bun harnesses/qm/gstack/s1e-probe.ts --dry-run (keyless, fake upstream)"
    env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u PARTICLE_API_KEY bun harnesses/qm/gstack/s1e-probe.ts --dry-run --work "$shard/smoke/work" --out "$shard/smoke/results" > "$shard/smoke/results/run.stdout.log" 2>&1
    rc=$?
    phase smoke_end
    [ "$rc" -eq 0 ] || { tail -5 "$shard/smoke/results/run.stdout.log"; log "smoke failed (exit $rc); the counted run does not start"; finish 4; }
    build_flag=(--skip-build)
  fi
  ledger=$shard/results/ledger.sqlite
  if [ ! -f "$ledger" ]; then
    bun runner/ledger/budget-ledger.ts init --budget-ledger "$ledger" --program-cap-usd "$lease" --reason "qm-driver shard $name" || { log "ledger init failed"; finish 2; }
  fi
  args=(--ledger "$ledger" --lease-usd "$lease" --out "$shard/results" --work "$shard/work" ${build_flag[@]+"${build_flag[@]}"} ${extra[@]+"${extra[@]}"})
  phase run_start
  log "run: bun harnesses/qm/gstack/s1e-probe.ts ${args[*]}"
  bun harnesses/qm/gstack/s1e-probe.ts "${args[@]}" >> "$shard/results/run.stdout.log" 2>&1
  rc=$?
  phase run_end
  log "s1e-probe.ts exited $rc"
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
  python3 - "$prereg" "$cells" "$name" "$smoke_task" "$smoke_lease" "$smoke_prereg" "$smoke_first" <<'PY' || finish 2
import json, os, sys
src, cells, name, task, lease, out, first = sys.argv[1:8]
p = json.load(open(src)); order = cells.split(','); want = set(order)
cells_out = [dict(c) for c in p['cells'] if c['id'] in want and c.get('harness') != 'scripted' and c.get('harness_mode') != 'scripted']
if not cells_out:
    print('vm-shard: no harness cell to smoke (scripted cells are free); skipping the smoke'); open(out, 'w').write(''); sys.exit(0)
if first == '1':
    cells_out = [min(cells_out, key=lambda c: order.index(c['id']))]
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
    # internal-task: when the cells set log_sections, every forwarded chat line of the smoke carries sections and the cache-write fields.
    sections_ok=0
    if [ -f "$shard/smoke/results/manifest.json" ] && python3 -c "import json,sys; sys.exit(0 if any(c.get('log_sections') is True for c in json.load(open(sys.argv[1])).get('cells', [])) else 1)" "$shard/smoke/results/manifest.json"; then
      bun runner/run.ts check-sections --manifest "$shard/smoke/results/manifest.json" > "$shard/smoke/sections.log" 2>&1; sections_ok=$?
      while IFS= read -r l; do log "$l"; done < "$shard/smoke/sections.log"
    fi
    if [ "$rc" -ne 0 ] || [ "$smoke_ok" -ne 0 ] || [ "$sections_ok" -ne 0 ]; then
      log "smoke failed (run-shard exit $rc, trials check $smoke_ok, sections check $sections_ok); the counted run does not start"
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
