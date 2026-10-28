#!/usr/bin/env python3
"""Read the fake endpoint's request log for one probe and print what the first
model turn carried: the model named, max_tokens, and where the gstack skill
appears in the system prompt (scripts/gsta-135/preflight.sh).

  system-prompt.py <requests.ndjson> <openclaw|hermes|qm>

Prints key=value lines; exit 0 when a /v1/messages request was seen."""
import json, re, sys

path, harness = sys.argv[1], sys.argv[2]
rows = [json.loads(l) for l in open(path) if l.strip()]
turns = [r for r in rows if r.get('path', '').endswith('/v1/messages') and isinstance(r.get('body'), dict)]
print('requests=%d' % len(rows))
print('message_requests=%d' % len(turns))
if not turns:
    print('first_turn=none')
    sys.exit(1)
b = turns[0]['body']
s = b.get('system')
text = s if isinstance(s, str) else '\n'.join(x.get('text', '') for x in (s or []) if isinstance(x, dict))
print('model=%s' % b.get('model'))
print('max_tokens=%s' % b.get('max_tokens'))
print('system_chars=%d' % len(text))
print('gstack_mentions=%d' % len(re.findall('gstack', text)))
if harness == 'openclaw':
    locs = re.findall(r'<skill>\s*<name>gstack</name>.*?<location>([^<]*)</location>', text, re.S)
    print('openclaw_gstack_skill_locations=%s' % ','.join(locs) if locs else 'openclaw_gstack_skill_locations=none')
    allskills = re.findall(r'<skill>\s*<name>([^<]*)</name>.*?<location>([^<]*)</location>', text, re.S)
    print('openclaw_gstack_named_skills=%d' % sum(1 for n, _ in allskills if n.startswith('gstack')))
elif harness == 'hermes':
    # Hermes lists categories as two-space "name: description" lines and the
    # skills under each as four-space "- name: description" lines; a
    # description may wrap onto a bare line.
    m = re.search(r'^  gstack:[^\n]*\n((?:(?!  [^ -])[^\n]*\n?)*)', text, re.M)
    rows_ = re.findall(r'^    - (gstack[\w-]*):', m.group(1), re.M) if m else []
    print('hermes_gstack_category=%s' % ('yes' if m else 'no'))
    print('hermes_gstack_category_rows=%d' % len(rows_))
    print('hermes_gstack_router_row=%s' % ('yes' if 'gstack' in rows_ else 'no'))
