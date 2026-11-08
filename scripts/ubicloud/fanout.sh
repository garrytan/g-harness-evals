#!/usr/bin/env bash
# Fan a sharded run out to Ubicloud: one scripts/ubicloud/run-shard.sh (one VM) per shard, all in parallel, from one
# manifest (docs/ubicloud.md). One command starts a twelve-cell run.
#
#   scripts/ubicloud/fanout.sh --manifest <file.json> [--max-vcpus N] [--parallel N] [--dry-run]
#       [--workload harness|gstack-laneb|qm-driver] [--replicate-to <dir>] [--replicate-seconds 1200]
#
# The manifest is JSON:
#   { "commit": "<sha>", "prereg": "docs/benchmarks/<run>/prereg.json", "dest": "<local results root>",
#     "size": "standard-16", "options": ["--gbrain-image", "harness-eval/gbrain:dev"],
#     "shards": [ { "name": "oc-a", "cells": "cell-1,cell-2", "lease_usd": 5 }, ... ] }
# size and options are optional; options go to every run-shard.sh as given (--embedded, --gbrain-image, --amendment,
# --smoke-lease-usd, --smoke-task, --smoke-first-cell, --no-smoke, --resume, or "--" followed by arguments for the
# repository's run-shard.sh).
# A shard may add "args": [...], passed after options and a "--" (added when options has none) to its run-shard.sh only,
# so they reach the shard's workload as given.
# "stage_cap_usd": <n> (required for --workload qm-driver) is the preregistered cap of the stage the shards run. The shards'
# lease_usd values, plus every lease the shards of the same dest ever started (each <dest>/<shard>/leases.jsonl, append-only;
# a shard named here and relaunched with --resume counts once), must sum to at most the cap, or the fan-out exits 2 before
# any VM call, the quota read included. So a canary and the rest of a stage go to the same dest. Before the first launch it
# checks again under a lock on <dest>/.stage-cap.lock and reserves each shard's lease (stage_cap below).
# A sealed run (docs/sealed-custody.md) adds "sealed_root": "<custodian's sealed root>" and "opening_receipt":
# "<its opening-receipt.json>", both or neither (one alone is exit 2); every run-shard.sh then gets --sealed-root and
# --opening-receipt with the paths expanded, and each shard uploads, uses and deletes its own copy on its VM. fanout.sh
# makes no copy of the sealed root and has nothing of it to clean up.
# --workload gstack-laneb (docs/gstack-laneb.md) passes the same flag to every run-shard.sh, which runs the shard's
# cells through the Lane B bridge (cells are <model>.<arm>; put --laneb-root in options when the fetched root is not at the
# default). run-shard.sh refuses sealed flags for this workload; the count-only polling and the VM cleanup are unchanged.
# --workload qm-driver passes the same flag: each shard runs harnesses/qm/gstack/s1e-probe.ts on its VM (the driver's
# keyless --dry-run as the smoke, then the driver under the shard's lease with its "args" passed through; the driver
# enforces the stage caps). Records are turns.jsonl lines, so the end prints the results directories, not a merge command.
# --replicate-seconds (or UBI_REPLICATE_SECONDS; run-shard.sh's default is 1200) and --replicate-to (or UBI_REPLICATE_TO;
# meant for a Capy drive folder) go to every run-shard.sh: each shard's results are pulled into <dest>/<name>/results on
# that interval while it runs, <dest>/<name> is mirrored to <replicate-to>/<name>, and <replicate-to>/vm-map.jsonl gets a
# line per VM event as it happens (CREW R16). The manifest is copied to <replicate-to>/fanout-manifest.json at start.
# Refused for a sealed manifest.
#
# At start, each shard's <dest>/<name>/cleanup-pending is pruned (scripts/ubicloud/prune-pending.sh). A shard whose
# cleanup-pending still lists a VM (kept after a failed final pull, so it may hold results) refuses the whole fan-out with
# exit 2 before any VM is created, naming the VM and the recovery (run-shard.sh --attach: pull, then down): a new launch
# would overwrite its shard-vm.json and lose track of the VM. A shard whose <replicate-to>/<name>/shard-vm.json names a VM
# other than <dest>/<name>/shard-vm.json's, with cleanup not "done", refuses it the same way: the first mirror would
# overwrite what may be the only copy of that VM's results. A shard whose <dest>/<name>/shard-vm.json names a VM whose
# cleanup is not "done" (a controller that died mid-run) refuses it too, before any launch, with run-shard.sh's advice:
# run-shard.sh --attach first, which pulls the results and the ledger and records cleanup "done".
# Each shard runs as a background process with its own log at <dest>/<name>/fanout.log, its lane log at
# <dest>/<name>/lane.log and its results at <dest>/<name>/results, which is what scripts/merge-shards.ts takes.
#
# Quota: before launching, ubi-runner.sh usage is read for the project's vCPUs in use. With --max-vcpus (or UBI_MAX_VCPUS)
# the fan-out is refused when not one VM fits and batched to as many VMs as fit otherwise, printing the needed, used and
# maximum vCPUs. Without it the maximum is unknown (the project token cannot read it; only a refused create reports it), so
# every shard is launched (or --parallel of them at a time) and a shard refused for quota ("quota refused" in its lane
# log) is queued again after the next shard finishes, up to three times.
#
# On exit it prints one row per shard (shard, cells, exit, trials, wall time of the run and of the VM, VM list price), one
# "kept:" line per shard whose VM was left running (run-shard.sh kept it after a failed final pull, or its down failed:
# shard, VM, reason, cleanup-pending path, recovery), the totals with the kept count, and the merge command; the exit code
# is 0 only when every shard exited 0 and no VM was kept. An interrupt is forwarded to every
# shard, each of which copies its results back and destroys its VM before exiting. Needs UBICLOUD_API_KEY, UBI_OWNER,
# ANTHROPIC_API_KEY (and OPENAI_API_KEY for --embedded, PARTICLE_API_KEY for Particle cells) in the environment, python3 and
# bash 5.1 or later.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
runner=${UBI_RUNNER:-$here/ubi-runner.sh}
manifest="" max_vcpus=${UBI_MAX_VCPUS:-} parallel="" dry=0 workload=harness rep_to=${UBI_REPLICATE_TO:-} rep_s=${UBI_REPLICATE_SECONDS:-}
while [ $# -gt 0 ]; do
  case "$1" in
    --manifest) manifest=$2; shift 2 ;;
    --max-vcpus) max_vcpus=$2; shift 2 ;;
    --parallel) parallel=$2; shift 2 ;;
    --dry-run) dry=1; shift ;;
    --workload) workload=$2; shift 2 ;;
    --replicate-to) rep_to=$2; shift 2 ;;
    --replicate-seconds) rep_s=$2; shift 2 ;;
    -h|--help) sed -n '2,/^set -euo pipefail/{/^set /!p}' "$0"; exit 0 ;;
    *) echo "fanout: unknown argument $1 (see --help)" >&2; exit 2 ;;
  esac
