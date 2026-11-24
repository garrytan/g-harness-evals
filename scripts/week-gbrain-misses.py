#!/usr/bin/env python3
# For each gbrain memory check in the always-on week run that did not count as a pass, say how far the fact got: whether the
# message that carried it was ingested, whether any gbrain read returned it, and whether a read after the restart returned it.
# Keyless and offline.
#
#   python3 scripts/week-gbrain-misses.py --results <merged dir> [--out gbrain-misses.json]
import argparse, json, os, re, tomllib
from collections import Counter

CELL = 'cc-opus-gbrain-week'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--results', required=True)
    ap.add_argument('--tasks', default='tasks/multiuser/week/dev')
    ap.add_argument('--out')
    o = ap.parse_args()
    analysis = json.load(open(os.path.join(o.results, 'analysis.json')))
    restarts = {}
    for line in open(os.path.join(o.results, 'trials.jsonl')):
        t = json.loads(line)
        restarts[t['trial_id']] = min((x['before_turn'] for x in (t.get('week') or {}).get('restarts', [])), default=1)
    rows, tally = [], Counter()
    for r in analysis['trials']:
        if r['cell'] != CELL or not r['counted']: continue
        d = os.path.join(o.results, 'trials', *r['trial_id'].split('/')[1:])
        task = tomllib.load(open(os.path.join(o.tasks, r['task'], 'task.toml'), 'rb'))
        preds = {x['id']: x for x in task['predicate']}
        events = [json.loads(l) for l in open(os.path.join(d, 'events.jsonl'))]
        turns = [json.loads(l) for l in open(os.path.join(d, 'turns.jsonl'))]
        for m, status in r['checks'].items():
            if status == 'memory': continue
            pat = re.compile(preds[m]['pattern'])
            carriers = {x.get('request_ts') for x in turns if pat.search(x.get('text') or '')}
            carriers |= {(e.get('effect') or {}).get('ts') for e in events if e.get('tool') == 'chat.postMessage' and e.get('actor') != 'assistant'
                         and pat.search(json.dumps(e.get('args')))}
            carriers.discard(None)
            ingests = [e for e in events if e.get('tool') == 'gbrain.ingest' and (e.get('args') or {}).get('ts') in carriers]
            ingested = any(e.get('outcome') == 'ok' and (e.get('effect') or {}).get('status') == 'inserted' for e in ingests)
            reads = [e for e in events if e.get('via') == 'gbrain' and e.get('kind') == 'read' and pat.search(json.dumps(e.get('effect')))]
            if status != 'fail': where = 'passed with the fact still readable'
            elif reads: where = 'a gbrain read in the trial returned the fact; the answer did not carry it'
            elif ingested: where = 'ingested, but no gbrain read returned it'
            elif ingests: where = 'the carrying message reached ingest but was not inserted'
            elif carriers: where = 'the carrying message was never sent to ingest'
            else: where = 'no carrying message found by the check pattern'
            tally[where] += 1
            rows.append({'trial_id': r['trial_id'], 'check': m, 'status': status, 'ask_turn': preds[m]['turn'], 'carrier_ts': sorted(carriers),
                         'ingest_outcomes': [[e.get('outcome'), (e.get('effect') or {}).get('status')] for e in ingests],
                         'gbrain_reads_returning_fact': len(reads), 'where': where})
    out = {'by_where': dict(tally), 'misses': rows}
    json.dump(out, open(o.out or os.path.join(o.results, 'gbrain-misses.json'), 'w'), indent=1)
    print(json.dumps(out['by_where']), len(rows))

if __name__ == '__main__':
    main()
