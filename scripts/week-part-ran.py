#!/usr/bin/env python3
# Amendment 2's part-ran check (R111) for the always-on week run
# (docs/benchmarks/2026-11-22-always-on-week/PREREGISTRATION.md, "Amendment 2"). Keyless and offline.
#
#   python3 scripts/week-part-ran.py --results <merged dir> --shard-vm <cell>=<shard-vm.json> ... [--out part-ran.json]
#
# Per counted trial: the build check (shard commit, harness version before the restart and after it where the harness came
# back, and the gbrain build),
# a write to the arm's memory store and, after the harness restart, a read that returned stored content. An arm's memory
# part ran if every counted trial passes the build check and each task has at least one counted trial with both.
import argparse, gzip, json, os, re
from collections import defaultdict
from datetime import datetime

UNCOUNTED = {'model_error', 'infra_error', 'exam_fault'}
PLAN = '697828e4e72e8e794a90c06d35959fbb05c4d249'
AMEND1 = '55b9c347977eeb3b3bed7076b049d6776b5de869'
EXPECT = {
    'cc-opus-bare-week': {'commit': PLAN, 'version': '2.1.312', 'store': None},
    'cc-opus-files-week': {'commit': PLAN, 'version': '2.1.312', 'store': 'files'},
    'cc-opus-gbrain-week': {'commit': AMEND1, 'version': '2.1.312', 'store': 'gbrain',
                            'gbrain_commit': 'fe3dbef1fa40ceaea0ab6644009b6816c32658c6', 'gbrain_version': '0.60.763.0'},
    'qm-opus-native-week': {'commit': PLAN, 'version': 'main@77024e79', 'store': 'qm'},
}
MEM = re.compile(r'(/workspace/)?memory/')
WRITE_SHELL = re.compile(r'(>|\btee\b|\bcp\b|\bmv\b|\bsed\s+-i\b|\bprintf\b|\becho\b)')
READ_SHELL = re.compile(r'\b(cat|head|tail|grep|rg|sed|awk|less|more)\b')
NON_RESULT_READS = {'gbrain.initialize', 'gbrain.tools/list'}

