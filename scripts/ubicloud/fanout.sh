#!/usr/bin/env bash
# Fan a sharded run out to Ubicloud: one scripts/ubicloud/run-shard.sh (one VM) per shard, all in parallel, from one
# manifest (docs/ubicloud.md). One command starts a twelve-cell run.
#
#   scripts/ubicloud/fanout.sh --manifest <file.json> [--max-vcpus N] [--parallel N] [--dry-run] [--workload harness|gstack-laneb]
#
# The manifest is JSON:
#   { "commit": "<sha>", "prereg": "docs/benchmarks/<run>/prereg.json", "dest": "<local results root>",
#     "size": "standard-16", "options": ["--gbrain-image", "harness-eval/gbrain:dev"],
#     "shards": [ { "name": "oc-a", "cells": "cell-1,cell-2", "lease_usd": 5 }, ... ] }
# size and options are optional; options go to every run-shard.sh as given (--embedded, --gbrain-image, --amendment,
# --smoke-lease-usd, --smoke-task, --smoke-first-cell, --no-smoke, --resume, or "--" followed by arguments for the
# repository's run-shard.sh).
# A sealed run (docs/sealed-custody.md) adds "sealed_root": "<custodian's sealed root>" and "opening_receipt":
# "<its opening-receipt.json>", both or neither (one alone is exit 2); every run-shard.sh then gets --sealed-root and
# --opening-receipt with the paths expanded, and each shard uploads, uses and deletes its own copy on its VM. fanout.sh
# makes no copy of the sealed root and has nothing of it to clean up.
# --workload gstack-laneb (docs/gstack-laneb.md) passes the same flag to every run-shard.sh, which runs the shard's
# cells through the Lane B bridge (cells are <model>.<arm>; put --laneb-root in options when the fetched root is not at the
# default). run-shard.sh refuses sealed flags for this workload; the count-only polling and the VM cleanup are unchanged.
# Each shard runs as a background process with its own log at <dest>/<name>/fanout.log, its lane log at
# <dest>/<name>/lane.log and its results at <dest>/<name>/results, which is what scripts/merge-shards.ts takes.
#
# Quota: before launching, ubi-runner.sh usage is read for the project's vCPUs in use. With --max-vcpus (or UBI_MAX_VCPUS)
# the fan-out is refused when not one VM fits and batched to as many VMs as fit otherwise, printing the needed, used and
# maximum vCPUs. Without it the maximum is unknown (the project token cannot read it; only a refused create reports it), so
# every shard is launched (or --parallel of them at a time) and a shard refused for quota ("quota refused" in its lane
# log) is queued again after the next shard finishes, up to three times.
#
# On exit it prints one row per shard (shard, cells, exit, trials, wall time of the run and of the VM, VM list price), the
# totals, and the merge command; the exit code is 0 only when every shard exited 0. An interrupt is forwarded to every
# shard, each of which copies its results back and destroys its VM before exiting. Needs UBICLOUD_API_KEY, UBI_OWNER,
# ANTHROPIC_API_KEY (and OPENAI_API_KEY for --embedded, PARTICLE_API_KEY for Particle cells) in the environment, python3 and
# bash 5.1 or later.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
runner=${UBI_RUNNER:-$here/ubi-runner.sh}
manifest="" max_vcpus=${UBI_MAX_VCPUS:-} parallel="" dry=0 workload=harness
while [ $# -gt 0 ]; do
  case "$1" in
    --manifest) manifest=$2; shift 2 ;;
    --max-vcpus) max_vcpus=$2; shift 2 ;;
    --parallel) parallel=$2; shift 2 ;;
    --dry-run) dry=1; shift ;;
    --workload) workload=$2; shift 2 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "fanout: unknown argument $1 (see --help)" >&2; exit 2 ;;
  esac
done
[ -n "$manifest" ] && [ -f "$manifest" ] || { echo "fanout: --manifest <file.json> is required" >&2; exit 2; }
case $workload in harness|gstack-laneb) ;; *) echo "fanout: --workload must be harness or gstack-laneb" >&2; exit 2 ;; esac
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
export TZ=UTC
log() { printf '%(%Y-%m-%dT%H:%M:%SZ)T fanout: %s\n' -1 "$*" >&2; }

