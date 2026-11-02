#!/usr/bin/env python3
"""Recompute every number in ../report.md from the committed receipts in this directory. Counts, sums and intervals only.
   python3 docs/benchmarks/2026-11-01-opus-gstack-follow/results/recompute.py"""
import json, math, os, statistics, collections
HERE = os.path.dirname(os.path.abspath(__file__))
Z = 1.959963984540054

def wilson(k, n):
    p = k / n; d = 1 + Z * Z / n; c = p + Z * Z / (2 * n); h = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n))
    return [round(max(0.0, (c - h) / d), 3), round(min(1.0, (c + h) / d), 3)]

def load(path):
    return [json.loads(l) for l in open(os.path.join(HERE, path)) if l.strip()]

def j(path):
    return json.load(open(os.path.join(HERE, path)))

def field(r, k):
    v = r[k]
    return json.loads(v) if isinstance(v, str) else v

RUNS = {
    'gn-follow-2026-11': {'trials': load('gn-follow-2026-11/trials.jsonl'), 'denominator': 'sessions'},
    'gn-follow-preset-2026-11': {'trials': load('gn-follow-preset-2026-11/trials.jsonl'), 'denominator': 'sessions'},
    'gn-hard-follow-2026-11': {'trials': load('gn-hard-follow-2026-11/reprobed-trials.jsonl'), 'denominator': 'completed sessions with a probe reading'},
}
extras = {e['trial_id']: e for e in load('gn-hard-follow-2026-11/extras.jsonl')}
out = {}
gstack_followed = gstack_den = 0
for run, spec in RUNS.items():
    arms = collections.OrderedDict(); skills = collections.OrderedDict()
    for r in spec['trials']:
        lb = r['laneb']; p = lb['skill_probe']; u = field(r, 'usage'); arm = lb['arm']
        hard = run == 'gn-hard-follow-2026-11'
        counted = p.get('transcript') and (r['termination'] == 'completed' if hard else True)
        a = arms.setdefault(arm, {'sessions': 0, 'completed': 0, 'den': 0, 'followed': 0, 'pass': 0, 'usd': [], 'first_req_tokens': [],
                                  'preamble': 0, 'any_step': 0, 'skill_tool': 0, 'skill_end': 0, 'router_listed': 0, 'skill_listed': 0, 'tampered': 0, 'cap_stop': 0})
        a['sessions'] += 1; a['completed'] += r['termination'] == 'completed'; a['pass'] += r['grade'] == 'pass'; a['cap_stop'] += bool(r['cap_stop'])
        if counted:
            a['den'] += 1; a['followed'] += bool(p.get('followed'))
        a['usd'].append(u['usd']); a['first_req_tokens'].append(lb.get('first_req_prompt_tokens'))
        for k, pk in (('preamble', 'preamble_ok'), ('skill_tool', 'skill_tool'), ('skill_end', 'skill_end_ok'), ('router_listed', 'router_listed'), ('skill_listed', 'skill_listed'), ('tampered', 'tampered')):
            a[k] += bool(p.get(pk))
        a['any_step'] += (p.get('skill_steps_ok') or 0) > 0
        if arm == 'gstack':
            s = skills.setdefault(p.get('skill'), {'sessions': 0, 'preamble': 0, 'any_step': 0, 'skill_tool': 0, 'skill_end': 0, 'followed': 0})
            s['sessions'] += 1; s['preamble'] += bool(p.get('preamble_ok')); s['any_step'] += (p.get('skill_steps_ok') or 0) > 0
            s['skill_tool'] += bool(p.get('skill_tool')); s['skill_end'] += bool(p.get('skill_end_ok')); s['followed'] += bool(p.get('followed'))
    res = {}
    for arm, a in arms.items():
        res[arm] = {'sessions': a['sessions'], 'completed': a['completed'], 'followed': a['followed'], 'denominator': a['den'],
                    'followed_wilson95': wilson(a['followed'], a['den']), 'pass': a['pass'], 'pass_wilson95': wilson(a['pass'], a['sessions']),
                    'usd_sum_records': round(sum(a['usd']), 4), 'usd_per_trial_mean': round(statistics.mean(a['usd']), 3), 'usd_per_trial_median': round(statistics.median(a['usd']), 3),
                    'first_req_prompt_tokens_median': statistics.median(a['first_req_tokens']),
                    **{k: a[k] for k in ('preamble', 'any_step', 'skill_tool', 'skill_end', 'router_listed', 'skill_listed', 'tampered', 'cap_stop')}}
        if arm == 'gstack':
            gstack_followed += a['followed']; gstack_den += a['den']
    out[run] = {'denominator': spec['denominator'], 'arms': res, 'gstack_per_skill': skills}

hard = {}
for e in extras.values():
    h = hard.setdefault(e['arm'], {'sessions': 0, 'head_moved': 0, 'empty_patch': 0, 'tool_calls': [], 'requests': [], 'root_cause_text': 0, 'debug_report': 0, 'skill_reads': 0, 'timeouts': 0})
    h['sessions'] += 1; h['head_moved'] += bool(e['head_moved']); h['empty_patch'] += not e['patch_bytes']
    h['tool_calls'].append(e['n_tool_calls']); h['requests'].append(e['requests']); h['root_cause_text'] += bool(e['root_cause_text'])
    h['debug_report'] += bool(e['debug_report']); h['skill_reads'] += e['skill_reads']; h['timeouts'] += e['termination'] == 'timeout'
for arm, h in hard.items():
    for k in ('tool_calls', 'requests'):
        v = h.pop(k); h[k] = {'min': min(v), 'median': statistics.median(v), 'max': max(v)}
out['gn-hard-follow-2026-11']['extras_by_arm'] = hard

def ledger(p):
    return j(p)['committed_usd']
out['ledgers_usd'] = {
    'gn-follow-2026-11': ledger('gn-follow-2026-11/ledger-summary.json'),
    'gn-follow-preset-2026-11': ledger('gn-follow-preset-2026-11/ledger-summary.json'),
    'gn-hard-follow-2026-11-gstack': ledger('gn-hard-follow-2026-11/gstack/ledger-summary.json'),
    'gn-hard-follow-2026-11-none': ledger('gn-hard-follow-2026-11/none/ledger-summary.json'),
}
out['ledgers_usd']['total'] = round(sum(out['ledgers_usd'].values()), 4)
vm = {}
for p in ('gn-follow-2026-11/shard-vm.json', 'gn-follow-preset-2026-11/shard-vm.json', 'gn-hard-follow-2026-11/gstack/shard-vm.json', 'gn-hard-follow-2026-11/none/shard-vm.json'):
    s = j(p); vm[p.rsplit('/', 1)[0]] = {'vm': s['vm'], 'location': s['location'], 'size': s['size'], 'commit': s['commit'], 'minutes': s['cost']['vm_minutes'], 'list_usd': s['cost']['list_price_usd'], 'cleanup': s['cleanup']}
out['vms'] = vm
preset_like = out['gn-follow-preset-2026-11']['arms']['gstack']; hardg = out['gn-hard-follow-2026-11']['arms']['gstack']
out['pooled_descriptive_only'] = {
    'all_three': {'followed': gstack_followed, 'sessions': gstack_den, 'wilson95': wilson(gstack_followed, gstack_den)},
    'claude_code_preset_runs': {'followed': preset_like['followed'] + hardg['followed'], 'sessions': preset_like['denominator'] + hardg['denominator'],
                                'wilson95': wilson(preset_like['followed'] + hardg['followed'], preset_like['denominator'] + hardg['denominator'])},
}
print(json.dumps(out, indent=1))
