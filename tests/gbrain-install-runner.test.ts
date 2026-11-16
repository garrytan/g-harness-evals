// internal-task: the gbrain install trial through the runner (runner/trial/install.ts), keyless. A process-mode fixture adapter
// (tests/fixtures/gbrain-install/install-adapter.ts) plays the agent against a fake Anthropic endpoint in capture mode:
// the oracle reaches the finish line, the nop does not, the harness-memory decoy scores a miss, the scripted reply fires
// on probe state only, a moved stable stops the cell, and the token canary holds. Also the cell checks, the open-egress
// proxy, the state-store scan and the token scrub.

import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildManifest, cellTasks, loadPrereg, renderPlan } from '../runner/run.ts';
import { executeRun } from '../runner/trial/run.ts';
import { blockedBy, loadBlocklist, startOpenEgress } from '../runner/trial/egress.ts';
import { COLD_DOWNLOAD_SCRIPT, canaryScan, coldDownloadArgs, filesHolding, measureColdDownload, outsideBrain, scrubToken, stableProblem, stableRefs } from '../runner/trial/install.ts';
import { spawnSync } from 'node:child_process';
import { installNonce } from '../tasks/gbrain-install/nonce.ts';
import type { TrialRecord } from '../runner/contracts.ts';

const ROOT = resolve(import.meta.dir, '..');
const ADAPTER = join(ROOT, 'tests', 'fixtures', 'gbrain-install', 'install-adapter.ts');
const ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir() };
const STABLE = 'b82c23a7330bb9468720617a89af08c329fe6b10';
const PASTE = 'tasks/gbrain-install/arms/paste-0.60.722.0.md';
const PASTE_SHA = createHash('sha256').update(readFileSync(join(ROOT, PASTE))).digest('hex');
const lsServes = (sha: string) => () => ({ status: 0, stdout: `3f1e000000000000000000000000000000000000\trefs/tags/stable\n${sha}\trefs/tags/stable^{}\n`, stderr: '' });
const scratch = () => mkdtempSync(join(tmpdir(), 'gbrain-install-'));

let seen = 0;
const fake = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async () => {
  seen++;
  return Response.json({ id: 'm' + seen, type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2 }, content: [{ type: 'text', text: 'ok' }] });
} });
afterAll(() => fake.stop(true));

const cellOf = (extra: Record<string, unknown> = {}) => ({ id: 'cc-bare', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', slice: 'gbrain-install', split: 'dev', repetitions: 1,
  ceiling: { input_tokens: 1000, output_tokens: 100 }, harness_mode: 'process', adapter: ADAPTER, install: { arm: 'bare', stable_commit: STABLE, seed: 'test' }, ...extra });
const preregFile = (dir: string, runId: string, cells: unknown[]) => {
  const file = join(dir, 'prereg.json');
  writeFileSync(file, JSON.stringify({ schema_version: 1, run_id: runId, question: 'keyless test', tasks: {}, spend_cap_usd: 1, wall_clock_s: { 'gbrain-install': 900 }, drop_order: [], minimum_v01: [], cells }));
  return file;
};

