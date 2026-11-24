# Exploratory gbrain readings, not preregistered. Reads results/trials.jsonl and results/sets/set-g.jsonl and writes:
#   gbrain-confirmable/confirmable.json  the set G requests where gbrain confirmed at least one argument-matching call
#                                        to an acceptable tool, in any gbrain arm (the rest could not be passed by anyone)
#   widening.json                        per harness, the share of starter-surface set G trials that called request_tools
# With --inputs <dir> it also writes the filtered trials and set G that the exploratory analysis reads.
#   python3 docs/benchmarks/2026-11-mcp-at-scale/results/exploratory/gbrain-extra.py [--inputs <dir>]
import json, os, sys
from collections import defaultdict
HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(RES, '..', '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'mcp-at-scale'))
from grade import args_match  # noqa: E402

G = {}
for line in open(os.path.join(RES, 'sets', 'set-g.jsonl')):
    item = json.loads(line)
    G[item['id']] = item
rows = open(os.path.join(RES, 'trials.jsonl')).read().splitlines()
confirmed, widen = set(), defaultdict(lambda: [0, 0])
for line in rows:
    t = json.loads(line)
    if t['set'] != 'G' or t['infra']:
        continue
    o = t['outcomes']
    for c in o.get('calls', []):
        for a in G[t['request']]['acceptable']:
            if c['server'] == a['server'] and c['tool'] == a['tool'] and c['result_ok'] is True and args_match(a.get('required'), c['arguments']):
                confirmed.add(t['request'])
    if t['arm'] == 'gbrain-starter':
        widen[t['harness']][0] += 1
        widen[t['harness']][1] += 1 if o.get('discovery_calls') else 0
out = os.path.join(HERE, 'gbrain-confirmable')
os.makedirs(out, exist_ok=True)
with open(os.path.join(out, 'confirmable.json'), 'w') as f:
    json.dump(sorted(confirmed), f, indent=1)
    f.write('\n')
with open(os.path.join(HERE, 'widening.json'), 'w') as f:
    json.dump({h: {'trials': n, 'called_request_tools': k, 'share': round(k / n, 4)} for h, (n, k) in sorted(widen.items())}, f, indent=1)
    f.write('\n')
if '--inputs' in sys.argv:
    d = sys.argv[sys.argv.index('--inputs') + 1]
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'set-g-confirmable.jsonl'), 'w') as f:
        f.writelines(line for line in open(os.path.join(RES, 'sets', 'set-g.jsonl')) if json.loads(line)['id'] in confirmed)
    with open(os.path.join(d, 'trials.jsonl'), 'w') as f:
        for line in rows:
            t = json.loads(line)
            if t['set'] == 'G' and t['request'] not in confirmed:
                continue
            f.write(line + '\n')
print(len(confirmed), 'confirmable set G requests')
