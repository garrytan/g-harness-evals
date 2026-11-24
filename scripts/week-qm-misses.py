#!/usr/bin/env python3
# For each QM memory check in the always-on week run that did not count as a pass, say whether QM captured the fact and in
# which scope (PREREGISTRATION.md, "What the result changes": QM native against no memory). Keyless and offline.
#
#   python3 scripts/week-qm-misses.py --results <merged dir> [--out qm-misses.json]
#
# Reads the end-of-trial database dump (logs/qm-db.sql.gz): a fact counts as captured when a live memory_facts row matches
# the check's pattern. The asking conversation is a DM, which reads only its asker's own scope under QM's default Isolated
# posture. Also counts the agent's calls to QM's memory tool in the trial.
import argparse, gzip, json, os, re, tomllib
from collections import Counter

CELL = 'qm-opus-native-week'

def dump_rows(p, tables):
    table = names = None
    with gzip.open(p, 'rt', errors='replace') as f:
        for line in f:
            if line.startswith('COPY '):
                table, names = line.split()[1], [x.strip() for x in line[line.find('(') + 1:line.find(')')].split(',')]; continue
            if line.startswith('\\.'):
                table = None; continue
            if table in tables: yield table, dict(zip(names, line.rstrip('\n').split('\t')))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--results', required=True)
    ap.add_argument('--tasks', default='tasks/multiuser/week/dev')
    ap.add_argument('--out')
    o = ap.parse_args()
    analysis = json.load(open(os.path.join(o.results, 'analysis.json')))
    rows, tally = [], Counter()
    for r in analysis['trials']:
        if r['cell'] != CELL or not r['counted']: continue
        d = os.path.join(o.results, 'trials', *r['trial_id'].split('/')[1:])
        task = tomllib.load(open(os.path.join(o.tasks, r['task'], 'task.toml'), 'rb'))
        preds = {x['id']: x for x in task['predicate']}
        turns = {x['turn']: x for x in map(json.loads, open(os.path.join(d, 'turns.jsonl')))}
        facts, memory_calls = [], 0
        p = os.path.join(d, 'logs', 'qm-db.sql.gz')
        if os.path.isfile(p):
            for table, c in dump_rows(p, {'public.memory_facts', 'public.items'}):
                if table == 'public.memory_facts' and c.get('deleted_at') == '\\N': facts.append(c)
                if table == 'public.items' and c.get('tool') == 'memory' and c.get('kind') == 'ToolCall': memory_calls += 1
        for m, status in (r.get('checks') or {}).items():
            if status == 'memory': continue
            pred, ask = preds[m], turns.get(preds[m]['turn'], {})
            asker = ask.get('slack_user_id')
            scopes = sorted({f['scope_id'] for f in facts if re.search(pred['pattern'], f['text'])})
            if not scopes: where = 'not captured'
            elif f'personal:{asker}' in scopes: where = "captured in the asker's own DM scope"
            elif any(s.startswith('channel:') for s in scopes): where = 'captured only in a channel scope'
            else: where = "captured only in another person's scope"
            tally[where] += 1
            rows.append({'trial_id': r['trial_id'], 'check': m, 'status': status, 'asker': asker, 'asked_in': ask.get('channel_type'),
                         'captured_in': scopes, 'where': where, 'memory_tool_calls_in_trial': memory_calls})
    out = {'by_where': dict(tally), 'trials_with_memory_tool_calls': len({x['trial_id'] for x in rows if x['memory_tool_calls_in_trial']}),
           'misses': rows}
    json.dump(out, open(o.out or os.path.join(o.results, 'qm-misses.json'), 'w'), indent=1)
    print(json.dumps({k: v for k, v in out.items() if k != 'misses'}), len(rows))

if __name__ == '__main__':
    main()
