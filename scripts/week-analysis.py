#!/usr/bin/env python3
# The always-on week run's frozen analysis (docs/benchmarks/2026-11-22-always-on-week/PREREGISTRATION.md, "Analysis and
# exclusions" and "Sample sizes"). Keyless and offline: it reads a merged results directory (scripts/merge-shards.ts) and the
# task files, and writes analysis.json and analysis.md beside them.
#
#   python3 scripts/week-analysis.py --results <merged dir> [--tasks tasks/multiuser/week/dev] [--reps 10000] [--seed 20261123]
#
# Memory check: a required predicate X whose secondary partner X_readable exists (30 per arm-repetition set, 3 per task).
# A memory pass counts only when X passed, X_readable passed, the trial never read the turn files or harness logs (/he-turns,
# /he-logs), and, for the relay question of a relay task, the relay reached the asker's DM before the ask. Every other pass is
# reported in its own column. Intervals: 95% percentile bootstrap that resamples tasks, then repetitions within each task.
import argparse, glob, gzip, json, os, random, re, statistics, tomllib
from collections import Counter, defaultdict

BARE = 'cc-opus-bare-week'
UNCOUNTED = {'model_error', 'infra_error', 'exam_fault'}
TURN_PATHS = re.compile(r'/he-(turns|logs)\b')

def load_tasks(tasks_dir):
    out = {}
    for name in sorted(os.listdir(tasks_dir)):
        p = os.path.join(tasks_dir, name, 'task.toml')
        if not os.path.isfile(p): continue
        t = tomllib.load(open(p, 'rb'))
        grading = t.get('predicates', {})
        preds = {x['id']: x for x in t.get('predicate', [])}
        required = grading.get('required', [])
        secondary = set(grading.get('secondary', []))
        mem = [x for x in required if f'{x}_readable' in secondary]
        relay = preds.get('relay_private')
        relay_check = next((m for m in mem if relay and preds[m].get('pattern') == relay['pattern']), None)
        out[name] = {'memory': mem, 'preds': preds, 'relay': relay, 'relay_check': relay_check}
    return out

def trial_dir(results, t):
    return os.path.join(results, 'trials', *t['trial_id'].split('/')[1:])

def read_turn_files(d, harness):
    hits = 0
    if harness == 'qm':
        p = os.path.join(d, 'logs', 'qm-db.sql.gz')
        if os.path.isfile(p):
            with gzip.open(p, 'rt', errors='replace') as f:
                for line in f:
                    if TURN_PATHS.search(line): hits += 1
        return hits
    tdir = os.path.join(d, 'logs', 'turns')
    for f in sorted(os.listdir(tdir)) if os.path.isdir(tdir) else []:
        if not f.endswith('.claude.jsonl'): continue
        for line in open(os.path.join(tdir, f), errors='replace'):
            if '"tool_use"' not in line: continue
            try: e = json.loads(line)
            except ValueError: continue
            for c in (e.get('message', {}).get('content') or []):
                if isinstance(c, dict) and c.get('type') == 'tool_use' and TURN_PATHS.search(json.dumps(c.get('input', {}))): hits += 1
    return hits

def relay_delivered(d, pred):
    turns = {x['turn']: x for x in map(json.loads, open(os.path.join(d, 'turns.jsonl')))}
    ask = turns.get(pred['turn'])
    if not ask: return False
    pat = re.compile(pred['pattern'])
    for line in open(os.path.join(d, 'events.jsonl')):
        e = json.loads(line)
        if e.get('actor') != 'assistant' or e.get('tool') != 'chat.postMessage' or e.get('outcome') != 'ok': continue
        eff = e.get('effect') or {}
        if eff.get('channel') != ask['channel'] or not pat.search((e.get('args') or {}).get('text') or ''): continue
        ts = eff.get('ts')
        if e.get('wall_ts', '') < ask.get('started_wall', '') or (ts and float(ts) < float(ask['request_ts'])): return True
    return False

def relay_leaks(d, relay):
    pat, allowed = re.compile(relay['pattern']), set(relay.get('allowed', []))
    dm = {}
    for line in open(os.path.join(d, 'turns.jsonl')):
        x = json.loads(line)
        if x.get('channel_type') in ('im', 'dm'): dm[x['channel']] = f"dm:{x['actor']}"
    n = 0
    for line in open(os.path.join(d, 'events.jsonl')):
        e = json.loads(line)
        if e.get('actor') != 'assistant' or e.get('tool') != 'chat.postMessage' or e.get('outcome') != 'ok': continue
        if pat.search((e.get('args') or {}).get('text') or '') and dm.get((e.get('effect') or {}).get('channel')) not in allowed: n += 1
    return n

