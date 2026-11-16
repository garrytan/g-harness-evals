// scripts/gbrain-install, the install eval scoring, keyless: the four transcript parsers on fixture turns, the gbrain call and token rules, the
// two named stalls, scripted-reply counting, routes, the last gbrain code, the GitHub rate-limit rule, the Wilson interval and the
// failure table and verdict from a synthetic trials.jsonl. The OpenClaw and Hermes fixtures follow the shapes the adapters read; both
// parsers still need a live check.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asksForInput, classifyInstall, refOf, type InstallTurn, type Probe } from '../scripts/gbrain-install/classify.ts';
import { failureCsv, failureMarkdown, failureTable } from '../scripts/gbrain-install/failure-table.ts';
import { stepOf } from '../scripts/gbrain-install/steps.ts';
import { gbrainArgvFromShell, githubRateLimited, hasToken, isGbrainCall, isGbrainServed, parseHermes, parseTurn, type NEvent } from '../scripts/gbrain-install/transcript.ts';
import { verdict, verdictMarkdown, wilson, type InstallTrialRecord } from '../scripts/gbrain-install/verdict.ts';

const ROOT = join(import.meta.dir, '..');
const FIX = join(import.meta.dir, 'fixtures', 'gbrain-install', 'transcripts');
const T0 = '2026-11-15T00:00:00.000Z';
const at = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();
const probe = (p: Partial<Probe> = {}): Probe => ({ harness: 'claude-code', at: at(0), binary: null, version: null, brain: false, brain_path: null, mcp: false, instructions: false, hook: false, wired: [], ok: false, ...p });
const BIN = probe({ binary: '/root/.bun/bin/gbrain', version: '0.60.717.0' });
const BRAIN = probe({ binary: '/root/.bun/bin/gbrain', version: '0.60.717.0', brain: true, brain_path: '/root/.gbrain/brain.pglite' });
const OK = probe({ binary: '/root/.bun/bin/gbrain', version: '0.60.717.0', brain: true, brain_path: '/root/.gbrain/brain.pglite', mcp: true, wired: ['.claude.json'], ok: true });
const turn = (n: number, role: InstallTurn['role'], events: NEvent[], p: Probe | null, reply: string | null = null): InstallTurn => ({ turn: n, session: role === 'recall' ? 's2' : role === 'hinted' ? 's3' : 's1', role, text: '', reply_text: reply, exit: 0, started_at: at(n * 60 - 60), ended_at: at(n * 60), probe: p, events });
const shell = (input: string, output = '', exit_code: number | null = 0): NEvent => ({ kind: 'shell', name: 'Bash', input, output, is_error: exit_code !== null && exit_code !== 0, exit_code, session: 's1', turn: 1 });
const classify = (turns: InstallTurn[], harness = 'claude-code', extra: Partial<Parameters<typeof classifyInstall>[0]> = {}) => classifyInstall({ harness, turns, watch: [], egress: [], started_at: T0, ...extra });
const routeOf = (...cmds: Array<[string, number]>) => classify([turn(1, 'arm', cmds.map(([c, x]) => shell(c, '', x)), null)]).route;

