"""The stage ledger for --workload qm-driver: every lease launched for one (run id, stage), whatever its dest.

<replicate-to>/stage-ledger.jsonl is append-only and lives in the run's replica folder, which outlives the controller
(CREW R16). Each line names the run id (the preregistration's run_id at the launch commit), the stage (the workload's
--stage), the shard's dest (its real path, so a relative or symlinked dest names the same shard) and the lease. fanout.sh appends one reservation per shard before its first launch, and
run-shard.sh appends one per launch, plus its own reservation first when no fan-out reserved one. The stage cap is the
preregistration's caps_usd entry for that stage, and it is checked against the sum of that (run id, stage)'s lines, so a
split dest or a one-off run-shard.sh relaunch counts against the same cap. A reservation and the launch that used it count
once, and a --resume line continues its shard's lease and adds nothing. Writers hold <replicate-to>/.stage-ledger.lock.

fanout.sh imports it; run-shard.sh runs it:
  stage_ledger.py launch <repo root> <commit> <prereg> <replicate-to> <dest> <lease> <resume 0|1> <reservation or ""> [workload args]
      checks before any VM call and prints the reservation the launch carries (nothing for a --resume)
  stage_ledger.py record <repo root> <commit> <prereg> <replicate-to> <dest> <lease> <resume 0|1> <reservation or ""> <launched_at> <vm> [workload args]
"""
import fcntl, json, os, subprocess, sys, time

LEDGER, LOCK = 'stage-ledger.jsonl', '.stage-ledger.lock'


def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0


def prereg(root, commit, path, who):
    """The preregistration at the commit, or a scratch file when the path is not in the repository there."""
    r = subprocess.run(['git', '-C', root, 'show', commit + ':' + path], capture_output=True, text=True)
    try:
        if r.returncode == 0: return json.loads(r.stdout)
        if os.path.isfile(path): return json.load(open(path))
    except ValueError:
        sys.exit('%s: the preregistration %s is not readable JSON, so the stage cap cannot be read' % (who, path))
    sys.exit('%s: %s is neither a path in the repository at %s nor a readable file, so the stage cap cannot be read' % (who, path, commit))


def stage_of(args):
    """The value after --stage in a workload's arguments, or None."""
    return args[args.index('--stage') + 1] if '--stage' in args[:-1] else None


def stage_cap(design, stage, path, who):
    cap = (design.get('caps_usd') or {}).get(stage)
    if not num(cap): sys.exit('%s: the preregistration %s has no caps_usd entry for --stage %s, so there is no stage cap to check' % (who, path, stage))
    return cap


def lock(rep, who, when):
    f = open(os.path.join(rep, LOCK), 'a')
    wait = float(os.environ.get('UBI_STAGE_LOCK_SECONDS') or 300)
    t0 = time.time()
    while True:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return f
        except BlockingIOError:
            if time.time() - t0 >= wait: sys.exit('%s: refused %s: another launch holds the stage ledger lock %s after %gs' % (who, when, os.path.join(rep, LOCK), wait))
            time.sleep(0.5)


def units(rep, run_id, stage, who, when):
    """{shard dest: {reservation: lease}} for the run id and stage, in ledger order; --resume lines add nothing."""
    p = os.path.join(rep, LEDGER)
    out = {}
    if not os.path.isfile(p): return out
    for i, line in enumerate(open(p), 1):
        if not line.strip(): continue
        try:
            e = json.loads(line)
            lease = float(e['lease_usd'])
        except (ValueError, TypeError, KeyError, AttributeError):
            sys.exit('%s: refused %s: %s line %d is unreadable, so its lease cannot be counted against the stage cap' % (who, when, p, i))
        if e.get('run_id') != run_id or e.get('stage') != stage or e.get('resume'): continue
        d = out.setdefault(e.get('dest') or '?', {})
        k = e.get('reservation') or 'line %d' % i
        d[k] = max(d.get(k, 0.0), lease)
    return out


def append(rep, row):
    with open(os.path.join(rep, LEDGER), 'a') as f: f.write(json.dumps(row) + '\n')


def over(who, when, run_id, stage, rep, total, u, cap):
    """Exit 2 with the refusal when total plus every earlier lease of the stage passes its cap."""
    spent = sum(sum(d.values()) for d in u.values())
    if total + spent <= cap + 1e-9: return
    prior = ' plus $%g launched earlier (%s)' % (spent, ', '.join(k for k, d in u.items() if d)) if spent else ''
    sys.exit('%s: refused %s: the leases sum to $%g%s for run %s stage %s in %s, above the preregistered stage cap of $%g (caps_usd.%s)' % (who, when, total, prior, run_id, stage, os.path.join(rep, LEDGER), cap, stage))


def main(argv):
    who, when = 'run-shard (ubicloud)', 'before any VM call'
    mode, root, commit, path, rep, dest, lease, resume, rid = argv[:9]
    dest, rest = os.path.realpath(dest), argv[9:]
    launched_at = vm = None
    if mode == 'record': launched_at, vm, rest = rest[0], rest[1], rest[2:]
    design = prereg(root, commit, path, who)
    stage = stage_of(rest)
    if stage is None: sys.exit('%s: a qm-driver shard needs --stage among its workload arguments (after --), so its stage cap can be checked' % who)
    cap, run_id, lease, resume = stage_cap(design, stage, path, who), design['run_id'], float(lease), resume == '1'
    row = {'run_id': run_id, 'stage': stage, 'dest': dest, 'lease_usd': lease, 'resume': resume}
    if mode == 'record':
        append(rep, dict(row, launched_at=launched_at, vm=vm, by='run-shard.sh', **({'reservation': rid} if rid else {})))
        return
    held = lock(rep, who, when)
    u = units(rep, run_id, stage, who, when)
    if resume: return
    if rid:
        if u.get(dest, {}).get(rid, 0.0) + 1e-9 < lease:
            sys.exit('%s: refused %s: UBI_LEASE_RESERVATION %s is not a reservation of $%g or more for %s in %s (run %s stage %s)' % (who, when, rid, lease, dest, os.path.join(rep, LEDGER), run_id, stage))
        print(rid)
        return
    over(who, when, run_id, stage, rep, lease, u, cap)
    stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    rid = '%s-%d-%s' % (stamp, os.getpid(), os.path.basename(dest))
    append(rep, dict(row, reservation=rid, reserved_at=stamp, by='run-shard.sh'))
    held.close()
    print(rid)


if __name__ == '__main__':
    main(sys.argv[1:])
