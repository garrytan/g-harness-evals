#!/usr/bin/env python3
"""Audit 1: for every recalled trial, the brain item that served the recall (from the recall turn's credited gbrain call output)
and where the brain holds the nonce (from a read-only copy of state/.gbrain/brain.pglite). Inputs are written by recall-events.ts,
save-events.ts and tools/brain-dump.ts (run-brains.sh)."""
import json, re, collections, sys
if len(sys.argv) != 3:
    sys.exit('usage: python3 audit1.py <run dir> <audits dir>  (reads <audits dir>/scratch from recall-events.ts, save-events.ts and run-brains.sh)')
RUN, A = sys.argv[1], sys.argv[2]
recs = [json.loads(l) for l in open(RUN + '/merged/trials.jsonl') if l.strip()]
ev = {t['trial_id']: t for t in json.load(open(A + '/scratch/recall-events.json'))}
sv = {t['trial_id']: t for t in json.load(open(A + '/scratch/save-events.json'))}
br = {t['trial_id']: t for t in json.load(open(A + '/scratch/brains.json'))}
dec = json.JSONDecoder()

def lead_json(s):
    s = s.strip()
    try:
        v, i = dec.raw_decode(s); return v, s[i:]
    except Exception:
        return None, s

def holders(v, n, path=''):
    out = []
    if isinstance(v, dict):
        for k, x in v.items(): out += holders(x, n, path + '/' + k)
    elif isinstance(v, list):
        for i, x in enumerate(v): out += [(p, o if o is not None else x) for p, o in holders(x, n, path + '[]')]
    elif isinstance(v, str) and n.lower() in v.lower():
        out.append((path, None))
    return out

def items_of(v, n):
    """(kind, id) for every list item under facts / results that holds the nonce."""
    found = []
    def walk(x, key):
        if isinstance(x, dict):
            for k, y in x.items(): walk(y, k)
        elif isinstance(x, list):
            for y in x:
                if n.lower() in json.dumps(y).lower():
                    if key == 'facts': found.append(('fact', str(y.get('id', y.get('fact_id'))) if isinstance(y, dict) else None))
                    elif key == 'results': found.append(('page', y.get('slug') if isinstance(y, dict) else None))
                    else: walk(y, key)
    walk(v, None)
    return found

def serving(output, n):
    v, rest = lead_json(output)
    blobs = []
    if isinstance(v, dict) and isinstance(v.get('result'), str):
        inner, rest2 = lead_json(v['result'])
        if inner is not None: blobs.append(inner)
        rest = rest2 + '\n' + rest
        if 'structuredContent' in v: blobs.append(v['structuredContent'])
    elif v is not None:
        blobs.append(v)
    items = [it for b in blobs for it in items_of(b, n)]
    method = 'structured'
    if not items:
        method = 'text'
        text = output.replace('\\n', '\n').replace('\\"', '"')
        for m in re.finditer(re.escape(n), text, re.I):
            before, after = text[max(0, m.start() - 400):m.start()], text[m.end():m.end() + 60]
            fm = list(re.finditer(r'excerpt from fact (\d+)', before))
            if fm: items.append(('fact', fm[-1].group(1)))
            elif re.search(r'; fact\)', after) or '"fact"' in before[-200:] or '"text"' in before[-120:]: items.append(('fact', None))
            elif re.search(r'"slug"\s*:\s*"([^"]+)"', before): items.append(('page', re.findall(r'"slug"\s*:\s*"([^"]+)"', before)[-1]))
            else: items.append(('unclassified', None))
    kinds = sorted(set(k for k, _ in items))
    return {'method': method, 'items': sorted(set((k, i or '') for k, i in items)), 'kinds': kinds,
            'archive_slug_in_output': bool(re.search(r'conversations/', output))}