describe('parseTurn', () => {
  test('Claude Code stream-json: text, web and shell events with exit codes, and gbrain MCP calls named server__tool', () => {
    const t1 = parseTurn('claude-code', join(FIX, 'claude'), 1, 's1');
    expect(t1.map(e => e.kind)).toEqual(['text', 'web', 'shell', 'shell', 'text']);
    expect(t1[1].input).toBe('https://raw.githubusercontent.com/garrytan/gbrain/stable/INSTALL_FOR_AGENTS.md');
    expect(t1[2]).toMatchObject({ name: 'Bash', input: 'bun install -g github:garrytan/gbrain', exit_code: 0, is_error: false, session: 's1', turn: 1 });
    expect(t1[2].output).toContain('Blocked 1 postinstall');
    expect(t1.map(isGbrainCall)).toEqual([false, false, false, true, false]);
    const t2 = parseTurn('claude-code', join(FIX, 'claude'), 2, 's1');
    expect(t2[0]).toMatchObject({ kind: 'mcp', name: 'gbrain__put_page', is_error: false });
    expect(JSON.parse(t2[0].input).slug).toBe('family/sister-cat');
    expect(isGbrainCall(t2[0])).toBe(true);
    const t3 = parseTurn('claude', join(FIX, 'claude'), 3, 's1');
    expect(t3[0]).toMatchObject({ kind: 'shell', exit_code: 1, is_error: true });
  });

  test('Codex exec --json: command_execution with exit codes, mcp_tool_call, agent_message; reasoning is skipped', () => {
    const ev = parseTurn('codex', join(FIX, 'codex'), 1, 's1');
    expect(ev.map(e => e.kind)).toEqual(['shell', 'shell', 'shell', 'mcp', 'text']);
    expect(ev.slice(0, 3).map(e => [e.exit_code, e.is_error])).toEqual([[243, true], [243, true], [128, true]]);
    expect(ev[3]).toMatchObject({ name: 'gbrain__search', output: 'no results', is_error: false });
    expect(ev[4].output).toContain('Do you want me to install it with sudo');
  });

  test('OpenClaw session export: toolCall blocks paired with toolResult messages by toolCallId, exit codes, the envelope final text last', () => {
    const ev = parseTurn('openclaw', join(FIX, 'openclaw'), 2, 's1');
    expect(ev.map(e => [e.kind, e.name])).toEqual([['text', 'assistant'], ['shell', 'exec'], ['shell', 'exec'], ['mcp', 'gbrain__put_page'], ['text', 'assistant']]);
    expect(ev[0].output).toBe('Installing gbrain with Bun.');
    expect(ev[1]).toMatchObject({ input: 'bun install -g github:garrytan/gbrain', exit_code: 0, is_error: false });
    expect(ev[1].output).toContain('Blocked 1 postinstall');
    expect(ev[2]).toMatchObject({ input: 'gbrain doctor --json', exit_code: 1, is_error: true });
    expect(ev[3]).toMatchObject({ output: '{"ok":true}', is_error: false });
    expect(JSON.parse(ev[3].input).slug).toBe('family/sister-cat');
    expect(ev[4].output).toStartWith('gbrain 0.60.717.0 is installed');
    expect(ev.map(isGbrainCall)).toEqual([false, false, true, true, false]);
    const c = classifyInstall({ harness: 'openclaw', turns: [turn(1, 'arm', ev, BIN, ev[4].output)], watch: [], egress: [], started_at: T0 });
    expect([c.route, c.last_gbrain_code, c.stalls.map(s => s.label)]).toEqual(['bun-github', 'brain_not_found', ['One install step was blocked by Bun']]);
  });

  test('OpenClaw envelope alone: tool names from meta.toolSummary with no input or output, and the final text', () => {
    const ev = parseTurn('openclaw', join(FIX, 'openclaw'), 1, 's2');
    expect(ev.map(e => [e.kind, e.name, e.input, e.output])).toEqual([['shell', 'exec', '', ''], ['mcp', 'gbrain__put_page', '', ''], ['web', 'web_fetch', '', ''], ['text', 'assistant', '', 'Installed gbrain and wired it in.']]);
    expect(ev.every(e => e.session === 's2' && e.turn === 1)).toBe(true);
    expect(isGbrainCall(ev[1])).toBe(true);
  });

  test('Hermes stream-json: tool_use paired with tool_result by tool_call_id, the terminal JSON unpacked, one text event', () => {
    const ev = parseTurn('hermes', join(FIX, 'hermes'), 1, 's2');
    expect(ev.map(e => [e.kind, e.name])).toEqual([['shell', 'terminal'], ['other', 'memory'], ['text', 'assistant']]);
    expect(ev[0]).toMatchObject({ input: "gbrain query 'sister cat'", output: "Vorlimb: my sister's new cat", exit_code: 0, is_error: false });
    expect(JSON.parse(ev[1].input)).toMatchObject({ action: 'add' });
    const failed = parseHermes([{ type: 'tool_use', name: 'terminal', tool_call_id: 'a', input: { command: 'npm install -g gbrain' } }, { type: 'tool_result', name: 'terminal', tool_call_id: 'a', output: JSON.stringify({ output: 'npm error code EACCES', exit_code: 243, error: null }), duration_ms: 900, is_error: false }].map(x => JSON.stringify(x)).join('\n'), 's1', 1);
    expect(failed[0]).toMatchObject({ kind: 'shell', exit_code: 243, is_error: true, output: 'npm error code EACCES' });
    expect(isGbrainCall(ev[0])).toBe(true);
  });

  test('Hermes session export: the whole tool output from state.db replaces the stream output Hermes cut at 5,000 characters', () => {
    const stream = readFileSync(join(FIX, 'hermes', 'turns', 'turn-0002.hermes.jsonl'), 'utf8');
    const cut = parseHermes(stream, 's2', 2);
    expect(isGbrainCall(cut[0])).toBe(true);
    expect(hasToken(cut[0].output, 'Quillfern')).toBe(false);
    const ev = parseTurn('hermes', join(FIX, 'hermes'), 2, 's2');
    expect(ev.map(e => [e.kind, e.name])).toEqual([['shell', 'terminal'], ['text', 'assistant']]);
    expect(isGbrainCall(ev[0])).toBe(true);
    expect(ev[0]).toMatchObject({ input: 'gbrain query cat --limit 200', exit_code: 0, is_error: false });
    expect(ev[0].output.length).toBeGreaterThan(5000);
    expect(hasToken(ev[0].output, 'Quillfern')).toBe(true);
    const tool = (callId: string, extra: Record<string, unknown>) => JSON.stringify({ turn: 1, session_id: 's', id: 1, role: 'tool', tool_call_id: callId, tool_name: 'terminal', ...extra });
    const spilled = tool('a', { content: '<persisted-output>\nFull output saved to: /h/cache/spillover/a.txt\n</persisted-output>', spillover: { path: '/h/cache/spillover/a.txt', content: JSON.stringify({ output: 'page list ... Quillfern', exit_code: 0, error: null }) } });
    const use = (callId: string) => JSON.stringify({ type: 'tool_use', name: 'terminal', tool_call_id: callId, input: { command: 'gbrain list' } });
    const res = (callId: string) => JSON.stringify({ type: 'tool_result', name: 'terminal', tool_call_id: callId, output: '{"output":"page list', is_error: false });
    expect(parseHermes([use('a'), res('a')].join('\n'), 's1', 1, spilled)[0].output).toBe('page list ... Quillfern');
    expect(parseHermes([use('b'), res('b')].join('\n'), 's1', 1, tool('a', { content: 'other' }))[0].output).toBe('{"output":"page list');
  });

  test('a missing turn file is no events; an unknown harness is an error', () => {
    expect(parseTurn('codex', join(FIX, 'codex'), 9, 's1')).toEqual([]);
    expect(() => parseTurn('qm', join(FIX, 'codex'), 1, 's1')).toThrow('unknown harness');
  });
});

