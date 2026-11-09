#!/usr/bin/env python3
"""Receipts for the frontier-harness report's outage-window and Hermes web-tool lines.

Reads the committed merges (results/merged/trials.jsonl, results/lookup-fails.json, results/verifier-unavailable.json,
results/stage0, results/main and results/rerun) and, for the agent-log scans, the trial directories of each stage
(--trials <root>, laid out <root>/<stage>/<shard>/results/<trial_dir> with stage one of stage0, main, rerun, rerun6).
Writes results/outage-window.json and results/hermes-web-tools.json, and writes nothing when any scored record's agent
directory or any Hermes record's session is missing under --trials.

  python3 receipts.py --trials <root>
"""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, 'results')
LO, HI = '2026-11-08T08:45:00', '2026-11-08T12:08:00'
GITHUB_ERROR = re.compile(r"(fatal: unable to access 'https://github\.com|github\.com[^\n]{0,200}(\b50[234]\b|Could not resolve host|timed out|Connection (reset|refused)|failed to (download|connect|clone)))", re.I)
WEB_CALL = re.compile(r'"function": \{"name": "(web_search|web_extract|browser_[a-z_]+|delegate_task)"')
STAGE_DIR = {None: 'main', 'stage0': 'stage0', 'rerun1': 'rerun', 'rerun1-a6': 'rerun6'}

def rows(path):
    with open(path) as f:
        return [json.loads(l) for l in f if l.strip()]

def value(r, lookups):
    if r['termination'] in ('model_error', 'infra_error', 'exam_fault'):
        return None
    if r['termination'] == 'harness_error':
        return 0
    return 1 if r['grade'] == 'pass' and not r.get('consent_violation') and r['trial_id'] not in lookups else 0

def in_window(r):
    return not (r.get('frontier') or {}).get('rerun') and LO <= r['ended_at'][:19] < HI

def bucket(rs, lookups):
    scored = [(r['trial_id'], value(r, lookups)) for r in rs]
    scored = [(i, v) for i, v in scored if v is not None]
    return {'scored': len(scored), 'passed': sum(v for _, v in scored), 'trial_ids': sorted(i for i, _ in scored)}

def trial_dir(root, r):
    stage = (r.get('frontier') or {}).get('stage')
    return os.path.join(root, STAGE_DIR[stage], r['cell'].replace('-kept', ''), 'results', r['paths']['trial_dir'], 'harbor', 'agent')