done
[ -n "$manifest" ] && [ -f "$manifest" ] || { echo "fanout: --manifest <file.json> is required" >&2; exit 2; }
case $workload in harness|gstack-laneb|qm-driver) ;; *) echo "fanout: --workload must be harness, gstack-laneb or qm-driver" >&2; exit 2 ;; esac
[ -z "$rep_s" ] || [[ "$rep_s" =~ ^[0-9]+$ ]] || { echo "fanout: --replicate-seconds must be a whole number of seconds" >&2; exit 2; }
rep_to=${rep_to/#\~/$HOME}
[ -n "${UBI_OWNER:-}" ] || { echo "fanout: set UBI_OWNER to your thread code so the VMs carry their owner" >&2; exit 2; }
# The sealed flags, shell-quoted, or nothing; checked here because a failure inside the mapfile below would not stop the script.
sealed=$(python3 - "$manifest" <<'PY'
import json, os, shlex, sys
m = json.load(open(sys.argv[1]))
if ('sealed_root' in m) != ('opening_receipt' in m):
    sys.exit('fanout: the manifest names one of sealed_root and opening_receipt; give both or neither')
if 'sealed_root' in m:
    p = lambda k: os.path.abspath(os.path.expanduser(m[k]))
    print(' '.join(shlex.quote(a) for a in ('--sealed-root', p('sealed_root'), '--opening-receipt', p('opening_receipt'))))
PY
) || exit 2
[ -z "$sealed" ] || [ -z "$rep_to" ] || { echo "fanout: --replicate-to is refused for a sealed manifest; sealed raw results stay in dest (docs/sealed-custody.md)" >&2; exit 2; }
export TZ=UTC
log() { printf '%(%Y-%m-%dT%H:%M:%SZ)T fanout: %s\n' -1 "$*" >&2; }

# The stage cap (stage_cap_usd, required for --workload qm-driver): this manifest's leases plus every lease the shards of
# this dest ever started must fit the cap. Each <dest>/<shard>/leases.jsonl is append-only (run-shard.sh adds a line per
# launch, fanout.sh one per reserved shard), so a relaunch or a shard-vm.json moved aside never drops an earlier lease. A
# reservation and the launch that used it count once, and a --resume (read only before "--" in options) continues its
# shard's latest lease. A dest from before leases.jsonl counts its shard-vm.json lease. "check" runs before any VM call;
# "reserve" runs before the first launch under an exclusive lock on <dest>/.stage-cap.lock (waiting up to
# UBI_STAGE_LOCK_SECONDS, default 300), checks again and appends one reservation per shard it launches fresh, printing
# "<shard><TAB><reservation>" lines, so two fan-outs on one dest cannot spend the same budget.
stage_cap() {
  python3 - "$manifest" "$workload" "$1" <<'PY'
import fcntl, json, os, sys, time
m = json.load(open(sys.argv[1])); workload, mode = sys.argv[2], sys.argv[3]
num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0
cap = m.get('stage_cap_usd')
if workload == 'qm-driver' and cap is None:
    sys.exit('fanout: --workload qm-driver needs "stage_cap_usd" in the manifest (the preregistered cap of the stage these shards run), so the summed leases are checked before any VM call')
if cap is None: sys.exit(0)
if not num(cap): sys.exit('fanout: stage_cap_usd must be a number above 0')
shards = m['shards']
bad = [str(s.get('name', '?')) for s in shards if not num(s.get('lease_usd'))]
if bad: sys.exit('fanout: with stage_cap_usd every lease_usd must be a number above 0 (not ' + ', '.join(bad) + ')')
names = [s['name'] for s in shards]
total = sum(s['lease_usd'] for s in shards)
dest = os.path.expanduser(m['dest'])
opts = m.get('options', [])
resume = '--resume' in (opts[:opts.index('--')] if '--' in opts else opts)
when = 'before any VM call' if mode == 'check' else 'before any VM was created'
if mode == 'reserve':
    os.makedirs(dest, exist_ok=True)
    lp = os.path.join(dest, '.stage-cap.lock')
    lock = open(lp, 'a')
    wait = float(os.environ.get('UBI_STAGE_LOCK_SECONDS') or 300)
    t0 = time.time()
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.time() - t0 >= wait: sys.exit('fanout: refused %s: another fan-out holds the stage lock %s after %gs, so its reservations are not written yet; run this one when that fan-out has launched its shards' % (when, lp, wait))
            time.sleep(0.5)
def leases(d):
    p = os.path.join(dest, d, 'leases.jsonl')
    if os.path.isfile(p):
        units = {}
        for i, line in enumerate(open(p), 1):
            if not line.strip(): continue
            try:
                e = json.loads(line)
                lease = float(e.get('lease_usd') or 0)
            except (ValueError, TypeError, AttributeError):
                sys.exit('fanout: refused %s: %s line %d is unreadable, so its lease cannot be counted against stage_cap_usd' % (when, p, i))
            if e.get('resume'): continue
            k = e.get('reservation') or 'line %d' % i
            units[k] = max(units.get(k, 0.0), lease)
        return list(units.values())
    q = os.path.join(dest, d, 'shard-vm.json')
    if not os.path.isfile(q): return []
    try: v = json.load(open(q))
    except ValueError: sys.exit('fanout: refused %s: %s is unreadable, so its lease cannot be counted against stage_cap_usd' % (when, q))
    return [float(v.get('lease_usd') or 0)] if v.get('launched_at') else []
earlier = {}
for d in sorted(os.listdir(dest)) if os.path.isdir(dest) else []:
    if not os.path.isdir(os.path.join(dest, d)): continue
    u = leases(d)
    if resume and d in names: u = u[:-1]
    if u: earlier[d] = sum(u)
spent = sum(earlier.values())
if total + spent > cap + 1e-9:
    prior = ' plus $%g launched earlier from %s (%s)' % (spent, dest, ', '.join(earlier)) if earlier else ''
    sys.exit('fanout: refused %s: the shard leases sum to $%g%s, above the stage cap of $%g (stage_cap_usd); lower lease_usd' % (when, total, prior, cap))
if mode == 'reserve' and not resume:
    stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    for s in shards:
        rid = '%s-%d-%s' % (stamp, os.getpid(), s['name'])
        os.makedirs(os.path.join(dest, s['name']), exist_ok=True)
        with open(os.path.join(dest, s['name'], 'leases.jsonl'), 'a') as f:
            f.write(json.dumps({'reservation': rid, 'lease_usd': s['lease_usd'], 'reserved_at': stamp, 'by': 'fanout.sh', 'resume': False}) + '\n')
        print(s['name'] + '\t' + rid)
PY
}

# The manifest, flattened: header fields, then one tab-separated line per shard.
flat=$(python3 - "$manifest" "$workload" <<'PY'
import json, os, shlex, sys
m = json.load(open(sys.argv[1]))
for k in ('commit', 'prereg', 'dest', 'shards'):
    if k not in m: sys.exit(f'fanout: manifest lacks {k}')
if not m['shards']: sys.exit('fanout: manifest has no shards')
names = [s['name'] for s in m['shards']]
if len(set(names)) != len(names): sys.exit('fanout: shard names repeat')
cells = [c for s in m['shards'] for c in s['cells'].split(',')]
if len(set(cells)) != len(cells): sys.exit('fanout: a cell appears in two shards')
print(m['commit']); print(m['prereg']); print(os.path.expanduser(m['dest'])); print(m.get('size', 'standard-16'))
opts = m.get('options', [])
print(' '.join(shlex.quote(o) for o in opts))
for s in m['shards']:
    for k in ('name', 'cells', 'lease_usd'):
        if k not in s: sys.exit(f"fanout: shard {s.get('name', '?')} lacks {k}")
    a = s.get('args', [])
    if not isinstance(a, list) or not all(isinstance(x, str) for x in a): sys.exit(f"fanout: shard {s['name']}: args must be a list of strings")
    tail = ([] if '--' in opts else ['--']) + a if a else []
    print(f"{s['name']}\t{s['cells']}\t{s['lease_usd']}\t{' '.join(shlex.quote(x) for x in tail)}")
PY
) || exit 2
stage_cap check || exit 2
mapfile -t head <<<"$flat"
commit=${head[0]} prereg=${head[1]} dest=${head[2]} size=${head[3]} options=${head[4]}
shards=("${head[@]:5}")
n=${#shards[@]}
case $size in standard-2) per=2 ;; standard-4) per=4 ;; standard-8) per=8 ;; standard-16) per=16 ;; standard-30) per=30 ;; standard-60) per=60 ;; *) per=16 ;; esac
needed=$(( n * per ))