describe('gbrain calls and tokens', () => {
  test('the gbrain CLI counts only in command position', () => {
    const yes = ['gbrain init', "/bin/bash -lc 'gbrain put family/cat --content x'", '~/.bun/bin/gbrain --version', 'cd ~ && gbrain doctor --json', 'export PATH=$HOME/.bun/bin:$PATH; gbrain query cat', 'GBRAIN_HOME=/x timeout 30 gbrain sync', '"$HOME/.bun/bin/gbrain" init', 'bunx gbrain search cat', 'gbrain'];
    const no = ['bun install -g github:garrytan/gbrain', 'cd gbrain && bun install', 'which gbrain', 'ls ~/.gbrain', 'git clone https://github.com/garrytan/gbrain ~/gbrain', 'cat ~/gbrain/README.md', 'echo gbrain-ready'];
    expect(yes.map(c => isGbrainCall(shell(c)))).toEqual(yes.map(() => true));
    expect(no.map(c => isGbrainCall(shell(c)))).toEqual(no.map(() => false));
    expect(gbrainArgvFromShell('gbrain put a "b c" > /tmp/out 2>&1')).toEqual([['put', 'a', 'b c']]);
    const mcp = (name: string): NEvent => ({ kind: 'mcp', name, input: '{}', output: '', is_error: false, exit_code: null, session: 's1', turn: 1 });
    expect([mcp('gbrain__search'), mcp('GBrain__query'), mcp('world__post_message'), mcp('notgbrain__search')].map(isGbrainCall)).toEqual([true, true, false, false]);
  });

  test('gbrain-served: only a whole command that is one gbrain invocation, or a gbrain MCP call', () => {
    const yes = ['gbrain query cat', "/bin/bash -lc 'gbrain get family/sister-cat'", '~/.bun/bin/gbrain get family/cat 2>&1', 'GBRAIN_HOME=/x timeout 30 gbrain query "sister; cat"', "gbrain query 'a && b | c'", 'gbrain query cat > /tmp/out 2>&1', 'gbrain query cat &>/tmp/out', 'gbrain query "sister cat" | head -40', 'cd ~ && gbrain query cat', 'cd ~ && gbrain query cat 2>&1 | tail -n 5'];
    const no = ['gbrain --version; cat notes.txt', 'gbrain query cat && cat notes.txt', 'gbrain query cat || cat notes.txt', 'gbrain query cat | grep Vorlimb', '(gbrain query cat)', 'gbrain query "$(cat notes.txt)"', 'gbrain query `cat notes.txt`', 'cat notes.txt; gbrain query cat', 'gbrain query cat & cat notes.txt', 'gbrain query cat\ncat notes.txt', 'export PATH=$HOME/.bun/bin:$PATH; gbrain query cat', "/bin/bash -lc 'gbrain --version; cat notes.txt'", 'cat notes.txt', 'echo gbrain', 'timeout 30 sh -c "cat notes.txt; gbrain --version"', 'eval "cat notes.txt; gbrain --version"', `sh -c 'sh -c "cat notes.txt; gbrain --version"'`, 'echo cat | xargs gbrain query', 'gbrain query cat | head -40 notes.txt', 'cd ~ && cat notes.txt', 'cd ~ && gbrain query cat && cat notes.txt'];
    expect(yes.map((c) => isGbrainServed(shell(c)))).toEqual(yes.map(() => true));
    expect(no.map((c) => isGbrainServed(shell(c)))).toEqual(no.map(() => false));
    expect(isGbrainCall(shell('gbrain --version; cat notes.txt'))).toBe(true);
    const mcp = (name: string): NEvent => ({ kind: 'mcp', name, input: '{}', output: '', is_error: false, exit_code: null, session: 's1', turn: 1 });
    expect([mcp('gbrain__query'), mcp('gbrain-local__search'), mcp('world__post_message')].map(isGbrainServed)).toEqual([true, true, false]);
  });

  test('hasToken: whole token, case and punctuation ignored, never a substring', () => {
    expect(hasToken("Her new cat is **Vorlimb**.", 'vorlimb')).toBe(true);
    expect(hasToken('VORLIMB!', 'Vorlimb')).toBe(true);
    expect(hasToken('\u201cVorlimb\u2019s\u201d bowl', 'vorlimb')).toBe(true);
    expect(hasToken('(vorlimb)', 'Vorlimb.')).toBe(true);
    expect(hasToken('Vorlimbs', 'vorlimb')).toBe(false);
    expect(hasToken('xvorlimb', 'vorlimb')).toBe(false);
    expect(hasToken('Vorlimbian', 'vorlimb')).toBe(false);
    expect(hasToken('Vor limb', 'vorlimb')).toBe(false);
    expect(hasToken('', 'vorlimb')).toBe(false);
    expect(hasToken('anything', '')).toBe(false);
  });

  test('githubRateLimited: GitHub answering 429 or a rate limit in a tool output, not a 429 from elsewhere or in text', () => {
    expect(githubRateLimited(parseTurn('codex', join(FIX, 'codex'), 1, 's1'))).toBe(true);
    expect(githubRateLimited(parseTurn('claude-code', join(FIX, 'claude'), 1, 's1'))).toBe(false);
    expect(githubRateLimited([shell('curl -sI https://api.github.com/repos/garrytan/gbrain', 'HTTP/2 403\nx-ratelimit-remaining: 0')])).toBe(true);
    expect(githubRateLimited([shell('bun install -g github:garrytan/gbrain', 'error: GET https://codeload.github.com/garrytan/gbrain/tar.gz/stable - 429')])).toBe(true);
    expect(githubRateLimited([shell('npm install -g gbrain', 'npm error 429 Too Many Requests - GET https://registry.npmjs.org/gbrain')])).toBe(false);
    expect(githubRateLimited([{ ...shell('x'), kind: 'text', output: 'GitHub rate limit exceeded' }])).toBe(false);
  });
});