def scan(d, pattern):
    hits = set()
    for base, _, files in os.walk(d):
        for f in files:
            with open(os.path.join(base, f), errors='replace') as fh:
                hits.update(m.group(0) for m in pattern.finditer(fh.read()))
    return hits

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--trials', required=True)
    a = ap.parse_args()
    lookups = set(json.load(open(os.path.join(RES, 'lookup-fails.json')))['trial_ids'])
    final = rows(os.path.join(RES, 'merged', 'trials.jsonl'))
    first = [r for g in ('stage0', 'main') for s in sorted(os.listdir(os.path.join(RES, g))) for r in rows(os.path.join(RES, g, s, 'trials.jsonl'))]
    listed4 = set(json.load(open(os.path.join(RES, 'verifier-unavailable.json')))['trial_ids'])
    graded4 = [r for r in first if r['trial_id'] not in listed4 and r['termination'] == 'completed']
    reruns4 = [r for s in sorted(os.listdir(os.path.join(RES, 'rerun'))) for r in rows(os.path.join(RES, 'rerun', s, 'trials.jsonl'))]
    merged4 = graded4 + [r for r in reruns4 if r['termination'] == 'completed']
    missing = [r['trial_id'] for r in final if value(r, lookups) is not None and not os.path.isdir(trial_dir(a.trials, r))]
    missing += [r['trial_id'] + ' (hermes-session.jsonl)' for r in final if r['cell'].replace('-kept', '') in ('opus-hermes', 'sol-hermes') and not os.path.exists(os.path.join(trial_dir(a.trials, r), 'hermes-session.jsonl'))]
    if missing:
        sys.exit('receipts.py: ' + str(len(missing)) + ' scored trial log(s) missing under --trials ' + a.trials + ' (first: ' + missing[0] + '); nothing written')
    gh = {}
    for r in final:
        if value(r, lookups) is None:
            continue
        d = trial_dir(a.trials, r)
        if os.path.isdir(d) and scan(d, GITHUB_ERROR):
            gh[r['trial_id']] = 'in_window' if in_window(r) else 'other'
    outage = {
        'window_utc': [LO + 'Z', HI + 'Z'],
        'final_merge': {
            'method': 'results/merged/trials.jsonl (amendments 4 and 6). A first run (frontier.rerun null) whose ended_at is inside the window (trial ids listed), against every other record (the rest of the merge). Scored as analyze.ts scores (model_error, infra_error and exam_fault excluded; harness_error a fail; lookups in results/lookup-fails.json as fails).',
            'in_window_first_runs': bucket([r for r in final if in_window(r)], lookups),
            'all_other': {x: v for x, v in bucket([r for r in final if not in_window(r)], lookups).items() if x != 'trial_ids'},
            'by_cell': {c: {k: {x: v for x, v in bucket([r for r in final if r['cell'] == c and in_window(r) == w], lookups).items() if x != 'trial_ids'} for k, w in (('in_window_first_runs', True), ('all_other', False))} for c in sorted({r['cell'] for r in final})},
        },
        'amendment_4_first_runs': {
            'method': 'Stage-0 and main-stage first runs (results/stage0, results/main) with termination completed, less the 318 listed in results/verifier-unavailable.json: the graded first runs amendment 6 was written from.',
            'in_window': {'completed': sum(1 for r in graded4 if in_window(r)), 'failed': sum(1 for r in graded4 if in_window(r) and r['grade'] != 'pass')},
            'other_first_runs': {'completed': sum(1 for r in graded4 if not in_window(r)), 'failed': sum(1 for r in graded4 if not in_window(r) and r['grade'] != 'pass')},
            'other_records_with_amendment_4_reruns': {'method': 'every other completed record of the amendment-4 merge: the first runs above plus the completed amendment-4 reruns (results/rerun), the population AMENDMENTS.md amendment 6 quotes', 'completed': sum(1 for r in merged4 if not in_window(r)), 'failed': sum(1 for r in merged4 if not in_window(r) and r['grade'] != 'pass')},
        },
        'agent_logs_with_github_errors': {
            'method': 'Scored records of the final merge whose agent directory (harbor/agent) has a line matching ' + GITHUB_ERROR.pattern,
            'in_window_first_runs': sorted(i for i, k in gh.items() if k == 'in_window'),
            'all_other': sorted(i for i, k in gh.items() if k == 'other'),
        },
    }
    web = {'method': 'Records of the final merge, kept tasks included, whose Hermes session (harbor/agent/hermes-session.jsonl) has a tool call named web_search, web_extract, browser_* or delegate_task.', 'cells': {}}
    for cell in ('opus-hermes', 'sol-hermes'):
        rs = [r for r in final if r['cell'] in (cell, cell + '-kept')]
        used = {}
        for r in rs:
            p = os.path.join(trial_dir(a.trials, r), 'hermes-session.jsonl')
            names = sorted({m.group(1) for m in WEB_CALL.finditer(open(p, errors='replace').read())}) if os.path.exists(p) else None
            if names:
                used[r['trial_id']] = names
        web['cells'][cell] = {'trials': len(rs), 'sessions_found': sum(1 for r in rs if os.path.exists(os.path.join(trial_dir(a.trials, r), 'hermes-session.jsonl'))), 'with_web_tools': len(used), 'trials_with_tools': used}
    json.dump(outage, open(os.path.join(RES, 'outage-window.json'), 'w'), indent=1)
    json.dump(web, open(os.path.join(RES, 'hermes-web-tools.json'), 'w'), indent=1)

if __name__ == '__main__':
    main()
