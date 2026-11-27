#!/usr/bin/env python3
# The "Why null?" breakdown for gbrain-first-wow-2026-12 (R48, R61), read from trial records only.
#   python3 scripts/gbrain-first-wow/why-null.py <trials.jsonl> [<trials.jsonl> ...] --out <why-null.json>
# Question trials of the history-rich and messy personas, per cell: finish rates by question kind, persona and
# cross-harness record, the reasons failed questions failed, gbrain calls, commands, question time, whether the
# first-session suggestion was delivered and seen, and whether the answer cited a suggested page that holds a planted
# value (citation overlap only: a suggested answer page the session did not cite is not counted).
import json, collections, statistics, sys
args = sys.argv[1:]
if '--out' not in args or args.index('--out') == len(args) - 1: sys.exit('usage: why-null.py <trials.jsonl> ... --out <file>')
OUT = args[args.index('--out') + 1]
FILES = [a for i, a in enumerate(args) if a != '--out' and (i == 0 or args[i - 1] != '--out')]
recs = {}
for f in FILES:
    for l in open(f):
        t = json.loads(l); fw = t['first_wow']
        if fw.get('coding') or fw.get('persona') == 'no-history' or not fw.get('score'): continue
        recs[(t['cell'], fw['seed'])] = t
def m(xs): return round(statistics.mean(xs), 3) if xs else None
out = {}
cells = sorted({c for c, _ in recs})
for c in cells:
    ts = [t for (cc, _), t in recs.items() if cc == c]
    sc = [t['first_wow']['score'] for t in ts]
    qs = [q for s in sc for q in s['questions']]
    kinds = collections.defaultdict(list); cross = collections.defaultdict(list)
    for q in qs: kinds[q['kind']].append(q['passed_any']); cross[q['cross_harness']].append(q['passed_any'])
    passed = [q for q in qs if q['passed_any']]
    fail = [q for q in qs if not q['passed_any']]
    why = collections.Counter()
    for q in fail:
        if not q['value_named']: why['value not named'] += 1
        elif not q['correct']: why['decoy named first'] += 1
        elif not (q['file_ref_ok'] or q['page_ref_ok']): why['no auditable reference'] += 1
        else: why['other'] += 1
    seen = [t['first_wow'].get('suggestion_seen') or {} for t in ts]
    onb = [t['first_wow'].get('onboarding') or {} for t in ts]
    sugg_hits = []
    for t in ts:
        ss = t['first_wow'].get('suggestion_seen') or {}
        if not ss.get('seen'): continue
        refs = {r['ref'] for q in t['first_wow']['score']['questions'] for r in q['references'] if r['kind'] == 'page' and r['holds_value']}
        sugg_hits.append(bool(set(ss.get('pages') or []) & refs))
    personas = collections.defaultdict(list)
    for t in ts: personas[t['first_wow']['persona']].append(t['first_wow']['score']['finish_any'])
    out[c] = {
        'n': len(ts), 'finish_any': m([s['finish_any'] for s in sc]), 'finish_strict': m([s['finish_strict'] for s in sc]),
        'q_pass': m([q['passed_any'] for q in qs]),
        'by_kind': {k: m(v) for k, v in sorted(kinds.items())}, 'by_cross_harness': {str(k): m(v) for k, v in cross.items()},
        'by_persona': {k: [m(v), len(v)] for k, v in personas.items()},
        'page_ref_share_of_passes': m([q['page_ref_ok'] for q in passed]),
        'fail_reasons': dict(why),
        'gbrain_calls_mean': m([s.get('gbrain_calls', 0) for s in sc]), 'trials_with_gbrain_call': m([s.get('gbrain_calls', 0) > 0 for s in sc]),
        'commands_mean': m([s.get('commands', 0) for s in sc]),
        'question_s_mean': m([(t['first_wow'].get('question_ms') or 0) / 1000 for t in ts]),
        'suggestion_delivered': m([(o.get('delivered_sessions') or 0) > 0 for o in onb]),
        'suggestion_seen': m([bool(s.get('seen')) for s in seen]),
        'suggestion_page_cited_for_answer': m(sugg_hits) if sugg_hits else None,
        'sessions_imported_mean': m([t['first_wow'].get('sessions_imported') or 0 for t in ts]),
    }
def pairs(a, b):
    d = collections.Counter()
    for (c, s), t in recs.items():
        if c != a or (b, s) not in recs: continue
        x, y = t['first_wow']['score']['finish_any'], recs[(b, s)]['first_wow']['score']['finish_any']
        d[(x, y)] += 1
    return {f'{a}={k[0]},{b}={k[1]}': v for k, v in d.items()}
out['_pairs'] = {k: pairs(*k.split('|')) for k in ['cc-opus-pr1|cc-opus-full', 'codex-sol-pr1|codex-sol-full', 'qm-sol-plain|qm-sol-native', 'qm-opus-plain|qm-opus-native']}
# full-arm losses vs pr1: was the suggestion seen?
loss = collections.Counter()
for (c, s), t in recs.items():
    if c != 'cc-opus-full' or ('cc-opus-pr1', s) not in recs: continue
    p = recs[('cc-opus-pr1', s)]['first_wow']['score']['finish_any']; f = t['first_wow']['score']['finish_any']
    if p != f: loss[('full wins' if f else 'full loses', bool((t['first_wow'].get('suggestion_seen') or {}).get('seen')))] += 1
out['_cc_discordant_by_seen'] = {f'{k[0]} seen={k[1]}': v for k, v in loss.items()}
def by_hit(full, pr1):
    g = collections.defaultdict(lambda: [0, 0, 0])
    for (c, s), t in recs.items():
        if c != full or (pr1, s) not in recs: continue
        ss = t['first_wow'].get('suggestion_seen') or {}
        if not ss.get('seen'): continue
        refs = {r['ref'] for q in t['first_wow']['score']['questions'] for r in q['references'] if r['kind'] == 'page' and r['holds_value']}
        k = 'cites a suggested page' if set(ss.get('pages') or []) & refs else 'cites no suggested page'
        g[k][0] += 1; g[k][1] += t['first_wow']['score']['finish_any']; g[k][2] += recs[(pr1, s)]['first_wow']['score']['finish_any']
    return {k: {'pairs': v[0], 'full_finished': v[1], 'pr1_finished_same_seeds': v[2]} for k, v in g.items()}
out['_suggestion_hit_pairs'] = {'claude-code': by_hit('cc-opus-full', 'cc-opus-pr1'), 'codex': by_hit('codex-sol-full', 'codex-sol-pr1')}
json.dump(out, open(OUT, 'w'), indent=1)
print('wrote', OUT)