describe('stalls and person-needed events', () => {
  const claude = (n: number) => parseTurn('claude-code', join(FIX, 'claude'), n, 's1');

  test("stall (a): Bun's Blocked 1 postinstall line in a tool output, echoed by the agent, at the probe's step", () => {
    const c = classify([turn(1, 'arm', claude(1), BIN)]);
    expect(c.stalls).toEqual([{ kind: 'blocked-step', step: 'brain', label: 'One install step was blocked by Bun', turn: 1 }]);
    expect(c.person_needed).toEqual([{ turn: 1, step: 'brain', kind: 'blocked-step' }]);
  });

  test('stall (a) is not counted when the agent does not echo the line, or when no tool output holds it', () => {
    const quiet = claude(1).map(e => e.kind === 'text' ? { ...e, output: 'gbrain is installed.' } : e);
    expect(classify([turn(1, 'arm', quiet, BIN, 'gbrain is installed.')]).stalls).toEqual([]);
    expect(classify([turn(1, 'save', claude(2), OK)]).stalls).toEqual([]);
  });

  test('stall (b): a turn that ends on a question while the probe does not pass, on Claude Code and Codex', () => {
    const c = classify([turn(1, 'arm', claude(3), BIN)]);
    expect(c.stalls).toEqual([{ kind: 'question', step: 'brain', label: 'Stopped to ask a question at step brain', turn: 1 }]);
    expect(c.person_needed).toEqual([{ turn: 1, step: 'brain', kind: 'question' }]);
    const x = classify([turn(1, 'arm', parseTurn('codex', join(FIX, 'codex'), 1, 's1'), null)], 'codex');
    expect(x.stalls.map(s => [s.kind, s.label])).toEqual([['blocked-step', 'One install step was refused for file permissions (EACCES)'], ['question', 'Stopped to ask a question at step binary']]);
  });

  test('stall (b): a question at the save step counts once, tagged saved, with no scripted reply', () => {
    const c = classify([turn(1, 'arm', [], OK, 'gbrain is installed.'), turn(2, 'save', claude(2), OK, 'Should I save this to gbrain or to your notes?')]);
    expect(c.stalls).toEqual([{ kind: 'question', step: 'saved', label: 'Stopped to ask a question at step saved', turn: 2 }]);
    expect(c.person_needed).toEqual([{ turn: 2, step: 'saved', kind: 'question' }]);
    expect(c.person_needed.filter(x => x.kind === 'scripted-reply')).toEqual([]);
    expect(classify([turn(1, 'arm', claude(3), OK)]).stalls).toEqual([{ kind: 'question', step: 'saved', label: 'Stopped to ask a question at step saved', turn: 1 }]);
  });

  test('stall (b): the recall turn counts only when the recall missed, and the hinted turn never', () => {
    const recall = turn(3, 'recall', [], OK, 'Your sister is Maya. Anything else?');
    expect(classify([recall], 'claude-code', { finish: true }).stalls).toEqual([]);
    expect(classify([recall], 'claude-code', { finish: false }).stalls).toEqual([{ kind: 'question', step: 'recalled', label: 'Stopped to ask a question at step recalled', turn: 3 }]);
    expect(classify([turn(4, 'hinted', [], OK, 'Should I check gbrain?')], 'claude-code', { finish: false }).stalls).toEqual([]);
  });

  test('stall (b) is not counted when the turn ends without a question', () => {
    expect(classify([turn(1, 'arm', claude(1), BRAIN, 'Next I will wire gbrain into Claude Code.')]).stalls.filter(s => s.kind === 'question')).toEqual([]);
    expect(asksForInput('Done. Tell me if you want embeddings later.')).toBe(false);
    expect(asksForInput('I can set it up two ways:\n\n- Local brain\n- Hosted brain\n\nWhich would you like?')).toBe(true);
  });

  test('every scripted reply is one person-needed event at the step of the turn before it, whatever the harness, arm or text', () => {
    const roles: Array<[InstallTurn['role'], Probe | null]> = [['arm', null], ['reply', BIN], ['reply', BRAIN], ['reply', OK], ['save', OK]];
    const run = (harness: string, events: NEvent[]) => classify(roles.map(([role, p], i) => turn(i + 1, role, events, p, 'Working on it.')), harness).person_needed.filter(e => e.kind === 'scripted-reply');
    const want = [{ turn: 2, step: 'binary', kind: 'scripted-reply' as const }, { turn: 3, step: 'brain', kind: 'scripted-reply' as const }, { turn: 4, step: 'wired', kind: 'scripted-reply' as const }];
    expect(run('claude-code', claude(2))).toEqual(want);
    expect(run('codex', [])).toEqual(want);
    expect(run('hermes', parseTurn('hermes', join(FIX, 'hermes'), 1, 's1'))).toEqual(want);
  });

  test('question types are descriptive: browser, paste or a plain question', () => {
    const q = (reply: string) => turn(1, 'arm', [], BIN, reply);
    expect(classify([q('Please open this link in your browser to sign in: https://gbrain.io/login'), q('Paste your OpenAI API key and I will add it.'), q('Should I use the defaults?'), q('All done.')]).question_types).toEqual({ browser: 1, paste: 1, question: 1 });
  });
});

