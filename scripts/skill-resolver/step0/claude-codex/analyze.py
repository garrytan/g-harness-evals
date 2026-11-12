#!/usr/bin/env python3
# internal-task step 0: read the first model request of a catalog capture (fake.ndjson from scripts/anatomy/capture.ts) and
# write summary.json (the step 0 keys) and details.json (every listed entry with its position and description length).
#
#   python3 scripts/skill-resolver/step0/claude-codex/analyze.py --capture <dir> --harness claude-code|codex --provider <p>
#       --config native|names-only|no-bundled --catalog <catalog dir with manifest.json> --pin <harness pin>
#       [--settings '<what this config changed>'] [--list <harness list output, json>]
import argparse
import json
import re
import statistics
from pathlib import Path

ap = argparse.ArgumentParser()
for a in ('capture', 'harness', 'provider', 'config', 'catalog', 'pin'):
    ap.add_argument(f'--{a}', required=True)
ap.add_argument('--settings', default='none (shipped defaults)')
ap.add_argument('--list')
args = ap.parse_args()
cap = Path(args.capture)
manifest = json.loads((Path(args.catalog) / 'manifest.json').read_text())
catalog = {s['name']: s for s in manifest['skills']}
first = json.loads((cap / 'fake.ndjson').open().readline())
body = first['body']

def texts():
    if 'system' in body:
        for i, s in enumerate(body['system']):
            yield f'system[{i}]', s.get('text', '')
    for i, m in enumerate(body.get('messages', body.get('input', []))):
        c = m.get('content')
        if isinstance(c, str):
            yield f'{"messages" if "messages" in body else "input"}[{i}] role={m.get("role")}', c
        elif isinstance(c, list):
            for j, p in enumerate(c):
                if isinstance(p, dict) and isinstance(p.get('text'), str):
                    yield f'{"messages" if "messages" in body else "input"}[{i}] role={m.get("role")} content[{j}]', p['text']

entries, where = [], None
if args.harness == 'claude-code':
    HEAD = 'The following skills are available for use with the Skill tool:'
    for loc, t in texts():
        start = t.find(HEAD)
        if start < 0:
            continue
        pos = start + len(HEAD)
        rest = t[pos:]
        lines, off, end = rest.split('\n'), pos, pos
        started = False
        for line in lines:
            if line.startswith('- '):
                started = True
                head, sep, desc = line[2:].partition(': ')
                name = head if sep else line[2:]
                entries.append({'name': name.split(' (')[0], 'shown_name': name, 'desc': desc if sep else '', 'line_chars': len(line)})
                end = off + len(line)
            elif started and line.strip():
                entries[-1]['desc'] += '\n' + line
                entries[-1]['line_chars'] += 1 + len(line)
                end = off + len(line)
            elif started:
                break
            off += len(line) + 1
        where = {'container': loc, 'header_offset': start, 'end_offset': end, 'container_chars': len(t)}
        break
else:
    ENTRY = re.compile(r'^- (?P<name>.+?)(?:: (?P<desc>.*))? \(file: (?P<path>[^)]*)\)$')
    for loc, t in texts():
        start = t.find('<skills_instructions>')
        if start < 0:
            continue
        a = t.find('### Available skills', start)
        z = t.find('</skills_instructions>', a)
        off = a
        for line in t[a:z].split('\n')[1:]:
            off_line = t.find(line, off)
            m = ENTRY.match(line)
            if m:
                entries.append({'name': m['name'], 'shown_name': m['name'], 'desc': m['desc'] or '', 'path': m['path'], 'line_chars': len(line)})
            elif line.strip():
                entries.append({'name': None, 'raw': line, 'line_chars': len(line)})
            off = off_line + len(line)
        where = {'container': loc, 'header_offset': start, 'list_offset': a, 'end_offset': z + len('</skills_instructions>'), 'container_chars': len(t)}
        break

roots = {}
if args.harness == 'codex' and where:
    t = dict(texts())[where['container']]
    roots = dict(re.findall(r'^- `(r\d+)` = `([^`]+)`', t[where['header_offset']:where['list_offset']], re.M))
    where['roots'] = roots
def frontmatter_desc(n):
    md = (Path(args.catalog) / 'skills' / n / 'SKILL.md').read_text(errors='ignore')
    m = re.search(r'^description:[ \t]*(\S.*)$', md.split('---', 2)[1] if md.startswith('---') else '', re.M)
    one = m.group(1).strip() if m and m.group(1).strip() not in ('|', '>', '|-', '>-') else None
    if one and one[0] in '"\'' and one[-1] == one[0]:
        one = one[1:-1]
    w = re.search(r'^when_to_use:[ \t]*(\S.*)$', md.split('---', 2)[1] if md.startswith('---') else '', re.M)
    return one if one is not None else (catalog[n]['description'] or ''), (w.group(1).strip() if w else None)