trials = []
for r in recs:
    if r['install']['outcome'] != 'recalled': continue
    tid, n = r['trial_id'], r['install']['nonce']
    e = ev[tid]
    served = [dict(tool=c['name'], **serving(c['output'], n)) for c in e['credited']]
    kinds = sorted(set(k for s in served for k in s['kinds']))
    pages_served = sorted(set(i for s in served for k, i in s['items'] if k == 'page'))
    if 'page' in kinds and all(p.startswith('conversations/') for p in pages_served if p) and 'fact' not in kinds: served_class = 'archive page'
    elif 'page' in kinds and 'fact' not in kinds: served_class = 'explicit page'
    elif kinds == ['fact']: served_class = 'saved fact (facts table, not a page)'
    else: served_class = 'mixed/unclassified: ' + ','.join(kinds)
    b = br.get(tid, {})
    saves = [c for c in sv[tid]['calls'] if c['input_has_nonce'] and not c['is_error'] and re.search(r'remember', c['name'] + ' ' + c['input'])]
    save_wt = []
    for c in saves:
        o = c['output'].replace('\\"', '"')
        m = re.search(r'"write_through"\s*:\s*\{[^}]*\}', o)
        save_wt.append({'tool': c['name'], 'write_through': re.sub(r'\s+', ' ', m.group(0)) if m else None, 'fact_number': (re.search(r'remembered as fact #(\d+)', o) or [None, None])[1]})
    if not b.get('brain_pglite_exists'):
        held = 'unknown: brain not in the copy'
        pages, archive_pages, live_facts = None, None, None
    else:
        pages = [p['slug'] for p in b['pages_holding'] if not p['deleted_at']]
        archive_pages = [p for p in pages if p.startswith('conversations/')]
        explicit = [p for p in pages if not p.startswith('conversations/')]
        live_facts = [f for f in b['facts_holding'] if not f['expired_at']]
        if explicit: held = 'explicit page (and saved fact)' if live_facts else 'explicit page'
        elif live_facts: held = 'saved fact only, no page' + (' (an archive page also holds it)' if archive_pages else '')
        elif archive_pages: held = 'only archive pages (conversations/)'
        else: held = 'no live page or fact (other tables only)'
    trials.append({
        'trial_id': tid, 'cell': r['cell'], 'termination': r['termination'], 'counted': r['termination'] not in ('model_error', 'infra_error', 'exam_fault') and not (r['install']['classification'] or {}).get('infra'),
        'recall_served_by': served_class, 'served_detail': served, 'served_from_archive': served_class == 'archive page',
        'brain_holds': held, 'nonce_only_in_archive': held == 'only archive pages (conversations/)',
        'brain': None if not b.get('brain_pglite_exists') else {'tables_holding': b['tables_holding'], 'pages_holding': b['pages_holding'], 'facts_holding': b['facts_holding'],
                  'pages_total': b['pages_total'], 'archive_pages_total': b['archive_pages_total'], 'other_gbrain_files_holding': b['other_gbrain_files_holding'], 'raw_files_in_brain_pglite_holding': b['raw_files_in_brain_pglite_holding']},
        'save_turn_remember_calls': save_wt,
    })

cells = sorted(set(r['cell'] for r in recs))
table = []
for c in cells:
    ts = [t for t in trials if t['cell'] == c and t['counted']]
    table.append({'cell': c, 'recalled': len(ts), 'recalled_from_archive': sum(t['served_from_archive'] for t in ts), 'nonce_only_in_archive': sum(t['nonce_only_in_archive'] for t in ts),
                  'served_by_saved_fact': sum(t['recall_served_by'].startswith('saved fact') for t in ts), 'brain_not_in_copy': sum(t['brain_holds'].startswith('unknown') for t in ts)})
counted = [t for t in trials if t['counted']]
apart = [t for t in trials if not t['counted']]
out = {
    'audit': 1, 'run': 'gbrain-install-2026-11',
    'method': 'Recall turn re-parsed with the pinned transcript.ts; each credited event (isGbrainServed, not an error, nonce in output) classified by the result item holding the nonce (facts[] item, results[] page slug, or text fallback). Each brain.pglite copied to scratch and opened read-only-in-effect with pglite 0.4.3 (the version gbrain v0.60.734.0 ships); every public table searched with row::text ILIKE the nonce; pages split into conversations/ (archive) and other slugs.',
    'totals': {'recalled_trials': len(trials), 'counted_recalled': len(counted), 'reported_apart': [t['trial_id'] + ' (' + t['termination'] + ')' for t in apart],
               'recalled_from_archive': sum(t['served_from_archive'] for t in counted), 'nonce_only_in_archive': sum(t['nonce_only_in_archive'] for t in counted),
               'served_by': dict(collections.Counter(t['recall_served_by'] for t in counted)), 'brain_holds': dict(collections.Counter(t['brain_holds'] for t in counted)),
               'apart_served_by': dict(collections.Counter(t['recall_served_by'] for t in apart)), 'apart_brain_holds': dict(collections.Counter(t['brain_holds'] for t in apart))},
    'per_cell': table,
    'exceptions': {
        'brain_not_in_copy': [t['trial_id'] for t in trials if t['brain_holds'].startswith('unknown')],
        'explicit_page_holds_nonce': [{'trial_id': t['trial_id'], 'pages': [p['slug'] for p in t['brain']['pages_holding']]} for t in trials if t['brain'] and t['brain']['pages_holding']],
        'more_than_one_fact_or_expired_fact': [{'trial_id': t['trial_id'], 'facts': t['brain']['facts_holding']} for t in trials if t['brain'] and (len(t['brain']['facts_holding']) > 1 or any(f['expired_at'] for f in t['brain']['facts_holding']))],
        'archive_pages_exist_but_lack_nonce': [{'trial_id': t['trial_id'], 'archive_pages_total': t['brain']['archive_pages_total']} for t in trials if t['brain'] and t['brain']['archive_pages_total'] and not any(p['slug'].startswith('conversations/') for p in t['brain']['pages_holding'])],
        'save_write_through_written': [t['trial_id'] for t in trials if any(s['write_through'] and '"written": true' in s['write_through'].replace('":true', '": true') for s in t['save_turn_remember_calls'])],
        'save_turn_without_remember_with_nonce': [t['trial_id'] for t in trials if not t['save_turn_remember_calls']],
        'credited_events_with_text_method': [t['trial_id'] for t in trials if any(s['method'] == 'text' for s in t['served_detail'])],
    },
    'trials': trials,
}
json.dump(out, open(A + '/audit1.json', 'w'), indent=1)
print(json.dumps(out['totals'], indent=1))
for row in table: print(row)
print(json.dumps({k: (v if len(json.dumps(v)) < 1500 else str(len(v)) + ' items') for k, v in out['exceptions'].items()}, indent=1))