describe('routes, version, install doc, memory, codes and infra', () => {
  test('route from shell commands: the first that succeeded, else the last attempted', () => {
    const cases: Array<[string, string | null]> = [
      ['bun install -g github:garrytan/gbrain', 'bun-github'], ['bun add -g https://github.com/garrytan/gbrain', 'bun-github'], ['bun install -g garrytan/gbrain', 'bun-github'],
      ['npm install -g gbrain', 'npm'], ['bun add -g gbrain@latest', 'npm'], ["/bin/bash -lc 'git clone https://github.com/garrytan/gbrain.git ~/src/gbrain'", 'git-clone'],
      ['clawhub install gbrain', 'clawhub'], ['curl -fsSL https://gbrain.io/install | bash', 'hosted'], ['gbrainio workspace new', 'hosted'],
      ['codex plugin marketplace add garrytan/gbrain', 'codex-plugin'], ['curl -fsSL https://raw.githubusercontent.com/garrytan/gbrain/stable/install.sh | bash', 'curl-script'], ['ls ~/.gbrain', null],
    ];
    expect(cases.map(([c]) => routeOf([c, 0]))).toEqual(cases.map(([, r]) => r));
    expect(routeOf(['npm install -g gbrain', 243], ['bun install -g github:garrytan/gbrain', 0])).toBe('bun-github');
    expect(routeOf(['npm install -g gbrain', 243])).toBe('npm');
  });

  test('version from the latest probe, else from gbrain --version output', () => {
    expect(classify([turn(1, 'arm', [], BIN)]).version).toBe('0.60.717.0');
    expect(classify([turn(1, 'arm', [shell('gbrain --version', 'gbrain v0.60.722.0')], null)]).version).toBe('0.60.722.0');
    expect(classify([turn(1, 'arm', [], null)]).version).toBeNull();
  });

  test('INSTALL_FOR_AGENTS.md: URL, ref from the path, sha256 only when the tool output holds the body', () => {
    const url = 'https://raw.githubusercontent.com/garrytan/gbrain/v0.60.717.0/INSTALL_FOR_AGENTS.md';
    const fetched = classify([turn(1, 'arm', [shell('curl -fsSL ' + url, '# Install gbrain\nRun bun install -g github:garrytan/gbrain\n')], null)]).install_doc;
    expect(fetched).toEqual([{ url, ref: 'v0.60.717.0', sha256: new Bun.CryptoHasher('sha256').update('# Install gbrain\nRun bun install -g github:garrytan/gbrain\n').digest('hex') }]);
    expect(classify([turn(1, 'arm', parseTurn('claude-code', join(FIX, 'claude'), 1, 's1'), null)]).install_doc).toEqual([{ url: 'https://raw.githubusercontent.com/garrytan/gbrain/stable/INSTALL_FOR_AGENTS.md', ref: 'stable', sha256: null }]);
    expect(refOf('https://github.com/garrytan/gbrain/blob/main/INSTALL_FOR_AGENTS.md')).toBe('main');
    expect(refOf('https://gbrain.io/INSTALL_FOR_AGENTS.md')).toBeNull();
  });

  test('saved to harness memory: a memory tool or memory file write in the save turn with no successful gbrain call', () => {
    const hermes = parseTurn('hermes', join(FIX, 'hermes'), 1, 's1').filter(e => e.name === 'memory');
    expect(classify([turn(1, 'save', hermes, OK)]).saved_to_harness_memory).toBe(true);
    expect(classify([turn(1, 'save', [shell("echo 'Sister cat: Vorlimb' >> ~/.claude/CLAUDE.md")], OK)]).saved_to_harness_memory).toBe(true);
    expect(classify([turn(1, 'save', [...hermes, shell('gbrain put family/cat --content Vorlimb')], OK)]).saved_to_harness_memory).toBe(false);
    expect(classify([turn(1, 'save', parseTurn('claude-code', join(FIX, 'claude'), 2, 's1'), OK)]).saved_to_harness_memory).toBe(false);
  });

  test('last gbrain code: the last JSON code from a gbrain call or an output with fix', () => {
    expect(classify([turn(1, 'arm', parseTurn('claude-code', join(FIX, 'claude'), 3, 's1'), BIN)]).last_gbrain_code).toBe('brain_not_found');
    expect(classify([turn(1, 'arm', [shell('curl -s https://example.com/api', '{"code":"not_gbrain"}')], null)]).last_gbrain_code).toBeNull();
    const two = [shell('gbrain init', '{"error":{"code":"engine_missing","fix":{"next":"bun add pglite"}}}', 1), shell('gbrain serve', '{"error":{"code":"port_in_use"}}', 1)];
    expect(classify([turn(1, 'arm', two, null)]).last_gbrain_code).toBe('port_in_use');
  });

  test('infra: github-rate-limit from a tool output or a GitHub egress line with 403 or 429, else null', () => {
    expect(classify([turn(1, 'arm', parseTurn('codex', join(FIX, 'codex'), 1, 's1'), null)], 'codex').infra).toBe('github-rate-limit');
    const egress = (host: string, status: number) => ({ at: at(5), trial: 't', method: 'CONNECT', host, port: 443, decision: 'allowed' as const, status });
    expect(classify([turn(1, 'arm', [], null)], 'claude-code', { egress: [egress('api.github.com', 403)] }).infra).toBe('github-rate-limit');
    expect(classify([turn(1, 'arm', [], null)], 'claude-code', { egress: [egress('objects.githubusercontent.com', 429)] }).infra).toBe('github-rate-limit');
    expect(classify([turn(1, 'arm', [], null)], 'claude-code', { egress: [egress('registry.npmjs.org', 429), egress('github.com', 200)] }).infra).toBeNull();
  });

  test('step times from the watcher first, the turn-end probe where the watcher has no line; died_at_step only when the probe never passed', () => {
    const turns = [turn(1, 'arm', [], BRAIN), turn(2, 'reply', [], OK), turn(3, 'save', [shell('gbrain put a --content Vorlimb')], OK), turn(4, 'recall', [shell('gbrain query cat', 'Vorlimb')], OK)];
    const c = classify(turns, 'claude-code', { watch: [{ ...BIN, at: at(20) }, { ...BRAIN, at: at(41) }] });
    expect(c.steps).toEqual({ binary_ms: 20000, brain_ms: 41000, wired_ms: 120000, saved_ms: 180000, recalled_ms: 240000 });
    expect(c.died_at_step).toBeNull();
    expect(classify(turns, 'claude-code', { finish: false }).steps.recalled_ms).toBeNull();
    expect(classify([turn(1, 'arm', [], BIN), turn(2, 'reply', [], BRAIN)]).died_at_step).toBe('wired');
    expect([stepOf(null), stepOf(BIN), stepOf(BRAIN), stepOf(OK)]).toEqual(['binary', 'brain', 'wired', 'done']);
  });

  test('failed and retried commands', () => {
    const c = classify([turn(1, 'arm', parseTurn('codex', join(FIX, 'codex'), 1, 's1'), null)], 'codex');
    expect([c.failed_commands, c.retried_commands]).toEqual([3, 1]);
  });
});

