#!/usr/bin/env bash
# Fan a sharded run out to Ubicloud: one scripts/ubicloud/run-shard.sh (one VM) per shard, all in parallel, from one
# manifest (docs/ubicloud.md). One command starts a twelve-cell run.
#
#   scripts/ubicloud/fanout.sh --manifest <file.json> [--max-vcpus N] [--parallel N] [--dry-run]
#       [--workload harness|gstack-laneb|qm-driver|frontier-harbor] [--replicate-to <dir>] [--replicate-seconds 1200]
#
# The manifest is JSON:
#   { "commit": "<sha>", "prereg": "docs/benchmarks/<run>/prereg.json", "dest": "<local results root>",
#     "size": "standard-16", "options": ["--gbrain-image", "harness-eval/gbrain:dev"],
#     "shards": [ { "name": "oc-a", "cells": "cell-1,cell-2", "lease_usd": 5 }, ... ] }
# size and options are optional; options go to every run-shard.sh as given (--embedded, --gbrain-image, --amendment,
# --smoke-lease-usd, --smoke-task, --smoke-first-cell, --no-smoke, --resume, --incremental-pull, or "--" followed by arguments for the
# repository's run-shard.sh).
# A shard may add "args": [...], passed after options and a "--" (added when options has none) to its run-shard.sh only,
# so they reach the shard's workload as given.
# "stage_cap_usd": <n> (required for --workload qm-driver) is the preregistered cap of the stage the shards run. The shards'
# lease_usd values, plus every lease the shards of the same dest ever started (each <dest>/<shard>/leases.jsonl, append-only;
# a shard named here and relaunched with --resume counts once), must sum to at most the cap, or the fan-out exits 2 before
# any VM call, the quota read included. So a canary and the rest of a stage go to the same dest. Before the first launch it
# checks again under a lock on <dest>/.stage-cap.lock and reserves each shard's lease (stage_cap below). For --workload
# qm-driver, stage_cap_usd must equal the preregistration's caps_usd entry for the --stage that every shard's args name (a
# shard without --stage, or shards that disagree, exit 2), --replicate-to is required, and the same leases must also fit
# under the stage ledger <replicate-to>/stage-ledger.jsonl (stage_ledger.py), which counts every lease launched for the
# preregistration's run_id and that stage from any dest, by fanout.sh or a one-off run-shard.sh.
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
# --workload frontier-harbor passes the same flag: each shard runs scripts/frontier-harbor/vm-run.sh on its VM after the
# keyless install check as its smoke; a shard's "args" reach vm-run.sh (--stage <name>, --done <file>). The task source
# follows the preregistration: a task_list naming a second source's pin (pin-swe-rebench-07-2026.json) makes vm-shard.sh
# pass vm-run.sh --tasks-src, which fetches that source's pinned tasks on the VM. Put
# --install-check in options for the keyless install check alone (prereg scripts/frontier-harbor/install-check-prereg.json,
# or a file whose every cell is one of its cells, such as a run's own install check; no key needed or sent); its shard "args" then reach install-check.sh (--baselines all runs oracle and nop on every pinned
# task). Its records are vm-run.sh's trials.jsonl, which merge-shards.ts does not read, so the end prints
# the results directories.
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
# The launch check: a counted manifest (harness or frontier-harbor, a prereg in this repository at the commit, no
# --install-check) launches a shard only when <dest>/<name>/launch-preflight.json (scripts/launch-preflight.ts) ran at the
# manifest's commit for that shard, says pass or overridden, and is under an hour old; checked for every shard before any VM
# call (exit 2) and for each shard again as it launches (exit launch-check in the table). launch_check below has the rule.
#
# Quota: shards launch in batches. Each batch reads ubi-runner.sh usage once and launches at most
# floor((UBI_QUOTA_VCPUS - used) / VM vCPUs) shards (464 unless the caller sets UBI_QUOTA_VCPUS), and with --max-vcpus (or
# UBI_MAX_VCPUS), this fan-out's own vCPU allowance, only as many as keep its running VMs within it; --parallel caps it too.
# The runner's per-VM preflight is no lock (shards started together read the same usage), so the batch size is what keeps
# the project under the limit. An unreadable usage launches nothing. When nothing fits and no shard is running, the
# fan-out is refused (exit 3) before any launch, or with UBI_QUOTA_WAIT=<seconds> reads usage again every 60 s for that
# long and then reports the shards it never launched. A shard refused for quota ("quota refused", or "quota preflight refused" when its
# VM would take the project past UBI_QUOTA_VCPUS, in its lane log) or whose VM never left "waiting for capacity" ("did not reach running" in its lane
# log) is queued again after the next shard finishes, up to three times. A shard whose lane log for that try also says
# "failed to destroy" is not queued again: its VM may still be running, so it keeps its failing exit.
#
# On exit it prints one row per shard (shard, cells, exit, trials, wall time of the run and of the VM, VM list price), one
# "kept:" line per shard whose VM was left running (run-shard.sh kept it after a failed final pull, or its down failed:
# shard, VM, reason, cleanup-pending path, recovery), the totals with the kept count, and the merge command; the exit code
# is 0 only when every shard exited 0 and no VM was kept. An interrupt is forwarded to every
# shard, each of which copies its results back and destroys its VM before exiting. Needs UBICLOUD_API_KEY, UBI_OWNER,
# ANTHROPIC_API_KEY (and OPENAI_API_KEY for --embedded, PARTICLE_API_KEY for Particle cells, OPENROUTER_API_KEY for OpenRouter cells) in the environment, python3 and
# bash 5.1 or later.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
runner=${UBI_RUNNER:-$here/ubi-runner.sh}
# Eval fan-outs leave 48 of the shared project's 512 vCPUs free for merge checks and release canaries (org rule R15,
# 2026-11-16): ubi-runner.sh's quota preflight refuses a VM that would take the project past UBI_QUOTA_VCPUS, and
# UBI_QUOTA_WAIT=<seconds> waits for room instead. A caller's own value wins.
export UBI_QUOTA_VCPUS=${UBI_QUOTA_VCPUS:-464}
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
case $workload in harness|gstack-laneb|qm-driver|frontier-harbor) ;; *) echo "fanout: --workload must be harness, gstack-laneb, qm-driver or frontier-harbor" >&2; exit 2 ;; esac
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
# "<shard><TAB><reservation>" lines, so two fan-outs on one dest cannot spend the same budget. "release <dest> <shard>
# <reservation> ..." runs at the end for the shards that never launched: each reservation no launch line names gets a
# released line in leases.jsonl (and the stage ledger, with the run id, stage and dest of the ledger's reservation line, not
# of the manifest as it reads by then), which drops it from the sum, and the shard is printed. Under qm-driver a reservation
# the stage ledger cannot be read for, or has no line for, is not released in either ledger.
stage_cap() {
  python3 - "$manifest" "$workload" "$1" "$rep_to" "$here" "${@:2}" <<'PY'
import fcntl, json, os, sys, time
workload, mode, rep_to, here = sys.argv[2:6]
if mode == 'release':
    dest, stamp, booked = sys.argv[6], time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), None
    if workload == 'qm-driver':
        sys.path.insert(0, here); sys.dont_write_bytecode = True
        import stage_ledger as sl
        try: booked = sl.reservations(os.path.abspath(rep_to))
        except OSError as e: booked = e
    for name, rid in zip(sys.argv[7::2], sys.argv[8::2]):
        p = os.path.join(dest, name, 'leases.jsonl')
        try: rows = [json.loads(l) for l in open(p) if l.strip()]
        except (OSError, ValueError): continue
        mine = [e for e in rows if isinstance(e, dict) and e.get('reservation') == rid]
        if not mine or any(e.get('launched_at') or e.get('released') for e in mine): continue
        row = {'reservation': rid, 'lease_usd': mine[0].get('lease_usd'), 'released': True, 'released_at': stamp, 'by': 'fanout.sh', 'resume': False}
        try:
            if isinstance(booked, OSError): raise booked
            if booked is not None:
                b = booked.get(rid)
                if not b:
                    print('fanout: the stage ledger in %s has no reservation line %s for %s, so its reservation is not released; %s still counts it' % (rep_to, rid, name, p), file=sys.stderr)
                    continue
                sl.append(os.path.abspath(rep_to), dict(row, run_id=b.get('run_id'), stage=b.get('stage'), dest=b.get('dest')))
            with open(p, 'a') as f: f.write(json.dumps(row) + '\n')
        except OSError as e:
            print('fanout: releasing the reservation of %s failed (%s); %s still counts it, and so does the stage ledger unless its line was written' % (name, e, p), file=sys.stderr)
            continue
        print(name)
    sys.exit(0)