def ts(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()

def ready(d, name):
    p = os.path.join(d, 'logs', name)
    return json.load(open(p)) if os.path.isfile(p) else None

def text_of(content):
    if isinstance(content, str): return content
    return ''.join(c.get('text', '') for c in content or [] if isinstance(c, dict))

def files_store(d, restart):
    uses, results = [], {}
    tdir = os.path.join(d, 'logs', 'turns')
    for f in sorted(os.listdir(tdir)) if os.path.isdir(tdir) else []:
        if not f.endswith('.claude.jsonl'): continue
        for line in open(os.path.join(tdir, f), errors='replace'):
            try: e = json.loads(line)
            except ValueError: continue
            for c in (e.get('message', {}).get('content') or []) if isinstance(e.get('message', {}).get('content'), list) else []:
                if not isinstance(c, dict): continue
                if c.get('type') == 'tool_use': uses.append((e.get('timestamp'), c))
                if c.get('type') == 'tool_result': results[c.get('tool_use_id')] = c
    wrote = read = False
    for at, c in uses:
        i = c.get('input') or {}
        path, cmd = str(i.get('file_path') or i.get('path') or ''), str(i.get('command') or '')
        r = results.get(c.get('id'))
        ok = r is not None and not r.get('is_error')
        if c['name'] in ('Write', 'Edit', 'MultiEdit') and MEM.search(path) and ok: wrote = True
        if c['name'] == 'Bash' and MEM.search(cmd) and WRITE_SHELL.search(cmd) and ok: wrote = True
        if not at or ts(at) <= restart or not ok: continue
        body = text_of(r.get('content')).strip()
        if not body or 'No such file' in body: continue
        if c['name'] == 'Read' and MEM.search(path): read = True
        if c['name'] == 'Bash' and MEM.search(cmd) and READ_SHELL.search(cmd): read = True
    mdir = os.path.join(d, 'workspace', 'memory')
    saved = any(os.path.getsize(os.path.join(r, n)) > 0 for r, _, ns in os.walk(mdir) for n in ns) if os.path.isdir(mdir) else False
    return {'write': wrote and saved, 'read': read, 'memory_files_saved': saved}

def gbrain_store(d, restart):
    wrote = read = False
    for line in open(os.path.join(d, 'events.jsonl')):
        e = json.loads(line)
        if e.get('outcome') != 'ok': continue
        if e.get('tool') == 'gbrain.ingest' and (e.get('effect') or {}).get('status') == 'inserted': wrote = True
        if e.get('via') == 'gbrain' and e.get('kind') == 'read' and e.get('tool') not in NON_RESULT_READS and ts(e['wall_ts']) > restart:
            eff = e.get('effect') or {}
            if eff.get('pages') or eff.get('facts'): read = True
    return {'write': wrote, 'read': read}

def qm_store(d, restart):
    p = os.path.join(d, 'logs', 'qm-db.sql.gz')
    if not os.path.isfile(p): return {'write': False, 'read': False, 'db_dump': False}
    facts = read = 0
    table = names = None
    with gzip.open(p, 'rt', errors='replace') as f:
        for line in f:
            if line.startswith('COPY '):
                table, names = line.split()[1], [x.strip() for x in line[line.find('(') + 1:line.find(')')].split(',')]; continue
            if line.startswith('\\.'):
                table = None; continue
            if table not in ('public.memory_facts', 'public.items'): continue
            c = dict(zip(names, line.rstrip('\n').split('\t')))
            if table == 'public.memory_facts' and c.get('deleted_at') == '\\N': facts += 1
            if table == 'public.items':
                at = c.get('created_at', '\\N')
                if at == '\\N' or datetime.fromisoformat(re.sub(r'\+00$', '+00:00', at)).timestamp() <= restart: continue
                k = line.find('## What you remember')
                if c['kind'] == 'UserMessage' and k >= 0 and '- (' in line[k:k + 1500] and 'untrusted-data' in line[k:k + 1500]: read += 1
                if c.get('tool') == 'memory' and c['kind'] == 'ToolResult' and c.get('is_error') != 't': read += 1
    return {'write': facts > 0, 'read': read > 0, 'memory_facts': facts, 'reads_after_restart': read}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--results', required=True)
    ap.add_argument('--shard-vm', action='append', default=[])
    ap.add_argument('--out')
    o = ap.parse_args()
    commits = {}
    for s in o.shard_vm:
        cell, path = s.split('=', 1)
        commits[cell] = json.load(open(path)).get('commit')
    trials = [json.loads(l) for l in open(os.path.join(o.results, 'trials.jsonl'))]
    arms = defaultdict(list)
    for t in trials:
        if t['termination'] in UNCOUNTED or t['cell'] not in EXPECT: continue
        x = EXPECT[t['cell']]
        d = os.path.join(o.results, 'trials', *t['trial_id'].split('/')[1:])
        before, after = ready(d, 'ready.before-restart-1'), ready(d, 'ready')
        build = {'commit': commits.get(t['cell']) == x['commit'],
                 'version_before_restart': bool(before) and before.get('version') == x['version'],
                 'version_after_restart': not after or after.get('version') == x['version']}
        if 'gbrain_commit' in x:
            m = os.path.join(d, 'gbrain', 'manifest.json')
            m = json.load(open(m)) if os.path.isfile(m) else {}
            build['gbrain_build'] = m.get('gbrain_commit') == x['gbrain_commit'] and m.get('gbrain_version') == x['gbrain_version']
        r = {'trial_id': t['trial_id'], 'task': t['task'], 'build': build, 'build_ok': all(build.values()),
             'ready_after_restart': bool(after)}
        if x['store']:
            restart = ts(after['ready_at']) if after else float('inf')
            r.update({'files': files_store, 'gbrain': gbrain_store, 'qm': qm_store}[x['store']](d, restart))
            r['part_ran'] = r['write'] and r['read']
        arms[t['cell']].append(r)
    out = {}
    for cell, rs in sorted(arms.items()):
        a = {'counted': len(rs), 'build_ok': sum(r['build_ok'] for r in rs)}
        if EXPECT[cell]['store']:
            tasks = sorted({r['task'] for r in rs})
            a.update({'write': sum(bool(r.get('write')) for r in rs), 'read': sum(bool(r.get('read')) for r in rs),
                      'part_ran': sum(bool(r.get('part_ran')) for r in rs),
                      'tasks_with_part_ran': sum(any(r.get('part_ran') for r in rs if r['task'] == k) for k in tasks), 'tasks': len(tasks),
                      'not_ran': [r['trial_id'] for r in rs if not r.get('part_ran')]})
            a['verdict'] = 'ran' if a['build_ok'] == a['counted'] and a['tasks_with_part_ran'] == a['tasks'] == 10 else 'left out (R111)'
        else:
            a['verdict'] = 'build ok' if a['build_ok'] == a['counted'] else 'build check failed'
        a['build_failures'] = [{'trial_id': r['trial_id'], 'build': r['build']} for r in rs if not r['build_ok']]
        a['no_harness_after_restart'] = [r['trial_id'] for r in rs if not r['ready_after_restart']]
        out[cell] = {'summary': a, 'trials': rs}
    json.dump(out, open(o.out or os.path.join(o.results, 'part-ran.json'), 'w'), indent=1)
    for cell, v in out.items(): print(cell, json.dumps({k: v['summary'][k] for k in v['summary'] if k != 'not_ran'}))

if __name__ == '__main__':
    main()