let runs = 0;
async function runPlay(play: string, o: { reps?: number; ls?: () => { status: number; stdout: string; stderr: string }; keyEnv?: Record<string, string>; harnessEnv?: Record<string, string>; cell?: Record<string, unknown>; manifestCell?: Record<string, unknown>; log?: (line: string) => void } = {}) {
  const dir = scratch();
  const runId = `gbrain-install-${play}-${++runs}`;
  const { prereg, sha256 } = loadPrereg(preregFile(dir, runId, [cellOf({ repetitions: o.reps ?? 1, ...o.cell })]));
  const runDir = join(dir, 'run');
  mkdirSync(runDir, { recursive: true });
  const manifestPath = join(runDir, 'manifest.json');
  const manifest = buildManifest(prereg, sha256, '2026-11-15T00:00:00Z');
  // A process-mode Codex cell cannot be preregistered (HE-NET-001: Codex runs on a network), so a test swaps it into the planned manifest.
  if (o.manifestCell) Object.assign(manifest.cells[0]!, o.manifestCell);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  let thrown: Error | null = null;
  const result = await executeRun(JSON.parse(readFileSync(manifestPath, 'utf8')), manifestPath, { harnessMode: 'process', proxyEnv: ENV, turnGraceS: 1, stopGraceS: 2, readyTimeoutS: 20, repoRoot: ROOT, leaseUsd: 1, newLease: true,
    capture: { upstream: { anthropic: 'http://127.0.0.1:' + fake.port }, dns: null }, harnessEnv: { HE_FIXTURE_PLAY: play, ...o.harnessEnv }, installLsRemote: o.ls ?? lsServes(STABLE), installKeyEnv: o.keyEnv ?? {}, ...(o.log ? { log: o.log } : {}) })
    .catch((e: Error) => { thrown = e; return null; });
  const lines = existsSync(join(runDir, 'trials.jsonl')) ? readFileSync(join(runDir, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord) : [];
  return { result, record: lines[0]!, lines, runDir, runLog: readFileSync(join(runDir, 'run.log'), 'utf8'), thrown: thrown as Error | null };
}

describe('the install trial through the runner (fixture adapter, capture mode)', () => {
  test('the oracle reaches the finish line: reply, gbrain call and brain, nothing outside the brain, no scripted reply', async () => {
    const { record } = await runPlay('oracle');
    const i = record.install!;
    expect({ termination: record.termination, grade: record.grade, outcome: i.outcome, finish: i.finish, replies: i.scripted_replies, hinted: i.hinted.ran, watcher: i.watcher, turns: i.agent_turns, requests: i.model_requests, non_harness: i.non_harness_requests })
      .toEqual({ termination: 'completed', grade: 'n/a', outcome: 'recalled', finish: { reply: true, gbrain_call: true, brain: true, outside_brain: [] }, replies: 0, hinted: false, watcher: 'ok', turns: 3, requests: 3, non_harness: 0 });
    expect(i.nonce).toBe(installNonce('test', record.trial_id));
    expect(i.finish_ms).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(join(record.paths.dir!, 'logs', 'ready'), 'utf8'))).toEqual({ adapter: 'install-fixture', install_mode: true, key_in_env: false });
    expect(existsSync(join(record.paths.dir!, 'secret'))).toBe(false);
    const turns = JSON.parse(readFileSync(record.paths.install_turns!, 'utf8')) as Array<{ session: string; role: string; text: string }>;
    expect(turns.map((t) => [t.session, t.role])).toEqual([['s1', 'arm'], ['s1', 'save'], ['s2', 'recall']]);
    expect(turns[0]!.text).toBe('install gbrain');
    expect(turns[1]!.text).toBe(`Remember that my sister's new cat is called ${i.nonce}.`);
    expect(JSON.parse(readFileSync(record.paths.install_classification!, 'utf8'))).toEqual(i.classification);
  }, 60_000);

  test('the nop fails: three scripted replies, probe exhausted, the hinted question asked, not-installed', async () => {
    const { record, runLog } = await runPlay('nop');
    const i = record.install!;
    expect({ termination: record.termination, outcome: i.outcome, replies: i.scripted_replies, exhausted: i.probe_exhausted, hinted: i.hinted, finish_ms: i.finish_ms })
      .toEqual({ termination: 'completed', outcome: 'not-installed', replies: 3, exhausted: true, hinted: { ran: true, reply: false, gbrain_call: false }, finish_ms: null });
    expect(runLog).toContain('HE-INSTALL-002');
    expect(i.classification.person_needed.filter((p) => p.kind === 'scripted-reply').length).toBe(3);
  }, 60_000);

  test('the harness-memory decoy scores a miss even though its reply holds the nonce', async () => {
    const { record } = await runPlay('decoy');
    const i = record.install!;
    expect({ outcome: i.outcome, reply: i.finish.reply, gbrain_call: i.finish.gbrain_call, brain: i.finish.brain, outside: i.finish.outside_brain }).toEqual({ outcome: 'harness-memory', reply: true, gbrain_call: false, brain: false, outside: ['state/.claude/CLAUDE.md'] });
  }, 60_000);

  test('the scripted reply fires on probe state, not on the text: a question before the install gets one, then the run finishes', async () => {
    const { record } = await runPlay('ask-first');
    const i = record.install!;
    expect({ outcome: i.outcome, replies: i.scripted_replies, exhausted: i.probe_exhausted, turns: i.agent_turns }).toEqual({ outcome: 'recalled', replies: 1, exhausted: false, turns: 4 });
  }, 60_000);

  test('the paste arm sends the pinned paste prompt, without its final newline, as the first message', async () => {
    const { record } = await runPlay('oracle', { cell: { id: 'cc-paste', install: { arm: 'paste', paste_file: PASTE, paste_sha256: PASTE_SHA, stable_commit: STABLE, seed: 'test' } } });
    const turns = JSON.parse(readFileSync(record.paths.install_turns!, 'utf8')) as Array<{ text: string }>;
    expect(turns[0]!.text).toBe(readFileSync(join(ROOT, PASTE), 'utf8').replace(/\n$/, ''));
    expect({ arm: record.install!.arm, outcome: record.install!.outcome }).toEqual({ arm: 'paste', outcome: 'recalled' });
  }, 60_000);

  test('a miss on the plain question asks the hinted one, which is descriptive only', async () => {
    const { record } = await runPlay('hinted');
    const i = record.install!;
    expect({ outcome: i.outcome, finish: i.finish, hinted: i.hinted }).toEqual({ outcome: 'not-recalled', finish: { reply: false, gbrain_call: false, brain: true, outside_brain: [] }, hinted: { ran: true, reply: true, gbrain_call: true } });
  }, 60_000);

  test('a nonce in the harness TMPDIR ($HE_SESSION_STATE_DIR/tmp, Claude Code and Codex scratch) is not harness memory: the trial still finishes', async () => {
    const { record } = await runPlay('scratch');
    expect(existsSync(join(record.paths.dir!, 'state', 'tmp', 'claude-1000', 'bash-output.txt'))).toBe(true);
    expect({ outcome: record.install!.outcome, outside: record.install!.finish.outside_brain }).toEqual({ outcome: 'recalled', outside: [] });
  }, 60_000);

  test('a recall through "gbrain --version; cat <file>" runs gbrain but is not a gbrain-served recall', async () => {
    const { record } = await runPlay('chained');
    const i = record.install!;
    expect({ outcome: i.outcome, finish: i.finish, hinted: i.hinted }).toEqual({ outcome: 'not-recalled', finish: { reply: true, gbrain_call: false, brain: true, outside_brain: [] }, hinted: { ran: true, reply: true, gbrain_call: false } });
  }, 60_000);

  test('the scrub and the canary also run when the trial throws', async () => {
    const { thrown, lines, runLog, runDir } = await runPlay('leak', { log: (line) => { if (/^turn 1 \(/.test(line)) throw new Error('injected failure after turn 1'); } });
    expect(thrown?.message).toContain('injected failure after turn 1');
    expect(lines.length).toBe(0);
    const found = [...new Bun.Glob('trials/**/state/claude/settings.json').scanSync({ cwd: runDir })];
    expect(found.length).toBe(1);
    const settings = readFileSync(join(runDir, found[0]!), 'utf8');
    expect(settings).toContain('[trial-token-removed]');
    expect(settings).not.toMatch(/trial-token:/);
    expect(runLog).toMatch(/token scrubbed from 1 file\(s\); canary clean after the trial threw/);
  }, 60_000);

  test('a token the harness wrote into its own files is scrubbed after the trial and the canary is clean', async () => {
    const { record, thrown, runLog } = await runPlay('leak');
    expect(thrown).toBeNull();
    const settings = readFileSync(join(record.paths.dir!, 'state', 'claude', 'settings.json'), 'utf8');
    expect(settings).toContain('[trial-token-removed]');
    expect(settings).not.toMatch(/trial-token:/);
    expect(runLog).toMatch(/token scrubbed from 1 file\(s\); canary clean/);
  }, 60_000);

  test('a provider key value left under the trial directory stops the run with HE-INSTALL-005 after the record is written', async () => {
    const fakeKey = 'sk-ant-fixture-' + 'k'.repeat(40);
    const { thrown, lines } = await runPlay('leakkey', { harnessEnv: { HE_FIXTURE_FAKE_KEY: fakeKey }, keyEnv: { ANTHROPIC_API_KEY: fakeKey } });
    expect(thrown?.message).toMatch(/HE-INSTALL-005 .*the value of ANTHROPIC_API_KEY is in a file under/);
    expect(thrown?.message).not.toContain(fakeKey);
    expect(lines.length).toBe(1);
  }, 60_000);

  test('a throw plus a provider key value left behind stops the run with HE-INSTALL-005 and writes no record', async () => {
    const fakeKey = 'sk-ant-fixture-' + 'k'.repeat(40);
    const { thrown, lines } = await runPlay('leakkey', { harnessEnv: { HE_FIXTURE_FAKE_KEY: fakeKey }, keyEnv: { ANTHROPIC_API_KEY: fakeKey }, log: (line) => { if (/^turn 1 \(/.test(line)) throw new Error('injected failure after turn 1'); } });
    expect(thrown?.message).toMatch(/HE-INSTALL-005 .*which threw: injected failure after turn 1.*the value of ANTHROPIC_API_KEY is in a file under/);
    expect(thrown?.message).not.toContain(fakeKey);
    expect(lines.length).toBe(0);
  }, 60_000);

  test('a missing watcher is infra_error with HE-INSTALL-004; an adapter that refuses install mode is harness_error with its HE-INSTALL-003 line', async () => {
    const w = await runPlay('nowatch');
    expect({ termination: w.record.termination, watcher: w.record.install!.watcher }).toEqual({ termination: 'infra_error', watcher: 'missing' });
    expect(w.record.error).toContain('HE-INSTALL-004');
    const r = await runPlay('refuse');
    expect(r.record.termination).toBe('harness_error');
    expect(r.record.error).toMatch(/^HE-INSTALL-003 /);
    expect(r.record.install!.outcome).toBe('not-installed');
  }, 60_000);

  test('a moved stable stops the cell before any trial: no record, the stop in install-stops.jsonl and run.log, exit 3', async () => {
    const moved = await runPlay('oracle', { reps: 2, ls: lsServes('0'.repeat(40)) });
    expect(moved.lines).toEqual([]);
    expect(moved.result!.exit).toBe(3);
    expect(moved.runLog).toContain('HE-INSTALL-001 cell cc-bare: gbrain\'s stable serves 000000000000, not the preregistered ' + STABLE.slice(0, 12));
    expect(moved.runLog).toMatch(/r2 not run: its cell stopped/);
    const stops = readFileSync(join(moved.runDir, 'install-stops.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(stops.map((s) => [s.cell, s.stable_commit])).toEqual([['cc-bare', STABLE]]);
    const down = await runPlay('oracle', { ls: () => ({ status: 128, stdout: '', stderr: 'fatal: unable to access' }) });
    expect(down.lines).toEqual([]);
    expect(down.runLog).toContain('git ls-remote https://github.com/garrytan/gbrain failed (fatal: unable to access)');
  }, 60_000);
});


// The same runner path with the real Claude Code and Codex adapters in install mode, driving the stand-in CLIs of
// tests/fixtures/gbrain-install/bin (they run each "run: <command>" line of the prompt in the agent's shell and answer with the
// output, in the CLI's own transcript format). A wrapper turns each task message into the commands an agent would run: the oracle
// installs and wires gbrain, saves through the gbrain CLI and recalls through it; the decoy saves in its own notes file.
const BIN = join(ROOT, 'tests', 'fixtures', 'gbrain-install', 'bin');
const NODE = Bun.which('node');
const SYSTEM_PATH = [...(NODE ? [resolve(NODE, '..')] : []), '/usr/local/bin', '/usr/bin', '/bin'].join(':');
const HAS_TOOLS = !!NODE && !!Bun.which('jq') && !!Bun.which('python3');
const WRAPPER = (cli: string) => `#!/usr/bin/env bash
# Turns the install task's messages into stand-in commands, then hands the turn to the ${cli} stand-in.
case " $* " in *" -p "*|*" exec "*) ;; *) exec "$STUB_BIN/${cli}" "$@" ;; esac
p=$(cat)
if [ "$PLAY" = decoy ]; then save='run: mkdir -p "$HOME/notes" && printf "%s\\n" "$FACT" >> "$HOME/notes/facts.md"'; recall='run: cat "$HOME/notes/facts.md"'
else save='run: gbrain remember "$FACT"'; recall='run: gbrain recall cat'; fi
case "$p" in
  "install gbrain") cmds=$'run: gbrain init\nrun: gbrain setup ${cli === 'claude' ? 'claude-code' : cli}' ;;
  "Remember that "*) export FACT="\${p#Remember that }"; cmds=$save ;;
  *"cat called?") cmds=$recall ;;
  *) cmds=$p ;;
esac
printf '%s\n' "$cmds" | exec "$STUB_BIN/${cli}" "$@"
`;

describe('the install trial through the real Claude Code and Codex adapters (stand-in CLIs)', () => {
  const cases: Array<[string, string, string]> = [['claude-code', 'claude', 'anthropic:claude-opus-5-5'], ['codex', 'codex', 'openai:gpt-6.1-sol']];
  for (const [harness, cli, model] of cases) {
    for (const play of ['oracle', 'decoy'] as const) {
      test.skipIf(!HAS_TOOLS)(`${harness} ${play}: ${play === 'oracle' ? 'session 2 recalls through gbrain and the trial reaches the finish line' : 'a fact kept in its own notes scores harness-memory'}`, async () => {
        const wrap = scratch();
        writeFileSync(join(wrap, cli), WRAPPER(cli), { mode: 0o755 });
        const pin = String(JSON.parse(readFileSync(join(ROOT, 'harnesses', harness, 'pin.json'), 'utf8')).version);
        const { record } = await runPlay(play, { cell: { id: `${harness}-${play}`, adapter: join(ROOT, 'harnesses', harness, 'adapter.sh') }, manifestCell: { harness, model },
          harnessEnv: { PATH: `${wrap}:${BIN}:${SYSTEM_PATH}`, STUB_BIN: BIN, STUB_VERSION: pin, PLAY: play } });
        const i = record.install!;
        if (play === 'oracle') {
          expect({ termination: record.termination, outcome: i.outcome, finish: i.finish, replies: i.scripted_replies, watcher: i.watcher }).toEqual({ termination: 'completed', outcome: 'recalled', finish: { reply: true, gbrain_call: true, brain: true, outside_brain: [] }, replies: 0, watcher: 'ok' });
          expect(JSON.parse(readFileSync(join(record.paths.dir!, 'logs', 'ready'), 'utf8')).install_mode).toBe(true);
        } else {
          expect({ outcome: i.outcome, reply: i.finish.reply, gbrain_call: i.finish.gbrain_call, outside: i.finish.outside_brain }).toEqual({ outcome: 'harness-memory', reply: true, gbrain_call: false, outside: ['state/notes/facts.md'] });
        }
        expect(existsSync(join(record.paths.dir!, 'secret'))).toBe(false);
      }, 90_000);
    }
  }
});

describe('install cells in the preregistration', () => {
  const load = (cell: Record<string, unknown>) => loadPrereg(preregFile(scratch(), 'install-cells', [cellOf(cell)]));
  test('a paste cell needs the prompt file and its sha256; a bare cell takes neither', () => {
    expect(() => load({ install: { arm: 'paste', paste_file: PASTE, paste_sha256: PASTE_SHA, stable_commit: STABLE, seed: 'w1' } })).not.toThrow();
    expect(() => load({ install: { arm: 'paste', paste_file: PASTE, paste_sha256: 'f'.repeat(64), stable_commit: STABLE, seed: 'w1' } })).toThrow(/HE-PREREG-007.*does not match/);
    expect(() => load({ install: { arm: 'bare', paste_file: PASTE, stable_commit: STABLE, seed: 'w1' } })).toThrow(/paste arm only/);
    expect(() => load({ install: { arm: 'bare', stable_commit: 'stable', seed: 'w1' } })).toThrow(/40-character/);
    expect(() => load({ install: undefined })).toThrow(/needs install/);
  });
  test('the harness must have an install mode, and nothing of our own wiring rides along', () => {
    expect(() => load({ harness: 'qm' })).toThrow(/harness qm has no install mode/);
    for (const extra of [{ gbrain: { surface: 'starter' } }, { config: 'route-tool' }, { tasks: ['x'] }, { preamble: 'tasks/multiuser/_shared/preamble.md' }]) expect(() => load(extra)).toThrow(/HE-PREREG-007.*cannot carry/);
  });
  test('network: docker needs "install", process takes none, and "install" belongs to install cells; codex accepts it', () => {
    expect(() => load({ harness_mode: 'docker', adapter: undefined })).toThrow(/HE-NET-001.*needs network "install"/);
    expect(() => load({ harness_mode: 'docker', adapter: undefined, network: 'install' })).not.toThrow();
    expect(() => load({ harness: 'codex', model: 'openai:gpt-6.1-sol', harness_mode: 'docker', adapter: undefined, network: 'install' })).not.toThrow();
    expect(() => load({ network: 'install' })).toThrow(/HE-NET-001/);
    expect(() => loadPrereg(preregFile(scratch(), 'x', [{ id: 'm', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 1, output_tokens: 1 }, network: 'install' }]))).toThrow(/HE-NET-001.*for gbrain-install cells only/);
    expect(() => loadPrereg(preregFile(scratch(), 'x', [{ id: 'm', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 1, output_tokens: 1 }, install: { arm: 'bare' } }]))).toThrow(/install belongs to gbrain-install cells only/);
  });
  test('one task per cell, priced per trial, and the plan line names the arm, the stable commit and the seed', () => {
    const { prereg, sha256 } = load({ repetitions: 3, install: { arm: 'paste', paste_file: PASTE, paste_sha256: PASTE_SHA, stable_commit: STABLE, seed: 'w1' } });
    expect(cellTasks(prereg, prereg.cells[0]!)).toEqual(['gbrain-install']);
    const m = buildManifest(prereg, sha256, '2026-11-15T00:00:00Z');
    expect(m.trials.map((t) => t.id)).toEqual([1, 2, 3].map((r) => `install-cells/cc-bare/gbrain-install/r${r}`));
    expect(renderPlan(m)).toContain(`install_arm=paste stable_commit=${STABLE.slice(0, 12)} seed=w1 paste_sha256=${PASTE_SHA.slice(0, 12)} reps=3`);
  });
  test('the nonce is a made-up word, the same for a trial id and seed, different across trials', () => {
    const a = installNonce('w1', 'r/c/gbrain-install/r1');
    expect(a).toMatch(/^[A-Z][a-z]{5,}$/);
    expect(installNonce('w1', 'r/c/gbrain-install/r1')).toBe(a);
    expect(new Set(Array.from({ length: 20 }, (_, i) => installNonce('w1', 'r/c/gbrain-install/r' + i))).size).toBe(20);
  });
});

describe('the cold download', () => {
  test('runs in the harness image on the install network through the egress proxy, with no key, and its script parses', () => {
    const args = coldDownloadArgs('harness-eval/claude-code:dev', { name: 'he-net-x', gateway: '172.30.0.1' }, { HTTPS_PROXY: 'http://host.docker.internal:9' });
    expect(args.slice(0, 5)).toEqual(['docker', 'run', '--rm', '--name', 'he-cold-download']);
    expect(args).toContain('he-net-x');
    expect(args).toContain('HTTPS_PROXY=http://host.docker.internal:9');
    expect(args.join(' ')).not.toMatch(/API_KEY|HE_MODEL/);
    expect(spawnSync('sh', ['-n', '-c', COLD_DOWNLOAD_SCRIPT]).status).toBe(0);
    expect(COLD_DOWNLOAD_SCRIPT).toContain('bun install -g github:garrytan/gbrain#stable');
  });

  // A stand-in docker on PATH: "run" fetches through the HTTPS_PROXY it was given (the egress proxy lives in this process, as in
  // a run) and prints the result line; "run" of hang-img ignores SIGTERM and never ends; "rm -f <name>" is recorded.
  const fakeDocker = () => {
    const dir = scratch();
    writeFileSync(join(dir, 'docker'), [
      '#!/bin/bash',
      'if [ "$1" = rm ]; then echo "$3" >> "' + join(dir, 'removed') + '"; exit 0; fi',
      'proxy=""; for a in "$@"; do case "$a" in HTTPS_PROXY=*) proxy=${a#HTTPS_PROXY=} ;; esac; done',
      'case " $* " in *" hang-img "*) trap "" TERM; while :; do sleep 1; done ;; esac',
      'code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$proxy/fetch")',
      'echo "{\\"bun_preinstalled\\":true,\\"bun_ms\\":0,\\"gbrain_ms\\":1,\\"exit\\":0,\\"version\\":\\"$code\\"}"',
    ].join('\n'), { mode: 0o755 });
    return dir;
  };
  const withPath = async <T>(dir: string, f: () => Promise<T>): Promise<T> => {
    const saved = process.env.PATH;
    process.env.PATH = dir + ':' + (saved ?? '/usr/bin:/bin');
    try { return await f(); } finally { process.env.PATH = saved; }
  };

  test('does not block the process that serves the egress proxy the download goes through', async () => {
    const dir = fakeDocker();
    const egress = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('ok', { status: 207 }) });
    try {
      const r = await withPath(dir, () => measureColdDownload('img', { name: 'n', gateway: '127.0.0.1' }, { HTTPS_PROXY: 'http://127.0.0.1:' + egress.port }, 30_000));
      expect(r).toMatchObject({ image: 'img', exit: 0, version: '207' });
    } finally { egress.stop(true); }
  });

  test('past its deadline removes the container, which a killed docker CLI would leave running', async () => {
    const dir = fakeDocker();
    const t0 = Date.now();
    const r = await withPath(dir, () => measureColdDownload('hang-img', { name: 'n', gateway: '127.0.0.1' }, { HTTPS_PROXY: 'http://127.0.0.1:9' }, 500));
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(String(r.error)).toMatch(/^no result within 0\.5 s; container he-cold-download-[0-9a-f]{12} removed$/);
    expect(readFileSync(join(dir, 'removed'), 'utf8').trim()).toMatch(/^he-cold-download-[0-9a-f]{12}$/);
  });
});