m = json.load(open(sys.argv[1]))
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
        units, released = {}, set()
        for i, line in enumerate(open(p), 1):
            if not line.strip(): continue
            try:
                e = json.loads(line)
                lease = float(e.get('lease_usd') or 0)
            except (ValueError, TypeError, AttributeError):
                sys.exit('fanout: refused %s: %s line %d is unreadable, so its lease cannot be counted against stage_cap_usd' % (when, p, i))
            if e.get('resume'): continue
            k = e.get('reservation') or 'line %d' % i
            if e.get('released'): released.add(k); continue
            units[k] = max(units.get(k, 0.0), lease)
        return [v for k, v in units.items() if k not in released]
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
# qm-driver: stage_cap_usd must be the preregistration's caps_usd entry for the one --stage every shard runs, and the
# stage ledger in the replica folder (stage_ledger.py) sums every lease of that run id and stage, whatever its dest.
if workload == 'qm-driver':
    sys.path.insert(0, here); sys.dont_write_bytecode = True
    import stage_ledger as sl
    if not rep_to: sys.exit('fanout: --workload qm-driver needs --replicate-to (or UBI_REPLICATE_TO): the stage ledger, which counts every launch of a stage whatever its dest, lives there')
    rep = os.path.abspath(rep_to)
    design = sl.prereg(os.path.dirname(os.path.dirname(here)), m['commit'], m['prereg'], 'fanout')
    stages = {sl.stage_of(s.get('args') or []) for s in shards}
    if None in stages: sys.exit('fanout: every qm-driver shard needs --stage in its args, so the stage cap can be checked')
    if len(stages) > 1: sys.exit('fanout: the shards disagree on --stage (%s); one fan-out runs one stage' % ', '.join(sorted(stages)))
    stage = stages.pop()
    pre = sl.stage_cap(design, stage, m['prereg'], 'fanout')
    if abs(cap - pre) > 1e-9: sys.exit('fanout: stage_cap_usd $%g is not the preregistered cap of --stage %s, caps_usd.%s = $%g in %s' % (cap, stage, stage, pre, m['prereg']))
    if mode == 'reserve': held = sl.lock(rep, 'fanout', when)
    u = sl.units(rep, design['run_id'], stage, 'fanout', when)
    if resume:
        for n in names:
            d = u.get(os.path.realpath(os.path.join(dest, n)), {})
            if d: d.pop(list(d)[-1])
    sl.over('fanout', when, design['run_id'], stage, rep, total, u, cap)
