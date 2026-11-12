#!/usr/bin/env python3
# internal-task step 0: Claude Code's own skill list for a capture, from the stream-json init record of its first turn
# (the skills array the CLI reports as loaded). Writes {names, reasons, raw} for analyze.py --list.
#
#   python3 scripts/skill-resolver/step0/claude-codex/claude-code-skills-list.py <capture dir> <out json>
import json
import sys
from pathlib import Path

cap, out = Path(sys.argv[1]), Path(sys.argv[2])
turn = sorted(cap.glob('run/trials/*/*/r1/logs/turns/turn-0001.claude.jsonl'))[0]
init = next(r for r in map(json.loads, turn.open()) if r.get('type') == 'system' and r.get('subtype') == 'init')
names = [s if isinstance(s, str) else s.get('name') for s in init['skills']]
out.write_text(json.dumps({'source': f'stream-json init record skills ({turn.name}), claude_code_version {init.get("claude_code_version")}',
                           'names': names, 'reasons': {}, 'raw': {'skills': init['skills'], 'slash_commands': len(init.get('slash_commands', []))}}, indent=1) + '\n')
print(f'init skills: {len(names)}')
