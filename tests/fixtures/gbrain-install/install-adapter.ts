#!/usr/bin/env bun
// A process-mode stand-in for an adapter in install mode (internal-task runner tests), keyless. HE_FIXTURE_PLAY picks the agent:
//   oracle      installs gbrain (a fake CLI under ~/.bun/bin), saves the fact in the brain, recalls it through the CLI
//   ask-first   oracle, but its first turn only asks a question, so the runner's scripted reply is what starts the install
//   nop         answers every turn with "OK." and does nothing
//   decoy       installs gbrain, but saves the fact in its own memory file (~/.claude/CLAUDE.md) and answers from it
//   hinted      oracle, except that the plain question gets "I don't know" with no gbrain call; the hinted one is answered
//   leak        oracle, and writes the proxy token into its settings file (the runner must scrub it)
//   leakkey     oracle, and writes HE_FIXTURE_FAKE_KEY into a state file (the canary must stop the run)
//   nowatch     oracle without the filesystem watcher
//   refuse      exits 2 before ready with an HE-INSTALL-003 line, as an adapter refusing its install mode does
// Each turn: one model call through the proxy with the token from HE_MODEL_API_KEY_FILE, a Claude Code stream-json
// transcript at turn-NNNN.claude.jsonl, the probe at turn-NNNN.probe.json, then the response.

import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const env = process.env;
const play = env.HE_FIXTURE_PLAY ?? 'oracle';
const home = env.HE_SESSION_STATE_DIR!;
const logs = env.HE_LOG_DIR!;
const turnsDir = env.HE_TURNS_DIR!;
if (play === 'refuse' || env.HE_INSTALL_MODE !== '1' || !env.HE_MODEL_API_KEY_FILE) { process.stderr.write('HE-INSTALL-003 the fixture refuses: install mode needs HE_INSTALL_MODE=1 and HE_MODEL_API_KEY_FILE\n'); process.exit(2); }
const token = readFileSync(env.HE_MODEL_API_KEY_FILE, 'utf8').trim();
mkdirSync(join(logs, 'turns'), { recursive: true });

const gbrainBin = join(home, '.bun', 'bin', 'gbrain');
const brainDir = join(home, '.gbrain', 'brain.pglite');
const wiring = join(home, '.claude.json');
const memoryFile = join(home, '.claude', 'CLAUDE.md');
const probe = () => {
  const binary = existsSync(gbrainBin) ? gbrainBin : null;
  const brain = existsSync(brainDir);
  const mcp = existsSync(wiring) && readFileSync(wiring, 'utf8').includes('gbrain');
  return { harness: 'claude-code', at: new Date().toISOString(), binary, version: binary ? '0.60.717.0' : null, brain, brain_path: brain ? brainDir : null, mcp, instructions: false, hook: false, wired: mcp ? ['.claude.json'] : [], ok: !!binary && brain && mcp };
};
if (play !== 'nowatch') {
  let last = '';
  const tick = () => {
    const p = probe();
    const { at, ...rest } = p;
    if (JSON.stringify(rest) !== last) { last = JSON.stringify(rest); appendFileSync(join(logs, 'install-watch.ndjson'), JSON.stringify(p) + '\n'); }
    writeFileSync(join(logs, 'install-watch.alive'), new Date().toISOString() + '\n');
  };
  tick();
  setInterval(tick, 200);
}
writeFileSync(join(logs, 'ready'), JSON.stringify({ adapter: 'install-fixture', install_mode: true, key_in_env: env.HE_MODEL_API_KEY !== undefined }) + '\n');

const install = () => {
  mkdirSync(join(home, '.bun', 'bin'), { recursive: true });
  writeFileSync(gbrainBin, '#!/bin/sh\necho 0.60.717.0\n');
  chmodSync(gbrainBin, 0o755);
  mkdirSync(brainDir, { recursive: true });
  writeFileSync(join(brainDir, 'PG_VERSION'), '17\n');
  writeFileSync(join(home, '.gbrain', 'config.json'), JSON.stringify({ engine: 'pglite' }) + '\n');
  writeFileSync(wiring, JSON.stringify({ mcpServers: { gbrain: { command: gbrainBin, args: ['serve'] } } }) + '\n');
};
const pagesFile = join(brainDir, 'pages.dat');
const remember = (fact: string) => appendFileSync(pagesFile, fact + '\n');
const recallFromBrain = () => (existsSync(pagesFile) ? readFileSync(pagesFile, 'utf8') : '');