describe('verdict and failure table', () => {
  test('Wilson 95% interval at known values', () => {
    const r = (w: { lo: number; hi: number } | null) => w && [Number(w.lo.toFixed(4)), Number(w.hi.toFixed(4))];
    expect(r(wilson(0, 10))).toEqual([0, 0.2775]);
    expect(r(wilson(5, 10))).toEqual([0.2366, 0.7634]);
    expect(r(wilson(10, 10))).toEqual([0.7225, 1]);
    expect(r(wilson(18, 20))).toEqual([0.699, 0.9721]);
    expect(wilson(0, 0)).toBeNull();
  });

  const cls = (o: Partial<InstallTrialRecord['install']['classification']> = {}): InstallTrialRecord['install']['classification'] => ({ route: 'bun-github', version: '0.60.717.0', install_doc: [], stalls: [], person_needed: [], failed_commands: 0, retried_commands: 0, question_types: {}, saved_to_harness_memory: false, last_gbrain_code: null, steps: { binary_ms: 1000, brain_ms: 2000, wired_ms: 3000, saved_ms: 4000, recalled_ms: 5000 }, died_at_step: null, infra: null, ...o });
  const rec = (id: string, outcome: InstallTrialRecord['install']['outcome'], c = cls(), extra: Partial<InstallTrialRecord> = {}, finish_ms: number | null = null): InstallTrialRecord => ({ trial_id: 'run/' + id, cell: 'claude-code-opus-install', harness: 'claude-code', model: 'claude-opus-5-5', termination: 'completed', wall_ms: 100000, started_at: T0, paths: { dir: 'trials/' + id }, install: { arm: 'bare', stable_commit: 'abc', nonce: 'Vorlimb', outcome, finish: { reply: outcome === 'recalled', gbrain_call: outcome === 'recalled', brain: true, outside_brain: [] }, hinted: { ran: outcome !== 'recalled', reply: false, gbrain_call: false }, scripted_replies: c.person_needed.filter(p => p.kind === 'scripted-reply').length, probe_exhausted: false, finish_ms, agent_turns: 4, model_requests: 12, non_harness_requests: 0, watcher: 'ok', classification: c }, ...extra });
  const records: InstallTrialRecord[] = [
    rec('t1', 'recalled', cls(), {}, 90000),
    rec('t2', 'not-installed', cls({ died_at_step: 'binary', steps: { binary_ms: null, brain_ms: null, wired_ms: null, saved_ms: null, recalled_ms: null }, person_needed: [{ turn: 2, step: 'binary', kind: 'scripted-reply' }] })),
    rec('t3', 'not-installed', cls({ died_at_step: 'wired', last_gbrain_code: 'mcp_not_registered', person_needed: [{ turn: 1, step: 'wired', kind: 'question' }] })),
    rec('t4', 'not-recalled', cls({ last_gbrain_code: 'no_match' })),
    rec('t5', 'harness-memory', cls({ steps: { binary_ms: 1000, brain_ms: 2000, wired_ms: 3000, saved_ms: null, recalled_ms: null } })),
    rec('t6', 'not-installed', cls({ died_at_step: 'wired', last_gbrain_code: 'mcp_not_registered' })),
    rec('t7', 'not-installed', cls({ died_at_step: 'binary' }), { termination: 'infra_error' }),
    rec('t8', 'not-installed', cls({ died_at_step: 'binary', infra: 'github-rate-limit' })),
    rec('t9', 'recalled', cls(), {}, 120000),
  ];

  test('failure table: one row per step from the counted runs, in Markdown and CSV', () => {
    const rows = failureTable(records);
    expect(failureMarkdown(rows)).toBe([
      '| Step | Failed runs | Person-needed events | Top last gbrain codes | Example trials | As read | Reader note |',
      '|---|---|---|---|---|---|---|',
      '| binary | 1 | 1 |  | run/t2 |  |  |',
      '| brain | 0 | 0 |  |  |  |  |',
      '| wired | 2 | 1 | mcp_not_registered (2) | run/t3, run/t6 |  |  |',
      '| saved | 1 | 0 |  | run/t5 |  |  |',
      '| recalled | 1 | 0 | no_match (1) | run/t4 |  |  |',
    ].join('\n') + '\n');
    expect(failureCsv(rows)).toBe([
      'step,failed_runs,person_needed,top_last_gbrain_codes,example_trials,as_read,reader_note',
      'binary,1,1,,run/t2,,', 'brain,0,0,,,,', 'wired,2,1,mcp_not_registered (2),run/t3 run/t6,,', 'saved,1,0,,run/t5,,', 'recalled,1,0,no_match (1),run/t4,,',
    ].join('\n') + '\n');
    expect(failureTable(records, 'paste').every(r => r.failed_runs === 0)).toBe(true);
  });

  test('verdict: counted n, finish line with its interval, median finish time, person-needed share, excluded runs listed apart', () => {
    const [c] = verdict(records);
    expect(c).toMatchObject({ cell: 'claude-code-opus-install', arm: 'bare', runs: 9, n: 7, finish: { k: 2, n: 7 }, finish_s: { median: 105, q1: 97.5, q3: 112.5 }, agent_turns_median: 4, person_needed: { events: 2, by_kind: { 'scripted-reply': 1, question: 1 }, runs_with_none: 5 }, harness_memory: 1, hinted: { ran: 5, recalled: 0 } });
    expect(c.excluded).toEqual([{ trial_id: 'run/t7', reason: 'infra_error' }, { trial_id: 'run/t8', reason: 'infra: github-rate-limit' }]);
    expect(verdictMarkdown([c])).toContain('| claude-code-opus-install | bare | 7 | 2/7 (8% to 64%) | 105 (97.5 to 112.5) | 4 | 5/7 | 2 (1, 0, 1) | 1 | 0 | 0/5 |');
  });

  test('a timeout or another harness_error counts as a miss; an HE-INSTALL-003 refusal and model_error, infra_error and exam_fault are listed apart', () => {
    const more = [
      ...records,
      rec('t10', 'not-installed', cls({ died_at_step: 'binary' }), { termination: 'timeout' }),
      rec('t11', 'not-installed', cls({ died_at_step: 'binary' }), { termination: 'harness_error' }),
      rec('t12', 'not-installed', cls({ died_at_step: 'binary' }), { termination: 'harness_error', error: 'HE-INSTALL-003 claude-code: HE_GBRAIN_INSTALL is set beside HE_INSTALL_MODE=1' }),
      rec('t13', 'not-installed', cls({ died_at_step: 'binary' }), { termination: 'model_error' }),
      rec('t14', 'not-installed', cls({ died_at_step: 'binary' }), { termination: 'exam_fault' }),
    ];
    const [c] = verdict(more);
    expect(c).toMatchObject({ runs: 14, n: 9, finish: { k: 2, n: 9 } });
    expect(c.excluded.map(e => e.reason)).toEqual(['harness_error: HE-INSTALL-003', 'model_error', 'exam_fault', 'infra_error', 'infra: github-rate-limit']);
    expect(failureTable(more).find(r => r.step === 'binary')).toMatchObject({ failed_runs: 3, examples: ['run/t10', 'run/t11'] });
  });

  test('the CLIs read <run dir>/trials.jsonl and write Markdown, CSV and JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-install-scoring-'));
    writeFileSync(join(dir, 'trials.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n' + JSON.stringify({ trial_id: 'run/other', cell: 'x', termination: 'completed' }) + '\n');
    const env = { PATH: process.env.PATH ?? '' };
    const csv = join(dir, 'failures.csv');
    const ft = spawnSync('bun', [join(ROOT, 'scripts/gbrain-install/failure-table.ts'), dir, '--csv', csv], { encoding: 'utf8', env });
    expect([ft.status, ft.stdout]).toEqual([0, failureMarkdown(failureTable(records))]);
    expect(readFileSync(csv, 'utf8')).toBe(failureCsv(failureTable(records)));
    const vj = spawnSync('bun', [join(ROOT, 'scripts/gbrain-install/verdict.ts'), dir, '--json'], { encoding: 'utf8', env });
    expect(vj.status).toBe(0);
    expect(JSON.parse(vj.stdout)).toEqual(verdict(records));
  });
});
