#!/usr/bin/env python3
"""Read the fake endpoint's request log for one probe and print what the first
model turn carried: the model named, max_tokens, and where the gstack skill
appears in the system prompt (scripts/gsta-135/preflight.sh).

  system-prompt.py <requests.ndjson> <openclaw|hermes|qm> [--tool-result [--turn <n>]]

Prints key=value lines; exit 0 when a /v1/messages request was seen. The
"turn" requests are the ones that carry a tools array (the harness's agent
loop); a request without tools (Hermes's session title, for one) is counted
but never read as the first turn. For a scripted smoke (fake-anthropic.ts
--script) the second turn request holds the harness's own view of the tool it
ran: post_tool_max_tokens is that request's max_tokens, and --tool-result
prints only the text of its tool_result block (the receipt the preflight
asserts on) instead of the key=value lines; --turn <n> reads the n-th turn
request instead of the second (the result of the (n-1)-th scripted tool)."""
import json, re, sys

argv = sys.argv[1:]
tool_result_only = '--tool-result' in argv
turn = int(argv[argv.index('--turn') + 1]) if '--turn' in argv else 2
if '--turn' in argv:
    del argv[argv.index('--turn'):argv.index('--turn') + 2]
argv = [a for a in argv if a != '--tool-result']
path, harness = argv[0], argv[1]
rows = [json.loads(l) for l in open(path) if l.strip()]
messages = [r for r in rows if r.get('path', '').endswith('/v1/messages') and isinstance(r.get('body'), dict)]
turns = [r for r in messages if r['body'].get('tools')] or messages


def tool_result_text(body):
    """The text of the tool_result blocks in the request's last user message, joined."""
    for m in reversed(body.get('messages', [])):
        if m.get('role') != 'user' or not isinstance(m.get('content'), list):
            continue
        parts = []
        for block in m['content']:
            if not isinstance(block, dict) or block.get('type') != 'tool_result':
                continue
            c = block.get('content')
            if isinstance(c, str):
                parts.append(c)
            elif isinstance(c, list):
                parts.extend(x.get('text', '') for x in c if isinstance(x, dict))
        if parts:
            return '\n'.join(parts)
    return None


if tool_result_only:
    if len(turns) < turn:
        sys.exit(1)
    text = tool_result_text(turns[turn - 1]['body'])
    if text is None:
        sys.exit(1)
    if harness == 'hermes':
        # Hermes's terminal tool returns a JSON object {"output", "exit_code",
        # "error", ...}; a blocked command has an empty output and the BLOCKED
        # text in error.
        try:
            d = json.loads(text)
            text = str(d.get('output', '')) + '\nhermes_tool_exit_code=%s' % d.get('exit_code')
            for key in ('error', 'status'):
                if d.get(key) is not None:
                    text += '\nhermes_tool_%s=%s' % (key, d[key])
        except ValueError:
            pass
    print(text)
    sys.exit(0)

print('requests=%d' % len(rows))
print('message_requests=%d' % len(messages))
print('turn_requests=%d' % len(turns))
if not turns:
    print('first_turn=none')
    sys.exit(1)
b = turns[0]['body']
s = b.get('system')
text = s if isinstance(s, str) else '\n'.join(x.get('text', '') for x in (s or []) if isinstance(x, dict))
tool_names = [t.get('name') for t in b.get('tools', []) if isinstance(t, dict)]
print('model=%s' % b.get('model'))
print('max_tokens=%s' % b.get('max_tokens'))
print('post_tool_max_tokens=%s' % (turns[1]['body'].get('max_tokens') if len(turns) > 1 else 'none'))
print('post_tool_result=%s' % ('yes' if len(turns) > 1 and tool_result_text(turns[1]['body']) is not None else 'no'))
print('system_chars=%d' % len(text))
print('tools=%d' % len(tool_names))
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
    # The two skills blocks agent/prompt_builder.py can inject at v2026.9.24:
    # the interactive one ("you MUST load it", skill_manage patching, "offer
    # to save as a skill") and the one-shot one from agent/oneshot_footprint.py
    # ("Do not load general process skills"), keyed on HERMES_SINGLE_QUERY_SESSION.
    yes = lambda cond: 'yes' if cond else 'no'
    print('hermes_interactive_guidance=%s' % yes('you MUST load it with skill_view' in text))
    print('hermes_oneshot_block=%s' % yes('Do not load general process skills' in text))
    print('hermes_self_improvement_coaching=%s' % yes('offer to save as a skill' in text))
    print('hermes_skill_manage_tool=%s' % yes('skill_manage' in tool_names))
    print('hermes_delegate_tool=%s' % yes('delegate_task' in tool_names))
    print('hermes_clarify_tool=%s' % yes('clarify' in tool_names))