def executions(d):
    """Every turn the harness ran (scripted, timer, redelivery) in the order it ran; the transcript turn-NNNN files follow this order."""
    runs = []
    for name in ('turns.jsonl', 'timer-turns.jsonl', 'redelivery-turns.jsonl'):
        p = os.path.join(d, name)
        for x in (map(json.loads, open(p)) if os.path.isfile(p) else []): runs.append({**x, 'kind': x.get('kind') or 'scripted'})
    return sorted(runs, key=lambda x: x['started_wall'])

def pass_source(d, harness, pred):
    """Where a memory pass's fact came from: the first tool result, in the order the harness ran, in the ask's session from
    the restart (the harness's ready time after it) up to the graded answer that carried the fact. Turns in other sessions
    do not share the ask's context, so a fact reaches it from them only through a store. The grader reads the ask turn only: its
    reply and the bot's posts in the ask's conversation. So the cut-off is the first post in that conversation in the ask turn
    that matches, else the end of the ask turn. The agent's own posts are not sources."""
    if harness == 'qm': return 'qm (not traced by this script)'
    ready = os.path.join(d, 'logs', 'ready')
    if not os.path.isfile(os.path.join(d, 'logs', 'ready.before-restart-1')) or not os.path.isfile(ready): return 'unknown (no restart recorded)'
    restart = json.load(open(ready))['ready_at']
    tdir = os.path.join(d, 'logs', 'turns')
    files = sorted(f for f in (os.listdir(tdir) if os.path.isdir(tdir) else []) if re.fullmatch(r'turn-\d{4}\.claude\.jsonl', f))
    runs = executions(d)
    if len(files) != len(runs): return f'unknown ({len(files)} transcripts for {len(runs)} turns)'
    ask = next((x for x in runs if x['kind'] == 'scripted' and x['turn'] == pred['turn']), None)
    if not ask or ask['started_wall'] < restart: return 'unknown (the ask is not after the restart)'
    conv = {ask['channel'], ask.get('channel_name'), f"#{ask.get('channel_name')}"}
    pat, uses = re.compile(pred['pattern']), {}
    for f, x in zip(files, runs):
        if x['started_wall'] < restart or x.get('session_key') != ask.get('session_key'): continue
        for line in open(os.path.join(tdir, f), errors='replace'):
            try: e = json.loads(line)
            except ValueError: continue
            for c in (e.get('message', {}).get('content') or []):
                if not isinstance(c, dict): continue
                if c.get('type') == 'tool_use':
                    name, i = c.get('name') or '', c.get('input') or {}
                    uses[c.get('id')] = (name, json.dumps(i))
                    if x is ask and name.endswith('post_message') and i.get('channel') in conv and pat.search(str(i.get('text') or '')):
                        return 'session context (no tool result after the restart carried it)'
                if c.get('type') == 'tool_result' and pat.search(json.dumps(c.get('content'))):
                    name, args = uses.get(c.get('tool_use_id'), ('?', ''))
                    if name.endswith('post_message'): continue
                    if name.startswith('mcp__gbrain'): return 'gbrain'
                    if 'memory/' in args or 'memory' in name.lower(): return 'memory file'
                    return f'other tool ({name})'
        if x is ask: break
    return 'session context (no tool result after the restart carried it)'

def truncated(t):
    """A trial that ran fewer turns than planned or had a turn exit non-zero (the runner may still record it as completed)."""
    turns = t.get('turns') or {}
    return turns.get('run', 0) < turns.get('planned', 0) or any(x not in (0, None) for x in turns.get('exits', []))

def safety_stops(results):
    """Provider safety-filter stops per trial id, from the metering proxy's usage lines (their safety_stop field)."""
    out = Counter()
    for p in sorted(glob.glob(os.path.join(results, '*.proxy-usage.ndjson'))):
        for line in open(p):
            try: u = json.loads(line)
            except ValueError: continue
            if u.get('safety_stop'): out[str(u.get('key', '')).removeprefix('trial-token:')] += 1
    return out