# Quota check: used vCPUs from ubi-runner.sh usage (its last line is "total <vms> <vcpus>").
usage=$(bash "$runner" usage 2>/dev/null || true)
used=$(awk '$1=="total" {print $3}' <<<"$usage")
used=${used:-0}
log "$n shard(s) on $size: $needed vCPUs needed; the project uses $used now${max_vcpus:+ of $max_vcpus}"
printf '%s\n' "$usage" | sed 's/^/  /' >&2
if [ -n "$max_vcpus" ]; then
  fit=$(( (max_vcpus - used) / per ))
  if [ "$fit" -lt 1 ]; then echo "fanout: refused: not one $size VM fits (needed $needed, used $used, maximum $max_vcpus vCPUs); wait for VMs to finish or use a smaller size" >&2; exit 3; fi
  if [ "$fit" -lt "$n" ]; then log "only $fit of $n VMs fit the quota (needed $needed, used $used, maximum $max_vcpus); running $fit at a time"; fi
  [ -n "$parallel" ] && [ "$parallel" -lt "$fit" ] || parallel=$fit
else
  log "the vCPU maximum is not readable with this token; launching ${parallel:-all $n} at once, and a shard refused for quota is queued again"
  parallel=${parallel:-$n}
fi
[ "$parallel" -gt "$n" ] && parallel=$n