if mode == 'reserve' and not resume:
    stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    for s in shards:
        rid = '%s-%d-%s' % (stamp, os.getpid(), s['name'])
        os.makedirs(os.path.join(dest, s['name']), exist_ok=True)
        with open(os.path.join(dest, s['name'], 'leases.jsonl'), 'a') as f:
            f.write(json.dumps({'reservation': rid, 'lease_usd': s['lease_usd'], 'reserved_at': stamp, 'by': 'fanout.sh', 'resume': False}) + '\n')
        if workload == 'qm-driver':
            sl.append(rep, {'run_id': design['run_id'], 'stage': stage, 'dest': os.path.realpath(os.path.join(dest, s['name'])), 'lease_usd': s['lease_usd'], 'resume': False, 'reservation': rid, 'reserved_at': stamp, 'by': 'fanout.sh'})
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
# The launch check (internal-task): a counted manifest launches only shards whose <dest>/<shard>/launch-preflight.json, written by
# scripts/launch-preflight.ts --manifest <this manifest> --shard <shard> --dest <dest>/<shard>, ran at the manifest's commit for
# that shard (its run id, cells, lease_usd and Gemini CLI route as the prereg and the manifest give them now), has verdict pass or overridden,
# and is under an hour old (UBI_LAUNCH_CHECK_SECONDS, 3600), so the spend stop,
# the pilot prices and the providers' credit were checked just before the spend starts. Counted means the harness or
# frontier-harbor workload with a prereg that is a path in this repository at the commit (run-shard.sh's rule; a scratch
# preregistration is an uncounted smoke or check) and no --install-check (keyless). It runs once for every shard before any
# VM call, the quota read included (a fetch of a missing commit waits at most UBI_LAUNCH_FETCH_SECONDS, 120), and again for
# each shard as it launches, so a shard that waited for room past the hour is
# not launched (its exit is launch-check). Other workloads' cells are not preregistration cells, which the check cannot read.
launch_check() {
  python3 - "$manifest" "$workload" "$here" "$@" <<'PY'
import datetime, json, os, subprocess, sys
m = json.load(open(sys.argv[1])); workload, here, names = sys.argv[2], sys.argv[3], sys.argv[4:]
root = os.path.dirname(os.path.dirname(here))
git = lambda *a: subprocess.run(['git', '-C', root, *a], capture_output=True, text=True)
if workload not in ('harness', 'frontier-harbor') or '--install-check' in m.get('options', []) or git('rev-parse', '--is-inside-work-tree').returncode != 0:
    sys.exit(0)
full = git('rev-parse', '--verify', '--quiet', m['commit'] + '^{commit}').stdout.strip()
if not full:
    try: subprocess.run(['git', '-C', root, 'fetch', '-q', 'origin', m['commit']], capture_output=True, timeout=int(os.environ.get('UBI_LAUNCH_FETCH_SECONDS') or 120))
    except subprocess.TimeoutExpired: print('fanout: fetching %s for the launch check timed out' % m['commit'], file=sys.stderr)
    full = git('rev-parse', '--verify', '--quiet', m['commit'] + '^{commit}').stdout.strip()
if not full:
    if not names: print('fanout: launch check skipped: commit %s is not in this repository and could not be fetched; run-shard.sh refuses every shard for that before any VM call' % m['commit'], file=sys.stderr)
    sys.exit(0)
if git('cat-file', '-e', full + ':' + m['prereg']).returncode != 0:
    if not names: print('fanout: launch check skipped: %s is not a path in the repository at %s, so this is a scratch (uncounted) run' % (m['prereg'], full[:12]), file=sys.stderr)
    sys.exit(0)
limit = int(os.environ.get('UBI_LAUNCH_CHECK_SECONDS') or 3600)
try: run_id = json.loads(git('show', full + ':' + m['prereg']).stdout).get('run_id')
except (ValueError, AttributeError): run_id = None
planned = {sh['name']: sh for sh in m['shards']}
cells = lambda c: [x.strip() for x in (c if isinstance(c, list) else str(c or '').split(',')) if x.strip()]
opts = m.get('options', [])
def route(sh):
    extra = (opts[opts.index('--') + 1:] if '--' in opts else []) + list(sh.get('args') or [])
    i = len(extra) - 1 - extra[::-1].index('--gemini-cli-route') if '--gemini-cli-route' in extra else -1
    return extra[i + 1] if 0 <= i < len(extra) - 1 else ('' if i >= 0 else 'native')
now = datetime.datetime.now(datetime.timezone.utc)
dest = os.path.expanduser(m['dest'])
bad = []
for name in names or [s['name'] for s in m['shards']]:
    p = os.path.join(dest, name, 'launch-preflight.json')
    try: r = json.load(open(p))
    except FileNotFoundError: bad.append('%s: no %s' % (name, p)); continue
    except ValueError: bad.append('%s: %s is not JSON' % (name, p)); continue
    try: age = (now - datetime.datetime.fromisoformat(str(r.get('at')).replace('Z', '+00:00'))).total_seconds()
    except ValueError: age = None
    why = [w for w in (
        r.get('schema') != 'launch-preflight/1' and 'schema %r, not launch-preflight/1' % r.get('schema'),
        r.get('commit') != full and 'ran at commit %s, not the manifest\'s %s' % (str(r.get('commit'))[:12], full[:12]),
        (r.get('shard') or {}).get('name') != name and 'checked shard %r, not %s' % ((r.get('shard') or {}).get('name'), name),
        r.get('run_id') != run_id and 'checked run %r, not the prereg\'s %r' % (r.get('run_id'), run_id),
        cells((r.get('shard') or {}).get('cells')) != cells((planned.get(name) or {}).get('cells')) and 'checked cells %s, not the manifest\'s %s' % (','.join(cells((r.get('shard') or {}).get('cells'))), ','.join(cells((planned.get(name) or {}).get('cells')))),
        (r.get('shard') or {}).get('gemini_cli_route', 'native') != route(planned.get(name) or {}) and 'checked Gemini CLI route %s, not the manifest\'s %s' % ((r.get('shard') or {}).get('gemini_cli_route', 'native'), route(planned.get(name) or {})),
        (r.get('shard') or {}).get('lease_usd') != (planned.get(name) or {}).get('lease_usd') and 'checked a lease of %r, not the manifest\'s %r' % ((r.get('shard') or {}).get('lease_usd'), (planned.get(name) or {}).get('lease_usd')),
        r.get('verdict') not in ('pass', 'overridden') and 'verdict %s' % r.get('verdict'),
        age is None and 'its time %r is unreadable' % r.get('at'),
        age is not None and age > limit and 'it is %d minutes old (limit %d)' % (age // 60, limit // 60),
        age is not None and age < -300 and 'its time %s is in the future' % r.get('at'),
    ) if w]
    if why: bad.append('%s: %s (%s)' % (name, '; '.join(why), p))
if bad:
    sys.exit('fanout: refused %s: a counted shard launches only on a passing launch check at commit %s from the last hour (internal-task):\n  %s\nRun it for each shard on the machine that holds the provider keys, from a checkout at that commit, then launch within the hour: bun scripts/launch-preflight.ts <plan folder> --manifest %s --shard <shard> --dest %s/<shard> --ledger <every pilot and counted ledger> --pilot <pilot results> (docs/ubicloud.md, docs/cost-projection.md)' % (
        'shard ' + names[0] if names else 'before any VM call', full[:12], '\n  '.join(bad), sys.argv[1], dest))
PY
}
launch_check || exit 2
mapfile -t head <<<"$flat"
commit=${head[0]} prereg=${head[1]} dest=${head[2]} size=${head[3]} options=${head[4]}
shards=("${head[@]:5}")
n=${#shards[@]}
case $size in standard-2) per=2 ;; standard-4) per=4 ;; standard-8) per=8 ;; standard-16) per=16 ;; standard-30) per=30 ;; standard-60) per=60 ;; *) per=16 ;; esac
needed=$(( n * per ))