# The manifest, flattened: header fields, then one tab-separated line per shard.
mapfile -t head < <(python3 - "$manifest" <<'PY'
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
print(' '.join(shlex.quote(o) for o in m.get('options', [])))
for s in m['shards']:
    for k in ('name', 'cells', 'lease_usd'):
        if k not in s: sys.exit(f"fanout: shard {s.get('name', '?')} lacks {k}")
    print(f"{s['name']}\t{s['cells']}\t{s['lease_usd']}")
PY
)
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
  local name=$1 cells=$2 lease=$3
  printf '%s --commit %s --prereg %s --name %s --cells %s --lease-usd %s --dest %s --size %s %s' "$here/run-shard.sh" "$(printf %q "$commit")" "$(printf %q "$prereg")" "$(printf %q "$name")" "$(printf %q "$cells")" "$(printf %q "$lease")" "$(printf %q "$dest/$name")" "$(printf %q "$size")" "${sealed:+$sealed }$([ "$workload" = harness ] || printf -- '--workload %s ' "$workload")$options"
}
merge_cmd() { printf 'bun scripts/merge-shards.ts --out <merged results dir>'; local line name; for line in "${shards[@]}"; do IFS=$'\t' read -r name _ _ <<<"$line"; printf ' --shard %s=%s/%s/results' "$name" "$dest" "$name"; done; echo; }
if [ "$dry" -eq 1 ]; then
  for line in "${shards[@]}"; do IFS=$'\t' read -r name cells lease <<<"$line"; echo "$(run_cmd "$name" "$cells" "$lease") > $dest/$name/fanout.log 2>&1 &"; done
  echo "then: $(merge_cmd)"
  exit 0
fi

mkdir -p "$dest"
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
  local line=$1 name cells lease
  IFS=$'\t' read -r name cells lease <<<"$line"
  mkdir -p "$dest/$name"
  tries_of[$name]=$(( ${tries_of[$name]:-0} + 1 ))
  log_start[$name]=$(stat -c %s "$dest/$name/lane.log" 2>/dev/null || echo 0)
  log "launching shard $name (cells $cells, lease \$$lease, try ${tries_of[$name]}); log $dest/$name/fanout.log"
  bash -c "$(run_cmd "$name" "$cells" "$lease")" > "$dest/$name/fanout.log" 2>&1 &
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
  IFS=$'\t' read -r name cells lease <<<"$line"
  if [ "$rc" -eq 3 ] && [ "$stopping" -eq 0 ] && tail -c +$(( ${log_start[$name]:-0} + 1 )) "$dest/$name/lane.log" 2>/dev/null | grep -q 'quota refused' && [ "${tries_of[$name]}" -lt 3 ]; then
    log "shard $name was refused for vCPU quota; queued again (after the next shard finishes)"
    queue+=("$line"); [ "$running" -gt 0 ] || sleep 60
    continue
  fi
  exit_of[$name]=$rc
  log "shard $name exited $rc"
done
if [ "$stopping" -eq 1 ]; then for line in "${queue[@]}"; do IFS=$'\t' read -r name _ _ <<<"$line"; exit_of[$name]=interrupted; done; fi

# The table, from each shard's shard-vm.json and trials.jsonl.
python3 - "$dest" "$(( $(date +%s) - t0 ))" "${shards[@]}" <<'PY'
import json, os, sys
dest, wall, *shards = sys.argv[1:]
def fmt(s):
    if s is None: return '?'
    s = int(s); return f'{s // 3600}h{s % 3600 // 60:02d}m' if s >= 3600 else f'{s // 60}m{s % 60:02d}s'
hdr = ('shard', 'cells', 'exit', 'trials', 'run', 'vm life', 'size', 'vm cost')
rows = []; total_cost = 0.0; total_trials = 0; bad = 0
for line in shards:
    name, cells, lease = line.split('\t')
    d = os.path.join(dest, name)
    p = os.path.join(d, 'shard-vm.json')
    vm = json.load(open(p)) if os.path.exists(p) else {}
    tp = os.path.join(d, 'results', 'trials.jsonl')
    trials = sum(1 for _ in open(tp)) if os.path.exists(tp) else 0
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
print('total: %d shard(s), %d trials, %d not exit 0, VM list price $%.4f, fan-out wall time %s' % (len(rows), total_trials, bad, total_cost, fmt(wall)))
PY
echo "merge: $(merge_cmd)"
for name in "${!exit_of[@]}"; do [ "${exit_of[$name]}" = 0 ] || exit 1; done
[ ${#exit_of[@]} -eq "$n" ] || exit 1
exit 0
