#!/usr/bin/env python3
# internal-task step 0: ask Codex's own app server for its skill list (JSON-RPC skills/list over stdio), offline, against a
# copy of a capture's CODEX_HOME with the MCP server tables removed. Writes {names, reasons, raw} for analyze.py --list.
#
#   python3 scripts/skill-resolver/step0/claude-codex/codex-skills-list.py <capture dir> <image> <out json>
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

cap, image, out = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
state = next(cap.glob('run/trials/*/*/r1/state/codex'))
work = out.parent / (out.stem + '-home')
shutil.rmtree(work, ignore_errors=True)
shutil.copytree(state, work / 'codex', ignore=shutil.ignore_patterns('*.sqlite*', 'sessions', 'tmp'))
cfg = work / 'codex' / 'config.toml'
t = cfg.read_text()
cut = t.find('[mcp_servers.')
cfg.write_text(t[:cut] if cut >= 0 else t)
msgs = [
    {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'clientInfo': {'name': 'harn52-step0', 'version': '0'}}},
    {'jsonrpc': '2.0', 'method': 'initialized'},
    {'jsonrpc': '2.0', 'id': 2, 'method': 'skills/list', 'params': {'cwds': ['/workspace'], 'forceReload': True}},
]
p = subprocess.run(['docker', 'run', '--rm', '-i', '--network', 'none', '--user', f'{os.getuid()}:{os.getgid()}',
                    '-v', f'{work}:/harness-state', '-e', 'HOME=/harness-state', '-e', 'CODEX_HOME=/harness-state/codex',
                    '-w', '/tmp', '--entrypoint', 'sh', image, '-c',
                    'mkdir -p /workspace 2>/dev/null; (cat; sleep 8) | timeout 30 codex app-server'],
                   input=''.join(json.dumps(m) + '\n' for m in msgs), capture_output=True, text=True, timeout=90)
resp = None
for line in p.stdout.splitlines():
    try:
        r = json.loads(line)
    except ValueError:
        continue
    if r.get('id') == 2:
        resp = r
if resp is None:
    sys.exit(f'no skills/list response; stderr tail: {p.stderr[-800:]}')
names, reasons, raw = [], {}, []
for group in resp.get('result', {}).get('data', []):
    for s in group.get('skills', []):
        raw.append({k: s.get(k) for k in ('name', 'path', 'scope', 'enabled')})
        if s.get('enabled', True):
            names.append(s['name'])
        else:
            reasons[s['name']] = 'listed by skills/list with enabled=false'
    for e in group.get('errors', []):
        raw.append({'error': e})
out.write_text(json.dumps({'source': 'codex app-server skills/list', 'names': names, 'reasons': reasons, 'raw': raw}, indent=1) + '\n')
print(f'skills/list: {len(raw)} entries, {len(names)} enabled')