describe('the stable pin', () => {
  test('the peeled tag wins over the tag object, and a branch of the same name must agree', () => {
    expect(stableRefs(`aaaa\trefs/tags/stable\n${STABLE}\trefs/tags/stable^{}\n`)).toEqual({ tag: STABLE, branch: null });
    expect(stableRefs(`${STABLE}\trefs/tags/stable\n`)).toEqual({ tag: STABLE, branch: null });
    const cell = { id: 'c', install: { arm: 'bare' as const, stable_commit: STABLE, seed: 's' } };
    expect(stableProblem(cell, lsServes(STABLE))).toBeNull();
    expect(stableProblem(cell, () => ({ status: 0, stdout: `${STABLE}\trefs/tags/stable^{}\nbbbb\trefs/heads/stable\n`, stderr: '' }))).toMatch(new RegExp('HE-INSTALL-001.*serves ' + STABLE.slice(0, 12) + ' and bbbb'));
    expect(stableProblem(cell, () => ({ status: 0, stdout: '', stderr: '' }))).toMatch(/serves nothing/);
  });
});

describe('the open-egress proxy (network "install")', () => {
  test('the gbrain-install blocklist is the frontier base list plus provider hosts and hosted gbrain', () => {
    const list = loadBlocklist('gbrain-install', ROOT);
    expect(list.slice(0, 2)).toEqual(['tbench.ai', '*.tbench.ai']);
    for (const h of ['api.anthropic.com', 'api.openai.com', 'api.particle.ai', 'openrouter.ai', 'api.voyageai.com', 'gbrain.io', '*.gbrain.io', 'gbrainio.terminalwire.sh']) expect(list).toContain(h);
    expect(blockedBy('API.Anthropic.com.', list)).toBe('api.anthropic.com');
    expect(blockedBy('app.gbrain.io', list)).toBe('*.gbrain.io');
    expect(blockedBy('us-central1-aiplatform.googleapis.com', list)).toBe('*-aiplatform.googleapis.com');
    for (const h of ['github.com', 'raw.githubusercontent.com', 'registry.npmjs.org', 'bun.sh', 'gbrain.iox']) expect(blockedBy(h, list)).toBeNull();
  });
  test('a CONNECT to a blocked host is refused, another is tunnelled, a plain HTTP request is forwarded with its status, all logged per trial', async () => {
    const dir = scratch();
    const echo = createServer((s) => s.on('data', (d) => s.write(d)));
    await new Promise<void>((r) => echo.listen(0, '127.0.0.1', () => r()));
    const web = createHttpServer((_req, res) => { res.statusCode = 429; res.end('slow down'); });
    await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
    const egress = await startOpenEgress({ host: '127.0.0.1', block: ['gbrain.io', '*.gbrain.io'], logPath: join(dir, 'egress.ndjson'), trusted: ['127.0.0.1'] });
    egress.setTrial('t1');
    const exchange = (head: string, then?: string) => new Promise<string>((res) => {
      const s = connect(egress.port, '127.0.0.1', () => s.write(head));
      let got = '';
      s.on('data', (d) => { got += d.toString(); if (then && got.includes('200 Connection Established') && !got.includes(then)) s.write(then); if (!then || got.includes(then)) s.end(); });
      s.on('close', () => res(got));
    });
    expect(await exchange('CONNECT app.gbrain.io:443 HTTP/1.1\r\nHost: app.gbrain.io:443\r\n\r\n')).toMatch(/^HTTP\/1.1 403/);
    expect(await exchange(`CONNECT 127.0.0.1:${(echo.address() as { port: number }).port} HTTP/1.1\r\n\r\n`, 'ping')).toContain('ping');
    const port = (web.address() as { port: number }).port;
    expect(await exchange(`GET http://127.0.0.1:${port}/x HTTP/1.1\r\nHost: 127.0.0.1\r\nProxy-Authorization: Basic c2VjcmV0\r\nConnection: close\r\n\r\n`)).toMatch(/^HTTP\/1.1 429/);
    await Bun.sleep(50);
    const lines = egress.lines('t1');
    expect(lines.map((l) => [l.method, l.host, l.decision, l.status ?? null])).toEqual([['CONNECT', 'app.gbrain.io', 'blocked', null], ['CONNECT', '127.0.0.1', 'allowed', null], ['GET', '127.0.0.1', 'allowed', 429]]);
    expect(readFileSync(join(dir, 'egress.ndjson'), 'utf8')).not.toContain('c2VjcmV0');
    await egress.stop();
    echo.close();
    web.close();
  });
  test('an IP address, a name for a local address and an unresolvable name are refused or failed and logged; a plain HTTP request goes upstream with connection: close', async () => {
    const dir = scratch();
    let seen = '';
    const web = createServer((s) => s.on('data', (d) => { seen += d.toString(); s.end('HTTP/1.1 204 No Content\r\n\r\n'); }));
    await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
    const egress = await startOpenEgress({ host: '127.0.0.1', block: [], logPath: join(dir, 'egress.ndjson'), trusted: ['127.0.0.1'] });
    egress.setTrial('t2');
    const exchange = (head: string) => new Promise<string>((res) => {
      const s = connect(egress.port, '127.0.0.1', () => s.write(head));
      let got = '';
      s.on('data', (d) => { got += d.toString(); });
      s.on('close', () => res(got));
    });
    for (const t of ['169.254.169.254:80', '10.0.0.1:443', '[::1]:80', '[::ffff:127.0.0.1]:80', 'localhost:22']) expect(await exchange(`CONNECT ${t} HTTP/1.1\r\n\r\n`)).toMatch(/^HTTP\/1.1 403/);
    expect(await exchange('GET http://169.254.169.254/latest/meta-data/ HTTP/1.1\r\nHost: 169.254.169.254\r\n\r\n')).toMatch(/^HTTP\/1.1 403/);
    expect(await exchange('CONNECT no-such-host.invalid:443 HTTP/1.1\r\n\r\n')).toMatch(/^HTTP\/1.1 502/);
    const port = (web.address() as { port: number }).port;
    expect(await exchange(`GET http://127.0.0.1:${port}/x HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\nKeep-Alive: timeout=5\r\n\r\n`)).toMatch(/^HTTP\/1.1 204/);
    expect(seen).toContain('connection: close\r\n');
    expect(seen).not.toMatch(/keep-alive/i);
    await Bun.sleep(50);
    const lines = egress.lines('t2');
    expect(lines.map((l) => [l.host, l.decision])).toEqual([['169.254.169.254', 'blocked'], ['10.0.0.1', 'blocked'], ['::1', 'blocked'], ['::ffff:127.0.0.1', 'blocked'], ['localhost', 'blocked'], ['169.254.169.254', 'blocked'], ['no-such-host.invalid', 'failed'], ['127.0.0.1', 'allowed']]);
    expect(lines[4].reason).toMatch(/^host resolves to the local address /);
    expect(lines[6].reason).toMatch(/^no address for the host: /);
    expect(lines[7].status).toBe(204);
    await egress.stop();
    web.close();
  });
  const exchangeWith = (port: number) => (head: string, then?: string) => new Promise<string>((res) => {
    const s = connect(port, '127.0.0.1', () => s.write(head));
    let got = '';
    s.on('data', (d) => { got += d.toString(); if (then && got.includes('200 Connection Established') && !got.includes(then)) s.write(then); if (then && got.includes(then)) s.end(); });
    s.on('close', () => res(got));
  });
  test('a port outside 1 to 65535 is answered 400 before any lookup, and the proxy keeps serving', async () => {
    const dir = scratch();
    let lookups = 0;
    const egress = await startOpenEgress({ host: '127.0.0.1', block: [], logPath: join(dir, 'egress.ndjson'), resolve: async () => { lookups++; return []; } });
    egress.setTrial('t3');
    const exchange = exchangeWith(egress.port);
    for (const t of ['example.test:0', 'example.test:65536', 'example.test:99999999999999999999']) expect(await exchange(`CONNECT ${t} HTTP/1.1\r\n\r\n`)).toMatch(/^HTTP\/1.1 400/);
    expect(await exchange('GET http://example.test:0/ HTTP/1.1\r\nHost: example.test\r\n\r\n')).toMatch(/^HTTP\/1.1 400/);
    expect(await exchange('CONNECT example.test:443 HTTP/1.1\r\n\r\n')).toMatch(/^HTTP\/1.1 502/);
    await Bun.sleep(50);
    expect(lookups).toBe(1);
    expect(egress.lines('t3').slice(0, 4).map((l) => [l.host, l.decision, l.reason])).toEqual([0, 65536, 1e20, 0].map((p) => ['example.test', 'blocked', `port ${p} is outside 1 to 65535`]));
    await egress.stop();
  });
  test('decimal, hex and octal IPv4 hosts are refused like dotted IP literals, in CONNECT and plain HTTP, with no lookup', async () => {
    const dir = scratch();
    let lookups = 0;
    const egress = await startOpenEgress({ host: '127.0.0.1', block: [], logPath: join(dir, 'egress.ndjson'), resolve: async () => { lookups++; return [{ address: '93.184.215.14', family: 4 }]; } });
    egress.setTrial('t4');
    const exchange = exchangeWith(egress.port);
    const hosts = ['2130706433', '0x7f000001', '0177.0.0.1', '0x7f.1', '134744072', '8.8.8.8'];
    for (const h of hosts) expect(await exchange(`CONNECT ${h}:443 HTTP/1.1\r\n\r\n`)).toMatch(/^HTTP\/1.1 403/);
    for (const h of ['2130706433', '0x7f000001']) expect(await exchange(`GET http://${h}/ HTTP/1.1\r\nHost: ${h}\r\n\r\n`)).toMatch(/^HTTP\/1.1 403/);
    await Bun.sleep(50);
    expect(lookups).toBe(0);
    const lines = egress.lines('t4');
    expect(lines.length).toBe(hosts.length + 2);
    expect(lines.every((l) => l.decision === 'blocked' && l.reason === 'target is an IP address; the blocklist matches host names')).toBe(true);
    await egress.stop();
  });
  test('connect gets the whole vetted address list: the name resolves once, a dead first address falls back to the next, and a failure is logged failed', async () => {
    const dir = scratch();
    const echo = createServer((s) => s.on('data', (d) => s.write(d)));
    await new Promise<void>((r) => echo.listen(0, '127.0.0.1', () => r()));
    const port = (echo.address() as { port: number }).port;
    let lookups = 0;
    const lists: Record<string, Array<{ address: string; family: number }>> = { 'fallback.test': [{ address: '127.0.0.2', family: 4 }, { address: '127.0.0.1', family: 4 }], 'dead.test': [{ address: '127.0.0.2', family: 4 }] };
    const egress = await startOpenEgress({ host: '127.0.0.1', block: [], logPath: join(dir, 'egress.ndjson'), trusted: ['fallback.test', 'dead.test'], resolve: async (h) => { lookups++; return lists[h]!; } });
    egress.setTrial('t5');
    const exchange = exchangeWith(egress.port);
    expect(await exchange(`CONNECT fallback.test:${port} HTTP/1.1\r\n\r\n`, 'ping')).toContain('ping');
    expect(lookups).toBe(1);
    expect(await exchange(`CONNECT dead.test:${port} HTTP/1.1\r\n\r\n`)).toMatch(/^HTTP\/1.1 502/);
    await Bun.sleep(50);
    const lines = egress.lines('t5');
    expect(lines.map((l) => [l.host, l.decision])).toEqual([['fallback.test', 'allowed'], ['dead.test', 'failed']]);
    expect(lines[1]!.reason).toMatch(/^upstream error: /);
    await egress.stop();
    echo.close();
  });
});