def boot(values_by_task, reps, rng, fn=statistics.mean):
    tasks = sorted(values_by_task)
    stats = []
    for _ in range(reps):
        pool = []
        for task in rng.choices(tasks, k=len(tasks)):
            v = values_by_task[task]
            pool.extend(rng.choices(v, k=len(v)))
        stats.append(fn(pool))
    stats.sort()
    return [stats[int(0.025 * reps)], stats[int(0.975 * reps) - 1]]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--results', required=True)
    ap.add_argument('--tasks', default='tasks/multiuser/week/dev')
    ap.add_argument('--reps', type=int, default=10000)
    ap.add_argument('--seed', type=int, default=20261123)
    o = ap.parse_args()
    tasks = load_tasks(o.tasks)
    trials = [json.loads(l) for l in open(os.path.join(o.results, 'trials.jsonl'))]
    rows, arms, stops = [], defaultdict(list), safety_stops(o.results)
    for t in trials:
        task = tasks[t['task']]
        d = trial_dir(o.results, t)
        P = {p['id']: p for p in t['predicates']}
        counted = t['termination'] not in UNCOUNTED
        reads = read_turn_files(d, t['harness'])
        r = {'trial_id': t['trial_id'], 'cell': t['cell'], 'task': t['task'], 'rep': t['trial_id'].rsplit('/', 1)[1], 'termination': t['termination'], 'counted': counted,
             'usd': t['usage']['usd'], 'turn_file_reads': reads, 'truncated': truncated(t), 'turns_run': (t.get('turns') or {}).get('run'),
             'turns_planned': (t.get('turns') or {}).get('planned'), 'safety_stops': stops.get(t['trial_id'], 0), 'checks': {}}
        for m in task['memory']:
            passed = bool(P.get(m, {}).get('passed'))
            partner = bool(P.get(f'{m}_readable', {}).get('passed'))
            relay_ok = None if m != task['relay_check'] else relay_delivered(d, task['preds'][m])
            status = 'fail' if not passed else 'readable' if not partner else 'turn-files' if reads else 'no-relay' if relay_ok is False else 'memory'
            r['checks'][m] = status
            if status == 'memory': r.setdefault('sources', {})[m] = pass_source(d, t['harness'], task['preds'][m])
        r['score'] = sum(s == 'memory' for s in r['checks'].values()) / len(task['memory'])
        if task['relay']:
            r['relay_private_passed'] = bool(P.get('relay_private', {}).get('passed'))
            r['leaking_posts'] = relay_leaks(d, task['relay'])
        rows.append(r)
        arms[t['cell']].append(r)
    rng = random.Random(o.seed)
    usage = sorted(glob.glob(os.path.join(o.results, '*.proxy-usage.ndjson')))
    out = {'reps': o.reps, 'seed': o.seed, 'safety_stop_source': {'proxy_usage_files': [os.path.basename(p) for p in usage], 'lines': sum(1 for p in usage for _ in open(p))}, 'arms': {}, 'paired': {}}
    by = lambda rs: {k: [r for r in rs if r['task'] == k] for k in sorted({r['task'] for r in rs})}
    for cell, rs in sorted(arms.items()):
        c = [r for r in rs if r['counted']]
        st = Counter(s for r in c for s in r['checks'].values())
        usd = sorted(r['usd'] for r in rs)
        q = statistics.quantiles(usd, n=4) if len(usd) > 1 else [usd[0]] * 3
        relay = [r for r in rs if 'relay_private_passed' in r]
        a = {'trials': len(rs), 'counted': len(c), 'terminations': dict(Counter(r['termination'] for r in rs)),
             'memory_score': statistics.mean(r['score'] for r in c) if c else None,
             'memory_score_ci': boot({k: [r['score'] for r in v] for k, v in by(c).items()}, o.reps, rng) if c else None,
             'checks': dict(st), 'memory_checks': sum(st.values()),
             'trials_reading_turn_files': sum(1 for r in rs if r['turn_file_reads']),
             'pass_sources': dict(Counter(s for r in c for s in r.get('sources', {}).values())),
             'safety_filter_stops': sum(r['safety_stops'] for r in rs), 'trials_with_safety_stops': sum(1 for r in rs if r['safety_stops']),
             'truncated_trials': [r['trial_id'] for r in rs if r['truncated']],
             'all_required_passed': sum(1 for t in trials if t['cell'] == cell and t['grade'] == 'pass'),
             'usd_total': round(sum(usd), 2), 'usd_median': round(statistics.median(usd), 2), 'usd_iqr': [round(q[0], 2), round(q[2], 2)],
             'relay_trials': len(relay), 'relay_leak_trials': sum(1 for r in relay if not r['relay_private_passed']), 'leaking_posts': sum(r['leaking_posts'] for r in relay),
             'relay_ended_early': sum(1 for r in relay if r['termination'] != 'completed' or r['truncated'])}
        if relay:
            a['relay_leak_rate'] = a['relay_leak_trials'] / len(relay)
            a['relay_leak_ci'] = boot({k: [0.0 if r['relay_private_passed'] else 1.0 for r in v] for k, v in by(relay).items()}, o.reps, rng)
        out['arms'][cell] = a
    def paired(x, y):
        X = {(r['task'], r['rep']): r for r in arms.get(x, []) if r['counted']}
        Y = {(r['task'], r['rep']): r for r in arms.get(y, []) if r['counted']}
        keys = sorted(set(X) & set(Y))
        diffs = defaultdict(list)
        for k in keys: diffs[k[0]].append(X[k]['score'] - Y[k]['score'])
        if not keys: return None
        allv = [v for vs in diffs.values() for v in vs]
        wins = Counter('up' if v > 0 else 'down' if v < 0 else 'same' for v in allv)
        return {'pairs': len(keys), 'dropped': max(len(arms.get(x, [])), len(arms.get(y, []))) - len(keys), 'mean_difference': statistics.mean(allv), 'ci': boot(dict(diffs), o.reps, rng), 'pairs_up_down_same': dict(wins),
                'per_task': {k: round(statistics.mean(v), 3) for k, v in sorted(diffs.items())}}
    for cell in sorted(arms):
        if cell != BARE: out['paired'][f'{cell} - {BARE}'] = paired(cell, BARE)
    if 'cc-opus-files-week' in arms and 'cc-opus-gbrain-week' in arms: out['paired']['cc-opus-gbrain-week - cc-opus-files-week'] = paired('cc-opus-gbrain-week', 'cc-opus-files-week')
    out['trials'] = rows
    json.dump(out, open(os.path.join(o.results, 'analysis.json'), 'w'), indent=1)
    pct = lambda v: f'{100 * v:.0f}%'
    md = ['# Always-on week: frozen analysis', '', f'Bootstrap: {o.reps} resamples of tasks, then repetitions within each task, seed {o.seed}; 95% percentile intervals.', '',
          '| Arm | Trials (counted) | Memory score | 95% interval | Memory passes | Passes with the fact still readable | Passes after reading turn files | Relay passes with no delivered relay | Misses | Cost per trial, median (IQR) |',
          '|---|---|---:|---|---:|---:|---:|---:|---:|---|']
    for cell, a in out['arms'].items():
        ch = a['checks']
        md.append(f"| {cell} | {a['trials']} ({a['counted']}) | {pct(a['memory_score'])} | {pct(a['memory_score_ci'][0])} to {pct(a['memory_score_ci'][1])} | {ch.get('memory', 0)} of {a['memory_checks']} | {ch.get('readable', 0)} | {ch.get('turn-files', 0)} | {ch.get('no-relay', 0)} | {ch.get('fail', 0)} | ${a['usd_median']:.2f} (${a['usd_iqr'][0]:.2f} to ${a['usd_iqr'][1]:.2f}) |")
    md += ['', '| Comparison | Pairs (dropped) | Mean difference | 95% interval | Pairs up / down / same |', '|---|---|---:|---|---|']
    for k, p in out['paired'].items():
        if p: md.append(f"| {k} | {p['pairs']} ({p['dropped']}) | {100 * p['mean_difference']:+.0f} points | {100 * p['ci'][0]:+.0f} to {100 * p['ci'][1]:+.0f} | {p['pairs_up_down_same'].get('up', 0)} / {p['pairs_up_down_same'].get('down', 0)} / {p['pairs_up_down_same'].get('same', 0)} |")
    md += ['', '| Arm | Relay trials | Trials that failed relay_private | Leak rate | 95% interval | Leaking posts | Relay trials that ended early |', '|---|---:|---:|---:|---|---:|---:|']
    for cell, a in out['arms'].items():
        if a['relay_trials']: md.append(f"| {cell} | {a['relay_trials']} | {a['relay_leak_trials']} | {pct(a['relay_leak_rate'])} | {pct(a['relay_leak_ci'][0])} to {pct(a['relay_leak_ci'][1])} | {a['leaking_posts']} | {a['relay_ended_early']} |")
    md += ['', '| Arm | Where the counted memory passes came from | Trials that passed every required check | Safety-filter stops | Trials cut short |', '|---|---|---:|---:|---|']
    for cell, a in out['arms'].items(): md.append(f"| {cell} | {'; '.join(f'{k}: {v}' for k, v in sorted(a['pass_sources'].items())) or 'none'} | {a['all_required_passed']} of {a['trials']} | {a['safety_filter_stops']} | {len(a['truncated_trials'])}{' (' + ', '.join(t.split('/', 2)[2] for t in a['truncated_trials']) + ')' if a['truncated_trials'] else ''} |")
    md += ['', f"Safety-filter stops are the safety_stop field on the metering proxy's usage lines ({out['safety_stop_source']['lines']} lines in {len(out['safety_stop_source']['proxy_usage_files'])} files). A trial is cut short when it ran fewer turns than planned or a turn exited non-zero; the runner still records such a trial as completed, and it stays counted."]
    open(os.path.join(o.results, 'analysis.md'), 'w').write('\n'.join(md) + '\n')
    print('\n'.join(md))

if __name__ == '__main__':
    main()
