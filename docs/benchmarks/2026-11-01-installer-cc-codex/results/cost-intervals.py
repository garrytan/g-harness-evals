# Per-cell cost and wall-time intervals for report.md: task-clustered percentile bootstrap (tasks resampled with
# replacement, 10,000 draws, Python random.seed(7)), over trials.jsonl as recorded. Not the repository's stats kit, so its
# draws differ from compare-run's; compare-run's paired cost rows are in comparisons.gbrain.md.
# Usage: python3 cost-intervals.py <results dir>  (prints JSON)
import json, os, random, statistics, sys, collections
rows = [json.loads(l) for l in open(os.path.join(sys.argv[1], 'trials.jsonl'))]
cells = collections.defaultdict(lambda: collections.defaultdict(list))
for r in rows:
    cells[r['cell']][r['task']].append(r)
def boot(by_task, stat, draws=10000):
    tasks = sorted(by_task)
    rng = random.Random(7)
    vals = []
    for _ in range(draws):
        sample = [t for _ in tasks for t in by_task[rng.choice(tasks)]]
        v = stat(sample)
        if v is not None:
            vals.append(v)
    vals.sort()
    return [vals[int(0.025 * len(vals))], vals[int(0.975 * len(vals)) - 1]]
def usd_mean(ts): return sum(t['usage']['usd'] for t in ts) / len(ts)
def usd_per_success(ts):
    s = sum(1 for t in ts if t['grade'] == 'pass' and not t['consent_violation'])
    return sum(t['usage']['usd'] for t in ts) / s if s else None
def wall_median(ts): return statistics.median(t['wall_ms'] / 1000 for t in ts)
out = {}
for cell, by_task in sorted(cells.items()):
    ts = [t for v in by_task.values() for t in v]
    out[cell] = {
        'trials': len(ts),
        'usd_per_trial_mean': round(usd_mean(ts), 4), 'usd_per_trial_ci95': [round(x, 4) for x in boot(by_task, usd_mean)],
        'usd_per_success': round(usd_per_success(ts), 4), 'usd_per_success_ci95': [round(x, 4) for x in boot(by_task, usd_per_success)],
        'wall_s_per_trial_median': round(wall_median(ts), 1), 'wall_s_per_trial_ci95': [round(x, 1) for x in boot(by_task, wall_median)],
    }
print(json.dumps(out, indent=2))