for i, e in enumerate(entries):
    e['index'] = i
    root = roots.get((e.get('path') or '').split('/')[0], '')
    e['catalog'] = e['name'] in catalog and (args.harness != 'codex' or root.endswith('/codex/skills'))
    e['desc_chars'] = len(e.get('desc', ''))
    if e['catalog']:
        desc, when = frontmatter_desc(e['name'])
        e['catalog_desc_chars'] = len(desc.strip()) + (len(' - ' + when) if when and args.harness == 'claude-code' else 0)
listed = [e for e in entries if e['catalog']]
bundled = [e for e in entries if not e['catalog']]
names = [e['name'] for e in listed]
d = [e['desc_chars'] for e in listed]

order = []
if names == sorted(names):
    order.append('catalog skills in byte order of name (alphabetical)')
else:
    order.append('catalog skills not in alphabetical order')
if bundled:
    bi = [e['index'] for e in bundled]
    ci = [e['index'] for e in listed]
    order.append(f'{len(bundled)} harness skills ' + ('before' if max(bi) < min(ci) else 'after' if min(bi) > max(ci) else 'interleaved with') + ' the catalog')
described = [e for e in listed if e['desc_chars'] > 0]
if 0 < len(described) < len(listed):
    order.append(f'{len(described)} catalog skills with a description, {len(listed) - len(described)} with the name only; '
                 f'described names are {"the alphabetically first" if [e["name"] for e in described] == sorted(names)[:len(described)] else "not a prefix of the alphabetical order"}')

listing_chars = (where['end_offset'] - where['header_offset']) if where else 0
eligible, ineligible = None, []
if args.list:
    lst = json.loads(Path(args.list).read_text())
    seen = set(lst['names'])
    eligible = len([n for n in catalog if n in seen])
    for n in sorted(catalog):
        if n not in seen:
            ineligible.append({'name': n, 'reason': lst.get('reasons', {}).get(n, 'not in the harness list')})
listed_set = set(names)
for n in sorted(catalog):
    if n not in listed_set and not any(i['name'] == n for i in ineligible):
        md = (Path(args.catalog) / 'skills' / n / 'SKILL.md').read_text(errors='ignore')
        fm = md.split('---', 2)[1] if md.startswith('---') else ''
        why = 'loaded but not in the model-visible listing'
        if re.search(r'^disable-model-invocation:\s*true', fm, re.M):
            why += ' (frontmatter disable-model-invocation: true)'
        ineligible.append({'name': n, 'reason': why})

notes = []
full = [e for e in listed if e['desc_chars'] >= e['catalog_desc_chars']]
notes.append(f'{len(full)} of {len(listed)} listed catalog skills show their whole description '
             f'(Claude Code: description, plus " - " and when_to_use when set); {len([e for e in listed if e["desc_chars"] == 0])} show the name only')
if args.harness == 'claude-code':
    # Claude Code 2.1.312 (binary function Ion): when the full listing exceeds the budget it keeps bundled entries whole, every
    # other skill as "- <name>", then hands descriptions out greedily in listing priority order (usage, then load order).
    sep = max(0, len(entries) - 1)
    forced = sum(len(e['shown_name']) + 4 + e['desc_chars'] for e in bundled) + sum(len(e['shown_name']) + 2 for e in listed) + sep
    if any(e['desc_chars'] == 0 for e in listed):
        used, hi = 0, None
        for e in listed:
            extra = e['catalog_desc_chars'] + 2
            if e['desc_chars'] > 0:
                used += extra
            else:
                hi = min(hi, forced + used + extra - 1) if hi is not None else forced + used + extra - 1
        notes.append(f'priority mode: inferred effective budget {forced + used} to {hi} characters (listing accounting, every name kept)')
    else:
        notes.append(f'fits mode: the whole listing, {forced + sum(e["desc_chars"] + 2 for e in listed)} characters by the CLI accounting, is within the budget')
else:
    toks = sum(-(-len((ln + chr(10)).encode()) // 4) for ln in (dict(texts())[where['container']][where['list_offset']:where['end_offset']].split(chr(10))[1:-1]))
    notes.append(f'available-skills lines cost about {toks} tokens at 4 bytes per token (Codex approx_token_count)')
summary = {
    'harness': args.harness, 'pin': args.pin, 'provider': args.provider, 'config': args.config,
    'listing_location': where,
    'listed_count': len(listed), 'listed_names': names,
    'order_rule': '; '.join(order),
    'desc_chars': {'min': min(d) if d else None, 'median': statistics.median(d) if d else None, 'max': max(d) if d else None},
    'listing_chars': listing_chars,
    'bundled_listed': [{'name': e['name'], 'desc_chars': e['desc_chars']} for e in bundled],
    'eligible_count': eligible,
    'ineligible': ineligible,
    'notes': [f'settings: {args.settings}', f'model: {body.get("model")}', *notes],
}
(cap / 'summary.json').write_text(json.dumps(summary, indent=1) + '\n')
(cap / 'details.json').write_text(json.dumps({'entries': entries, 'location': where}, indent=1) + '\n')
print(json.dumps({k: summary[k] for k in ('harness', 'config', 'listed_count', 'desc_chars', 'listing_chars', 'eligible_count', 'order_rule')}))
print('bundled', [b['name'] for b in summary['bundled_listed']], 'ineligible', len(ineligible))
