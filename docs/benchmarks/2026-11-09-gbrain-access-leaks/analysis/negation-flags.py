#!/usr/bin/env python3
# gbrain-access-leaks-2026-11, PREREGISTRATION.md "Three known task limits": flags passing replies where every match of the
# task's answer pattern follows a negation word (not, n't, never, avoid) earlier in the same sentence, per cell, and lists them
# for a person to read. Also lists the tasks that carry the L5 "wrong window" filler line.
#   python3 docs/benchmarks/2026-11-09-gbrain-access-leaks/analysis/negation-flags.py <merged results> <out.json>
import glob, gzip, json, os, re, sys, tomllib
res, out = sys.argv[1], sys.argv[2]
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
tasks = {}
for d in glob.glob(os.path.join(root, 'tasks/multiuser/*/dev/*/task.toml')):
    name = os.path.basename(os.path.dirname(d))
    if any(s in d for s in ('/company-v2-l5/', '/personal-v2/', '/personal-v2x/')): tasks[name] = d
filler = sorted(n for n, d in tasks.items() if 'wrong window' in open(os.path.join(os.path.dirname(d), 'spec.json')).read() + open(d).read())
NEG = re.compile(r"\b(not|never|avoid)\b|n't", re.I)
def py_pattern(p):
    flags = 0
    if p.startswith('(?i)'): p, flags = p[4:], re.I
    return re.compile(p, flags)
flags, counts = [], {}
for line in open(os.path.join(res, 'trials.jsonl')):
    t = json.loads(line)
    if t['grade'] != 'pass': continue
    spec = tomllib.load(open(tasks[t['task']], 'rb'))
    ans = [p for p in spec.get('predicate', []) if p['id'] == 'answer' and p['kind'] == 'reply_matches']
    c = counts.setdefault(t['cell'], {'passing_with_reply_answer': 0, 'flagged': 0})
    if not ans: continue
    c['passing_with_reply_answer'] += 1
    p = ans[0]
    d = os.path.join(res, 'trials', t['trial_id'].split('/', 1)[1])
    f = os.path.join(d, 'turns.jsonl')
    lines = open(f).read().splitlines() if os.path.exists(f) else gzip.open(f + '.gz', 'rt').read().splitlines()
    reply = ''.join(x.get('reply_text') or '' for x in map(json.loads, lines) if x.get('turn') == p['turn'])
    c['reply_read'] = c.get('reply_read', 0) + 1
    if py_pattern(p['pattern']).search(reply): c['answer_in_reply'] = c.get('answer_in_reply', 0) + 1
    sentences = re.split(r'(?<=[.!?])\s+|\n+', reply)
    hits = [(s, m) for s in sentences for m in py_pattern(p['pattern']).finditer(s)]
    if hits and all(NEG.search(s[:m.start()]) for s, m in hits):
        c['flagged'] += 1
        flags.append({'trial_id': t['trial_id'], 'cell': t['cell'], 'sentences': [s for s, _ in hits]})
json.dump({'filler_tasks': filler, 'counts': counts, 'flagged': flags}, open(out, 'w'), indent=1)
print(len(filler), sum(c['flagged'] for c in counts.values()), sum(c['passing_with_reply_answer'] for c in counts.values()))