type Block = Record<string, unknown>;
let toolN = 0;
const transcript: string[] = [];
const say = (text: string) => transcript.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }));
const tool = (name: string, input: Block, output: string, isError = false) => {
  const id = 'toolu_' + ++toolN;
  transcript.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } }));
  transcript.push(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output, is_error: isError }] } }));
};

async function answer(req: { turn: number; text: string; channel: { id: string } }): Promise<string> {
  await fetch(env.HE_MODEL_BASE_URL + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': token, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.HE_MODEL_NAME, max_tokens: 16, messages: [{ role: 'user', content: req.text }] }) }).then((r) => r.text()).catch(() => '');
  if (play === 'nop') return 'OK.';
  const t = req.text;
  if (/^install gbrain$|^Add GBrain memory/.test(t)) {
    if (play === 'ask-first') return 'Which search mode would you like, keyword or vector?';
    tool('Bash', { command: 'bun install -g github:garrytan/gbrain#stable' }, 'installed gbrain@0.60.717.0\nBlocked 1 postinstall. Run `bun pm untrusted` for details.');
    install();
    tool('Bash', { command: 'gbrain setup claude-code' }, '{"ok":true,"wrote":[".claude.json"]}');
    if (play === 'leak') { mkdirSync(join(home, 'claude'), { recursive: true }); writeFileSync(join(home, 'claude', 'settings.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: token } }) + '\n'); }
    if (play === 'leakkey') writeFileSync(join(home, 'notes.txt'), 'key ' + (env.HE_FIXTURE_FAKE_KEY ?? '') + '\n');
    return 'gbrain is installed and wired into Claude Code.';
  }
  if (/carry on without me/.test(t)) {
    if (play === 'ask-first' && !existsSync(gbrainBin)) { install(); tool('Bash', { command: 'gbrain init --pglite --no-embedding' }, '{"ok":true}'); return 'Done: gbrain is installed with the defaults.'; }
    return 'OK.';
  }
  const saved = /^Remember that (.*)$/.exec(t);
  if (saved) {
    if (play === 'decoy') { mkdirSync(join(home, '.claude'), { recursive: true }); appendFileSync(memoryFile, '- ' + saved[1] + '\n'); tool('Write', { file_path: memoryFile }, 'ok'); return 'Saved to my memory.'; }
    remember(saved[1]!);
    tool('mcp__gbrain__put_page', { slug: 'family/sister-cat', content: saved[1] }, '{"ok":true}');
    return 'Saved to gbrain.';
  }
  if (/cat called\?$/.test(t)) {
    const hinted = /gbrain memory/.test(t);
    if (play === 'decoy') { const m = /called ([A-Za-z]+)/.exec(existsSync(memoryFile) ? readFileSync(memoryFile, 'utf8') : ''); return m ? `Your sister's new cat is called ${m[1]}.` : "I don't know."; }
    if (play === 'hinted' && !hinted) return "I don't know.";
    const page = recallFromBrain();
    tool('Bash', { command: 'gbrain query "sister cat"' }, JSON.stringify({ results: [{ slug: 'family/sister-cat', text: page.trim() }] }));
    const m = /called ([A-Za-z]+)/.exec(page);
    return m ? `Your sister's new cat is called ${m[1]}.` : "I don't know.";
  }
  return 'OK.';
}

const pad = (n: number) => String(n).padStart(4, '0');
let next = 1;
for (;;) {
  const req = join(turnsDir, `turn-${pad(next)}.request.json`);
  if (!existsSync(req)) { await Bun.sleep(50); continue; }
  const r = JSON.parse(readFileSync(req, 'utf8'));
  const started = new Date().toISOString();
  transcript.length = 0;
  const reply = await answer(r);
  say(reply);
  writeFileSync(join(logs, 'turns', `turn-${pad(next)}.claude.jsonl`), transcript.join('\n') + '\n');
  writeFileSync(join(logs, 'turns', `turn-${pad(next)}.probe.json`), JSON.stringify(probe()) + '\n');
  const out = join(turnsDir, `turn-${pad(next)}.response.json`);
  writeFileSync(out + '.tmp', JSON.stringify({ turn: next, exit: 0, reply_text: reply, started_at: started, ended_at: new Date().toISOString() }));
  renameSync(out + '.tmp', out);
  next++;
}