run_cmd() {
  local name=$1 cells=$2 lease=$3 sargs=${4:-}
  printf '%s --commit %s --prereg %s --name %s --cells %s --lease-usd %s --dest %s --size %s %s' "$here/run-shard.sh" "$(printf %q "$commit")" "$(printf %q "$prereg")" "$(printf %q "$name")" "$(printf %q "$cells")" "$(printf %q "$lease")" "$(printf %q "$dest/$name")" "$(printf %q "$size")" "${sealed:+$sealed }$([ "$workload" = harness ] || printf -- '--workload %s ' "$workload")$([ -z "$rep_to" ] || printf -- '--replicate-to %q ' "$rep_to")$([ -z "$rep_s" ] || printf -- '--replicate-seconds %s ' "$rep_s")$options${sargs:+ $sargs}"
}
merge_cmd() { printf 'bun scripts/merge-shards.ts --out <merged results dir>'; local line name; for line in "${shards[@]}"; do IFS=$'\t' read -r name _ _ <<<"$line"; printf ' --shard %s=%s/%s/results' "$name" "$dest" "$name"; done; echo; }
# qm-driver results are turns.jsonl, which merge-shards.ts does not read, so that workload gets the results directories.
results_dirs() { local line name; for line in "${shards[@]}"; do IFS=$'\t' read -r name _ <<<"$line"; printf '%s/%s/results ' "$dest" "$name"; done; echo; }
if [ "$dry" -eq 1 ]; then
  for line in "${shards[@]}"; do IFS=$'\t' read -r name cells lease sargs <<<"$line"; echo "$(run_cmd "$name" "$cells" "$lease" "$sargs") > $dest/$name/fanout.log 2>&1 &"; done
  if [ "$workload" = qm-driver ]; then echo "then: read $(results_dirs)"; else echo "then: $(merge_cmd)"; fi
  exit 0
