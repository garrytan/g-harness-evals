import json, math, os, subprocess, sys
root = os.path.expanduser('~/.capy/work/harn43')
merged = sys.argv[1]
turns = [json.loads(l) for l in open(os.path.join(merged, 'turns.jsonl')) if l.strip()]
review = [t for t in turns if t.get('family') == 'review']
plan = [t for t in turns if t.get('family') == 'plan']
rp = os.path.join(merged, 'review-turns.jsonl')
with open(rp, 'w') as f:
    for t in review: f.write(json.dumps(t) + '\n')
grades_path = os.path.join(merged, 'review-grades.jsonl')
env = {'PATH': '/home/user/.local/bin:/usr/bin:/bin', 'HOME': '/home/user'}
out = subprocess.run(['bun', 'harnesses/qm/gstack/edition-grade.ts', '--turns', rp, '--keys', os.path.join(root, 'tasks-gen2', 'keys.json'), '--tasks', os.path.join(root, 'tasks-gen2', 'tasks.json'), '--out', grades_path], cwd=os.path.join(root, 'wt-headroom'), env=env, capture_output=True, text=True)
print(out.stdout.strip(), out.stderr.strip()[-500:])
grades = {g['trial_id']: g for g in (json.loads(l) for l in open(grades_path) if l.strip())}
assert all('alias' not in g.get('grader', '') or g.get('family') == 'plan' for g in grades.values())
def wilson(k, n, z=1.959964):
    if n == 0: return (None, None)
    p = k / n; d = 1 + z*z/n; c = (p + z*z/(2*n)) / d; h = z*math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / d
    return (c - h, c + h)
usd = lambda t: (t.get('usage') or {}).get('usd') or 0.0
res = {'trials': len(turns), 'status': {}, 'excluded': [], 'by_model': {}, 'cost': {}}
for t in turns: res['status'][t['status']] = res['status'].get(t['status'], 0) + 1
excl = {'model_error', 'infra_error'}
res['excluded'] = [(t['trial_id'], t['status'], str(t.get('status_reason') or '')[:200]) for t in turns if t['status'] in excl]
models = sorted({t['model'] for t in turns})
for m in models:
    rv = [t for t in review if t['model'] == m and t['status'] not in excl]
    k = sum(1 for t in rv if t['status'] == 'ok' and grades.get(t['trial_id'], {}).get('success'))
    n = len(rv)
    lo, hi = wilson(k, n)
    p = k / n if n else None
    res['by_model'][m] = {'review_success': k, 'review_valid': n, 'rate': p, 'wilson95': [lo, hi], 'band': None if p is None else ('in' if 0.15 <= p <= 0.75 else ('above' if p > 0.75 else 'below')),
        'solved': sorted(t['task_id'] for t in rv if grades.get(t['trial_id'], {}).get('success')), 'failed': sorted(t['task_id'] for t in rv if not grades.get(t['trial_id'], {}).get('success'))}
def cost(ts): return {'trials': len(ts), 'per_trial': round(sum(usd(t) for t in ts) / len(ts), 6) if ts else None}
res['cost']['overall'] = cost(turns)
for m in models: res['cost']['model:' + m] = cost([t for t in turns if t['model'] == m])
for fam in ('review', 'plan'): res['cost']['family:' + fam] = cost([t for t in turns if t.get('family') == fam])
for m in models:
    for fam in ('review', 'plan'): res['cost'][m + ':' + fam] = cost([t for t in turns if t['model'] == m and t.get('family') == fam])
res['plan_replies_stored_ungraded'] = len(plan)
res['cost_note'] = "Each slice's cost sum is in ../spend-internal.md, an internal file kept out of the public copy."
json.dump(res, open(os.path.join(merged, 'headroom-summary.json'), 'w'), indent=2)
print(json.dumps(res, indent=1)[:4000])