describe('the finish-line scans and the token', () => {
  test('outside the brain: a memory file and a non-session SQLite table count; the brain, transcripts and session tables do not', () => {
    const home = scratch();
    const nonce = 'Vorlimbask';
    mkdirSync(join(home, '.gbrain', 'brain.pglite'), { recursive: true });
    writeFileSync(join(home, '.gbrain', 'brain.pglite', 'page'), 'cat ' + nonce);
    mkdirSync(join(home, 'claude', 'projects', 'p'), { recursive: true });
    writeFileSync(join(home, 'claude', 'projects', 'p', 's.jsonl'), 'user said ' + nonce);
    writeFileSync(join(home, 'history.txt'), nonce);
    const db = new Database(join(home, 'state.db'));
    db.run('CREATE TABLE messages (body TEXT)'); db.run('INSERT INTO messages VALUES (?)', ['the cat is ' + nonce]);
    db.run('CREATE TABLE settings (k TEXT, v TEXT)'); db.run("INSERT INTO settings VALUES ('a', 'b')");
    db.close();
    expect(outsideBrain([home], nonce, home)).toEqual([]);
    expect(filesHolding(join(home, '.gbrain'), nonce.toLowerCase())).toEqual(['brain.pglite/page']);
    const db2 = new Database(join(home, 'state.db'));
    db2.run('CREATE TABLE memories (fact TEXT)'); db2.run('INSERT INTO memories VALUES (?)', ['sister cat ' + nonce.toUpperCase()]);
    db2.close();
    mkdirSync(join(home, 'claude', 'memory'), { recursive: true });
    writeFileSync(join(home, 'claude', 'memory', 'MEMORY.md'), '- cat: ' + nonce);
    expect(outsideBrain([home], nonce, home)).toEqual(['claude/memory/MEMORY.md', 'state.db (memories)']);
  });
  test('outside the brain skips the paths it is told to (the harness TMPDIR), and only those', () => {
    const home = scratch();
    const nonce = 'Vorlimbask';
    mkdirSync(join(home, 'tmp', 'claude-1000'), { recursive: true });
    writeFileSync(join(home, 'tmp', 'claude-1000', 'out.txt'), nonce);
    mkdirSync(join(home, 'notes', 'tmp'), { recursive: true });
    writeFileSync(join(home, 'notes', 'tmp', 'cat.md'), nonce);
    expect(outsideBrain([home], nonce, home)).toEqual(['notes/tmp/cat.md', 'tmp/claude-1000/out.txt']);
    expect(outsideBrain([home], nonce, home, [join(home, 'tmp')])).toEqual(['notes/tmp/cat.md']);
  });
  test('the scrub overwrites the token and its random tail in place; the canary then finds nothing, and names a provider key by name only', () => {
    const root = scratch();
    const token = 'trial-token:run/c/t/r1.' + 'ab12'.repeat(8);
    writeFileSync(join(root, 'a.json'), JSON.stringify({ key: token }));
    writeFileSync(join(root, 'b.bin'), Buffer.concat([Buffer.from([0, 1]), Buffer.from('ab12'.repeat(8)), Buffer.from([2])]));
    writeFileSync(join(root, 'c.log'), 'key trial-token:run/c/t/r1 is fine to name');
    const before = readFileSync(join(root, 'b.bin')).length;
    expect(canaryScan(root, token, {}).token_files).toEqual(['a.json', 'b.bin']);
    expect(scrubToken(root, token)).toEqual(['a.json', 'b.bin']);
    expect(readFileSync(join(root, 'b.bin')).length).toBe(before);
    expect(canaryScan(root, token, {})).toEqual({ token_files: [], key_names: [] });
    const key = 'sk-ant-fixture-' + 'q'.repeat(40);
    writeFileSync(join(root, 'd.txt'), key);
    expect(canaryScan(root, token, { ANTHROPIC_API_KEY: key, OPENAI_API_KEY: '' })).toEqual({ token_files: [], key_names: ['ANTHROPIC_API_KEY'] });
    expect(readdirSync(root).sort()).toEqual(['a.json', 'b.bin', 'c.log', 'd.txt']);
  });
});
