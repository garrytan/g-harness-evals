import { gstackReads } from '../../../../../runner/trial/skill-requests.ts';
import { mkdtempSync } from 'node:fs';
const dir = mkdtempSync('/tmp/ctl-');
const mk = (h, name, input, result) => ({ messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name, input }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: result, is_error: false }] }] });
const cases = [
 ['openclaw', 'read', { path: '/root/.claude/skills/gstack/design-html/sections/preamble.md' }, '# preamble text'],
 ['openclaw', 'read', { path: '/root/.claude/skills/gstack/design-html/sections/preamble.md' }, 'ENOENT: no such file or directory, open /root/.claude/skills/gstack/design-html/sections/preamble.md'],
 ['openclaw', 'read', { path: '/workspace/skills/design-html/sections/preamble.md' }, '# preamble text'],
 ['hermes', 'terminal', { command: 'cat ~/.claude/skills/gstack/test-audit/sections/preamble.md 2>/dev/null || cat /harness-state/hermes/skills/test-audit/sections/preamble.md' }, '# preamble text'],
 ['qm', 'execute', { command: 'cat ~/.claude/skills/gstack/ios-clean/sections/preamble.md' }, 'cat: /root/.claude/skills/gstack/ios-clean/sections/preamble.md: No such file or directory'],
 ['qm', 'execute', { command: 'cat ~/.claude/skills/gstack/ios-clean/sections/preamble.md' }, ''],
 ['qm', 'execute', { command: '~/.claude/skills/gstack/bin/gstack-skill-start --skill x' }, 'not found'],
];
for (const [h, n, i, res] of cases) console.log(h, n, JSON.stringify(i).slice(0, 90), '=>', JSON.stringify(res).slice(0, 40), JSON.stringify(gstackReads(h, [mk(h, n, i, res)], dir)));