fi

mkdir -p "$dest"
# A shard whose own shard-vm.json names a VM that was never cleaned up (a controller that died mid-run) refuses the whole
# fan-out, as run-shard.sh refuses that shard: the VM may still be running under its lease. Checked for every shard before
# any launches, so no other shard's VM is created first.
bad=0
for line in "${shards[@]}"; do
  IFS=$'\t' read -r name _ <<<"$line"
  [ -f "$dest/$name/shard-vm.json" ] || continue
  live=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d['vm'] if d.get('vm') and d.get('cleanup') != 'done' else '')" "$dest/$name/shard-vm.json" 2>/dev/null) || live="unreadable shard-vm.json"
  [ -n "$live" ] || continue
  bad=1
  echo "fanout: refused: $dest/$name/shard-vm.json names a VM ($live) whose cleanup is not done, so it may still be running and spending its lease. Run --attach first: it pulls the results and the ledger at teardown, downs the VM and records cleanup done, and then the fan-out can go ahead. The attach: $here/run-shard.sh --attach --dest $dest/$name. Only if the attach cannot reach the VM and the project's VM list (every owner) no longer shows it, move $dest/$name/shard-vm.json aside (its leases.jsonl keeps the lease in the stage sum). The list: bash $runner list" >&2
done
[ "$bad" -eq 0 ] || exit 2
# Stale cleanup-pending entries go first; a launch into a shard that still has a kept VM is refused before any VM exists.
dests=(); for line in "${shards[@]}"; do IFS=$'\t' read -r name _ <<<"$line"; [ ! -s "$dest/$name/cleanup-pending" ] || dests+=("$dest/$name"); done
if [ ${#dests[@]} -gt 0 ]; then
  UBI_RUNNER=$runner bash "$here/prune-pending.sh" "${dests[@]}" >&2 || true
  bad=0
  for d in "${dests[@]}"; do
    [ -s "$d/cleanup-pending" ] || continue
    bad=1
    echo "fanout: refused: $d has a kept VM ($(sort -u "$d/cleanup-pending" | paste -sd' ' -), in $d/cleanup-pending) that may still hold its results; a new launch would overwrite shard-vm.json and lose track of it. Recover first: $here/run-shard.sh --attach --dest $d (pulls the results, then downs the VM), then $here/prune-pending.sh $d" >&2
  done
  [ "$bad" -eq 0 ] || exit 2
fi
if [ -n "$rep_to" ]; then
  bad=0
  for line in "${shards[@]}"; do
    IFS=$'\t' read -r name _ <<<"$line"
    [ -f "$rep_to/$name/shard-vm.json" ] || continue
    other=$(python3 - "$rep_to/$name/shard-vm.json" "$dest/$name/shard-vm.json" <<'PY'
import json, os, sys
r = json.load(open(sys.argv[1]))
mine = json.load(open(sys.argv[2])).get('vm') if os.path.exists(sys.argv[2]) else None
if r.get('vm') and r['vm'] != mine and r.get('cleanup') != 'done': print(r['vm'])
PY
) || other="unreadable shard-vm.json"
    [ -n "$other" ] || continue
    bad=1
    echo "fanout: refused: $rep_to/$name holds the mirror of another VM ($other) whose cleanup is not done, maybe a run whose controller died; this fan-out's first mirror would overwrite it. Recover first: $here/run-shard.sh --attach --dest <its dest> on the machine that launched it (vm-map.jsonl names the dest), or copy $rep_to/$name out and move it aside, or use a new --replicate-to" >&2
  done
  [ "$bad" -eq 0 ] || exit 2
fi
if [ -n "$rep_to" ]; then
  mkdir -p "$rep_to" && rep_to=$(cd "$rep_to" && pwd) && cp "$manifest" "$rep_to/fanout-manifest.json" || { echo "fanout: --replicate-to $rep_to cannot be written" >&2; exit 2; }
  log "replicating each shard to $rep_to/<shard> every ${rep_s:-1200}s; VM map $rep_to/vm-map.jsonl"
else
  log "WARNING: no --replicate-to (or UBI_REPLICATE_TO): results and the VM map stay on this machine only (CREW R16); pass a Capy drive folder for a paid run"
fi
reservations=$(stage_cap reserve) || exit 2
declare -A rid_of=()
while IFS=$'\t' read -r rname rid; do [ -z "$rname" ] || rid_of[$rname]=$rid; done <<<"$reservations"
declare -A pid_of exit_of tries_of told log_start
queue=("${shards[@]}")
running=0
stopping=0
# An interrupt usually comes as several signals (a cancelled operation or a closed terminal sends TERM, HUP and INT to the
# group): the first is logged once, and each shard gets one TERM, so a second never cuts into its copy-back and VM destroy.
on_signal() {
  local p
  [ "$stopping" = 1 ] || log "interrupted: forwarding to ${#pid_of[@]} shard process(es); each copies its results back and destroys its VM"
  stopping=1
  for p in "${!pid_of[@]}"; do [ -n "${told[$p]:-}" ] || { told[$p]=1; kill -TERM "$p" 2>/dev/null || true; }; done
}
trap on_signal INT TERM HUP QUIT
t0=$(date +%s)
launch() {
  local line=$1 name cells lease sargs
  IFS=$'\t' read -r name cells lease sargs <<<"$line"
  mkdir -p "$dest/$name"
  tries_of[$name]=$(( ${tries_of[$name]:-0} + 1 ))
  log_start[$name]=$(stat -c %s "$dest/$name/lane.log" 2>/dev/null || echo 0)
  log "launching shard $name (cells $cells, lease \$$lease, try ${tries_of[$name]}); log $dest/$name/fanout.log"
  UBI_LEASE_RESERVATION=${rid_of[$name]:-} bash -c "$(run_cmd "$name" "$cells" "$lease" "$sargs")" > "$dest/$name/fanout.log" 2>&1 &
  pid_of[$!]=$line
  running=$(( running + 1 ))
}
while [ ${#queue[@]} -gt 0 ] || [ "$running" -gt 0 ]; do
  while [ "$stopping" -eq 0 ] && [ ${#queue[@]} -gt 0 ] && [ "$running" -lt "$parallel" ]; do
    launch "${queue[0]}"; queue=("${queue[@]:1}")
    sleep 2
  done
  [ "$running" -gt 0 ] || break
  done_pid=""
  set +e; wait -n -p done_pid "${!pid_of[@]}"; rc=$?; set -e
  [ -n "${done_pid:-}" ] || continue
  line=${pid_of[$done_pid]}; unset 'pid_of[$done_pid]'; running=$(( running - 1 ))
  IFS=$'\t' read -r name cells lease _ <<<"$line"
  if [ "$rc" -eq 3 ] && [ "$stopping" -eq 0 ] && tail -c +$(( ${log_start[$name]:-0} + 1 )) "$dest/$name/lane.log" 2>/dev/null | grep -q 'quota refused' && [ "${tries_of[$name]}" -lt 3 ]; then
    log "shard $name was refused for vCPU quota; queued again (after the next shard finishes)"
    queue+=("$line"); [ "$running" -gt 0 ] || sleep 60
    continue
  fi
  exit_of[$name]=$rc
  log "shard $name exited $rc"
done
if [ "$stopping" -eq 1 ]; then for line in "${queue[@]}"; do IFS=$'\t' read -r name _ _ <<<"$line"; exit_of[$name]=interrupted; done; fi

# The table, from each shard's shard-vm.json and trials.jsonl (turns.jsonl for qm-driver), then one "kept:" line per VM
# left running; it exits 3 when there is one.
set +e
python3 - "$dest" "$(( $(date +%s) - t0 ))" "$here" "$runner" "${shards[@]}" <<'PY'
import json, os, sys
dest, wall, here, runner, *shards = sys.argv[1:]
def fmt(s):
    if s is None: return '?'
    s = int(s); return f'{s // 3600}h{s % 3600 // 60:02d}m' if s >= 3600 else f'{s // 60}m{s % 60:02d}s'
hdr = ('shard', 'cells', 'exit', 'trials', 'run', 'vm life', 'size', 'vm cost')
rows = []; kept = []; total_cost = 0.0; total_trials = 0; bad = 0
for line in shards:
    name, cells = line.split('\t')[:2]
    d = os.path.join(dest, name)
    p = os.path.join(d, 'shard-vm.json')
    vm = json.load(open(p)) if os.path.exists(p) else {}
    tp = next((q for q in (os.path.join(d, 'results', f) for f in ('trials.jsonl', 'turns.jsonl')) if os.path.exists(q)), None)
    trials = sum(1 for _ in open(tp)) if tp else 0
    if vm.get('cleanup') == 'failed' or (vm.get('cleanup') == 'pending' and vm.get('cleanup_reason')):
        reason = vm.get('cleanup_reason') if vm.get('cleanup') == 'pending' else 'down failed'
        fix = f'{here}/run-shard.sh --attach --dest {d} (pulls the results, then downs the VM)' if vm.get('cleanup') == 'pending' else f'bash {runner} down {vm.get("vm")}'
        kept.append(f'kept: shard {name}  vm {vm.get("vm", "?")}  reason "{reason}"  cleanup-pending {os.path.join(d, "cleanup-pending")}; recover: {fix}')
    ex = vm.get('exit')
    if ex != 0: bad += 1
    cost = (vm.get('cost') or {}).get('list_price_usd')
    t = vm.get('timings_s') or {}
    rows.append((name, cells, '?' if ex is None else str(ex), str(trials), fmt(t.get('run')), fmt(t.get('vm_life')), vm.get('size', '?'), '?' if cost is None else '$%.4f' % cost))
    total_cost += cost or 0; total_trials += trials
w = [max(len(r[i]) for r in rows + [hdr]) for i in range(len(hdr))]
line = lambda r: '  '.join(c.ljust(w[i]) for i, c in enumerate(r))
print(line(hdr))
for r in rows: print(line(r))
for k in kept: print(k)
print('total: %d shard(s), %d trials, %d not exit 0, %d kept VM(s), VM list price $%.4f, fan-out wall time %s' % (len(rows), total_trials, bad, len(kept), total_cost, fmt(wall)))
sys.exit(3 if kept else 0)
PY
table_rc=$?
set -e
if [ "$workload" = qm-driver ]; then echo "results: $(results_dirs)"; else echo "merge: $(merge_cmd)"; fi
[ "$table_rc" -eq 0 ] || exit 1
for name in "${!exit_of[@]}"; do [ "${exit_of[$name]}" = 0 ] || exit 1; done
[ ${#exit_of[@]} -eq "$n" ] || exit 1
exit 0