# Quota: the runner's per-VM preflight is no lock (shards started together all read the same usage and all pass it), so
# each batch reads ubi-runner.sh usage once (its last line is "total <vms> <vcpus>") and launches at most
# floor((UBI_QUOTA_VCPUS - used) / per) shards, and with --max-vcpus only as many as keep this fan-out's own VMs within it.
[[ "$UBI_QUOTA_VCPUS" =~ ^[0-9]+$ ]] || { echo "fanout: UBI_QUOTA_VCPUS must be a whole number of vCPUs" >&2; exit 2; }
[ -z "$max_vcpus" ] || [[ "$max_vcpus" =~ ^[0-9]+$ ]] || { echo "fanout: --max-vcpus must be a whole number of vCPUs" >&2; exit 2; }
room_wait=${UBI_QUOTA_WAIT:-0}
[[ "$room_wait" =~ ^[0-9]+$ ]] || { echo "fanout: UBI_QUOTA_WAIT must be a whole number of seconds" >&2; exit 2; }
parallel=${parallel:-$n}
[ "$parallel" -gt "$n" ] && parallel=$n
running=0
queue=()
# batch_room: how many queued shards this batch may launch, from one usage read. An unreadable usage launches none. Usage
# lists a shard only once its VM exists, so a running shard whose shard-vm.json has no created_epoch from this try still
# holds a VM's worth of room.
batch_room() {
  local usage used room k allow pending=0 p name created
  usage=$(bash "$runner" usage 2>/dev/null) || usage=""
  used=$(awk '$1=="total" {print $3}' <<<"$usage")
  if ! [[ "$used" =~ ^[0-9]+$ ]]; then log "batch: the project's vCPU usage is unreadable, so no VM launches this batch"; echo 0; return; fi
  if [ "$running" -gt 0 ]; then
    for p in "${!pid_of[@]}"; do
      IFS=$'\t' read -r name _ <<<"${pid_of[$p]}"
      created=$(grep -oE '"created_epoch": *[0-9]+' "$dest/$name/shard-vm.json" 2>/dev/null | grep -oE '[0-9]+$' || true)
      [ "${created:-0}" -ge "${launched_of[$name]}" ] || pending=$(( pending + 1 ))
    done
  fi
  room=$(( (UBI_QUOTA_VCPUS - used) / per - pending )); [ "$room" -gt 0 ] || room=0
  k=$(( parallel - running )); [ "$room" -ge "$k" ] || k=$room
  if [ -n "$max_vcpus" ]; then allow=$(( max_vcpus / per - running )); [ "$allow" -ge "$k" ] || k=$allow; fi
  [ "${#queue[@]}" -ge "$k" ] || k=${#queue[@]}
  [ "$k" -gt 0 ] || k=0
  log "batch: the project uses $used of $UBI_QUOTA_VCPUS vCPUs, room for $room $size VM(s)$([ "$pending" -eq 0 ] || echo " after $pending launched shard(s) with no VM yet")${max_vcpus:+; this fan-out runs $running of the $(( max_vcpus / per )) its $max_vcpus vCPUs allow}; launching $k of ${#queue[@]} queued"
  echo "$k"
}
log "$n shard(s) on $size: $needed vCPUs needed; each batch launches only what fits under $UBI_QUOTA_VCPUS project vCPUs${max_vcpus:+ and the $max_vcpus allowed for this fan-out}"
bash "$runner" usage 2>/dev/null | sed 's/^/  /' >&2 || true
if [ -n "$max_vcpus" ] && [ "$max_vcpus" -lt "$per" ]; then echo "fanout: refused: --max-vcpus $max_vcpus is less than one $size VM ($per vCPUs)" >&2; exit 3; fi
if [ "$room_wait" -eq 0 ]; then
  queue=("${shards[@]}")
  if [ "$(batch_room)" -lt 1 ]; then echo "fanout: refused: not one $size VM fits under $UBI_QUOTA_VCPUS project vCPUs now (or usage is unreadable); wait for VMs to finish, set UBI_QUOTA_WAIT=<seconds> to wait for room, or use a smaller size" >&2; exit 3; fi
fi

run_cmd() {
  local name=$1 cells=$2 lease=$3 sargs=${4:-}
  printf '%s --commit %s --prereg %s --name %s --cells %s --lease-usd %s --dest %s --size %s %s' "$here/run-shard.sh" "$(printf %q "$commit")" "$(printf %q "$prereg")" "$(printf %q "$name")" "$(printf %q "$cells")" "$(printf %q "$lease")" "$(printf %q "$dest/$name")" "$(printf %q "$size")" "${sealed:+$sealed }$([ "$workload" = harness ] || printf -- '--workload %s ' "$workload")$([ -z "$rep_to" ] || printf -- '--replicate-to %q ' "$rep_to")$([ -z "$rep_s" ] || printf -- '--replicate-seconds %s ' "$rep_s")$options${sargs:+ $sargs}"
}
merge_cmd() { printf 'bun scripts/merge-shards.ts --out <merged results dir>'; local line name; for line in "${shards[@]}"; do IFS=$'\t' read -r name _ _ <<<"$line"; printf ' --shard %s=%s/%s/results' "$name" "$dest" "$name"; done; echo; }
# qm-driver results are turns.jsonl and frontier-harbor's are vm-run.sh's trials.jsonl, neither of which merge-shards.ts
# reads, so those workloads get the results directories.
results_dirs() { local line name; for line in "${shards[@]}"; do IFS=$'\t' read -r name _ <<<"$line"; printf '%s/%s/results ' "$dest" "$name"; done; echo; }
if [ "$dry" -eq 1 ]; then
  for line in "${shards[@]}"; do IFS=$'\t' read -r name cells lease sargs <<<"$line"; echo "$(run_cmd "$name" "$cells" "$lease" "$sargs") > $dest/$name/fanout.log 2>&1 &"; done
  case $workload in qm-driver|frontier-harbor) echo "then: read $(results_dirs)" ;; *) echo "then: $(merge_cmd)" ;; esac
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
declare -A rid_of=() pid_of=() exit_of=() tries_of=() told=() log_start=() launched_of=()
queue=("${shards[@]}")
running=0
stopping=0
waited=0
# An interrupt usually comes as several signals (a cancelled operation or a closed terminal sends TERM, HUP and INT to the
# group): the first is logged once, and each shard gets one TERM, so a second never cuts into its copy-back and VM destroy.
# The trap goes in before the stage-cap reservations are written: an interrupt while they are being written then waits for
# them, launches nothing, records every shard as interrupted and ends with the table and exit 1, instead of killing the
# fan-out with its shards' reservations on disk and no record that none of them launched.
on_signal() {
  local p
  [ "$stopping" = 1 ] || log "interrupted: forwarding to ${#pid_of[@]} shard process(es); each copies its results back and destroys its VM"
  stopping=1
  for p in "${!pid_of[@]}"; do [ -n "${told[$p]:-}" ] || { told[$p]=1; kill -TERM "$p" 2>/dev/null || true; }; done
}
trap on_signal INT TERM HUP QUIT
reservations=$(stage_cap reserve) || exit 2
while IFS=$'\t' read -r rname rid; do [ -z "$rname" ] || rid_of[$rname]=$rid; done <<<"$reservations"
t0=$(date +%s)
launch() {
  local line=$1 name cells lease sargs
  IFS=$'\t' read -r name cells lease sargs <<<"$line"
  if ! launch_check "$name"; then exit_of[$name]=launch-check; log "shard $name not launched: its launch check is missing, failed or stale (above)"; return 0; fi
  # An interrupt during the check launches nothing more, and one that lands before the new shard is in pid_of still reaches it.
  if [ "$stopping" -eq 1 ]; then exit_of[$name]=interrupted; return 0; fi
  mkdir -p "$dest/$name"
  tries_of[$name]=$(( ${tries_of[$name]:-0} + 1 ))
  log_start[$name]=$(stat -c %s "$dest/$name/lane.log" 2>/dev/null || echo 0)
  launched_of[$name]=$(date +%s)
  log "launching shard $name (cells $cells, lease \$$lease, try ${tries_of[$name]}); log $dest/$name/fanout.log"
  UBI_LEASE_RESERVATION=${rid_of[$name]:-} bash -c "$(run_cmd "$name" "$cells" "$lease" "$sargs")" > "$dest/$name/fanout.log" 2>&1 &
  pid_of[$!]=$line
  running=$(( running + 1 ))
  if [ "$stopping" -eq 1 ] && [ -z "${told[$!]:-}" ]; then told[$!]=1; kill -TERM "$!" 2>/dev/null || true; fi
}
while [ ${#queue[@]} -gt 0 ] || [ "$running" -gt 0 ]; do
  if [ "$stopping" -eq 0 ] && [ ${#queue[@]} -gt 0 ] && [ "$running" -lt "$parallel" ]; then
    k=$(batch_room) || k=0
    if [ "$k" -eq 0 ] && [ "$running" -eq 0 ]; then
      if [ "$waited" -lt "$room_wait" ]; then sleep 60 || true; waited=$(( waited + 60 )); continue; fi
      log "no room for a $size VM and no shard running after ${waited}s of waiting; ${#queue[@]} shard(s) not launched"
      for line in "${queue[@]}"; do IFS=$'\t' read -r name _ <<<"$line"; exit_of[$name]=no-room; done
      queue=()
      break
    fi
    [ "$k" -eq 0 ] || waited=0
    for (( i = 0; i < k; i++ )); do [ "$stopping" -eq 0 ] || break; launch "${queue[0]}"; queue=("${queue[@]:1}"); sleep 2 || true; done
  fi
  # A batch whose shards were all refused by their launch check started nothing; the shards behind them still get a turn.
  if [ "$running" -eq 0 ]; then
    if [ "$stopping" -eq 0 ] && [ ${#queue[@]} -gt 0 ]; then continue; fi
    break
  fi
  done_pid=""
  set +e; wait -n -p done_pid "${!pid_of[@]}"; rc=$?; set -e
  [ -n "${done_pid:-}" ] || continue
  line=${pid_of[$done_pid]}; unset 'pid_of[$done_pid]'; running=$(( running - 1 ))
  IFS=$'\t' read -r name cells lease _ <<<"$line"
  try_log=$(tail -c +$(( ${log_start[$name]:-0} + 1 )) "$dest/$name/lane.log" 2>/dev/null || true)
  if [ "$rc" -eq 3 ] && [ "$stopping" -eq 0 ] && grep -qE 'quota refused|quota preflight refused|did not reach running in .*waiting for capacity' <<<"$try_log" && ! grep -q 'failed to destroy' <<<"$try_log" && [ "${tries_of[$name]}" -lt 3 ]; then
    log "shard $name was refused for vCPU quota or found no VM capacity; queued again (after the next shard finishes)"
    queue+=("$line"); [ "$running" -gt 0 ] || sleep 60 || true
    continue
  fi
  exit_of[$name]=$rc
  log "shard $name exited $rc"
done
if [ "$stopping" -eq 1 ]; then for line in "${queue[@]}"; do IFS=$'\t' read -r name _ _ <<<"$line"; exit_of[$name]=interrupted; done; fi
# A shard that never launched (left in the queue with no room, refused by its launch check, or by an interrupt) gives its
# stage-cap reservation back, so a relaunch is not refused over the cap with nothing spent; a shard that launched keeps it,
# even when it failed.
back=()
for name in "${!exit_of[@]}"; do case ${exit_of[$name]} in no-room|interrupted|launch-check) [ -z "${rid_of[$name]:-}" ] || back+=("$name" "${rid_of[$name]}") ;; esac; done
if [ ${#back[@]} -gt 0 ]; then
  freed=$(stage_cap release "$dest" "${back[@]}") || log "WARNING: the stage-cap reservations of the shards that never launched could not be released; they still count against the cap"
  [ -z "${freed:-}" ] || log "released the stage-cap reservation of $(paste -sd' ' - <<<"$freed"), which never launched"
fi

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
case $workload in qm-driver|frontier-harbor) echo "results: $(results_dirs)" ;; *) echo "merge: $(merge_cmd)" ;; esac
[ "$table_rc" -eq 0 ] || exit 1
for name in "${!exit_of[@]}"; do [ "${exit_of[$name]}" = 0 ] || exit 1; done
[ ${#exit_of[@]} -eq "$n" ] || exit 1
exit 0
