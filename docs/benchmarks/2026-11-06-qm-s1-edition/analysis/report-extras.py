#!/usr/bin/env python3
"""Report-only counts for the QM edition results (not the frozen analysis, which is edition-analysis.ts).

    python3 docs/benchmarks/2026-11-06-qm-s1-edition/analysis/report-extras.py

Reads main/ and forced/ (turns.jsonl, grades.jsonl, trials/<id>/llm-turn0.json) and writes analysis/report-extras.json:
- how review trials failed, per model and arm: planted defect missed, a decoy flagged, more than 3 issues;
- whether the edition's skill list reached the model: the gstack-review entry in each trial's first model request;
- metered USD per model and arm, per shard (block b holds rev tasks 6b-5 to 6b) and per stage, from turn usage;
- median wall time per trial, per model and arm.
"""
import collections
import json
import os
import statistics

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LISTING = 'gstack-review \u2014 Use before merging'


def rows(path):
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def short(model):
    return {'anthropic:claude-opus-5-5': 'opus', 'openai:gpt-6.1-sol': 'sol'}[model]


out = {'failure_modes': {}, 'skill_list_in_first_request': {}, 'median_wall_s': {}}
for stage in ['main', 'forced']:
    turns = {t['trial_id']: t for t in rows(os.path.join(ROOT, stage, 'turns.jsonl'))}
    grades = rows(os.path.join(ROOT, stage, 'grades.jsonl'))
    modes = collections.defaultdict(collections.Counter)
    for g in grades:
        t = turns[g['trial_id']]
        d = g['detail']
        c = modes[short(t['model']) + '/' + t['arm']]
        c['trials'] += 1
        c['success'] += bool(g['success'])
        c['defect_flagged'] += bool(d['defect_flagged'])
        c['any_decoy_flagged'] += bool(d['decoys_flagged'])
        c['over_3_issues'] += d['issue_count'] > 3
        c['issues_total'] += d['issue_count']
    for k, c in sorted(modes.items()):
        out['failure_modes'][k] = dict(c, mean_issues=round(c['issues_total'] / c['trials'], 2))
    listed = collections.Counter()
    seen = collections.Counter()
    for tid, t in turns.items():
        k = short(t['model']) + '/' + t['arm']
        seen[k] += 1
        with open(os.path.join(ROOT, stage, 'trials', tid, 'llm-turn0.json')) as f:
            listed[k] += LISTING in f.read()
    for k in sorted(seen):
        out['skill_list_in_first_request'][k] = {'k': listed[k], 'n': seen[k]}
    walls = collections.defaultdict(list)
    for t in turns.values():
        walls[short(t['model']) + '/' + t['arm']].append(t['wall_s'])
    for k in sorted(walls):
        out['median_wall_s'][k] = round(statistics.median(walls[k]), 1)

out['spend_note'] = 'Cost sums per cell, shard and stage are in ../spend-internal.md, an internal file kept out of the public copy.'

with open(os.path.join(HERE, 'report-extras.json'), 'w') as f:
    json.dump(out, f, indent=1)
    f.write('\n')
print(json.dumps(out, indent=1))
