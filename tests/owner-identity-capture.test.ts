// internal-task family C (owner identity, session capture), keyless: the generated task shape, the launcher run under stand-in claude and
// codex binaries, the adapter wiring against gbrain's own hook shapes, the pilot check on a fake corpus, the corpus sweep in the drain,
// and grading a family C store. Every name, token and value is invented; no test reads a real key.

import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEV_SEED, generateBank, type Gold } from '../world/owner-identity/generate.ts';
import { PROBE_SEED } from '../world/owner-identity/check.ts';
import { CAPTURE_AGENT, CAPTURE_LAUNCHER, type CapturePlan } from '../world/owner-identity/capture.ts';
import { captureEnv, captureLines, checkCapture } from '../runner/trial/oi-capture.ts';
import { drainGbrain, sweepCounts } from '../runner/trial/gbrain-drain.ts';
import { gradeOwnerIdentity, type People } from '../runner/grade/owner-identity.ts';
import type { GbrainStore, StoreFact } from '../runner/grade/owner-identity-store.ts';

const tmp = mkdtempSync(join(tmpdir(), 'he-oi-capture-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const dev = generateBank(DEV_SEED, 'dev', 15);
const probe = generateBank(PROBE_SEED, 'dev', 42);
const captureTasks = (bank: Map<string, string>) => [...bank.keys()].filter((k) => k.endsWith('/capture.json')).map((k) => k.slice(0, -'/capture.json'.length));
const planOf = (bank: Map<string, string>, dir: string) => JSON.parse(bank.get(`${dir}/capture.json`)!) as CapturePlan;
const goldOf = (bank: Map<string, string>, dir: string) => JSON.parse(bank.get(`${dir}/gold.json`)!) as Gold;
const peopleOf = (bank: Map<string, string>) => JSON.parse(bank.get('world/people.json')!) as People;
const OWNER = peopleOf(dev).owner;

/** A task dir on disk from the dev bank. */
function taskDir(dir: string): string {
  const out = join(tmp, 'tasks', dir);
  mkdirSync(out, { recursive: true });
  for (const f of ['task.toml', 'gold.json', 'capture.json']) writeFileSync(join(out, f), dev.get(`${dir}/${f}`)!);
  return out;
}

describe('the generated family C tasks', () => {
  test('the dev bank has two and the probe bank six, after the import and live tasks', () => {
    expect(captureTasks(dev)).toEqual(['dev/oi-16-capture', 'dev/oi-17-capture']);
    expect(captureTasks(probe)).toHaveLength(6);
  });
  for (const [name, bank] of [['dev', dev], ['probe', probe]] as const) {
    test(`${name}: two owner sessions, the orchestrator session and four workers, two env and two detected`, () => {
      for (const dir of captureTasks(bank)) {
        const plan = planOf(bank, dir), gold = goldOf(bank, dir);
        expect(plan.launcher).toBe(CAPTURE_LAUNCHER);
        expect(plan.sessions.map((s) => s.kind)).toEqual(['owner', 'owner', 'orchestrator', 'worker', 'worker', 'worker', 'worker']);
        expect(plan.workers.filter((w) => w.launch === 'env').map((w) => w.agent)).toEqual([CAPTURE_AGENT, CAPTURE_AGENT]);
        expect(plan.workers.filter((w) => w.launch === 'detected').map((w) => w.agent)).toEqual([null, null]);
        expect(gold.family).toBe('C');
        expect(gold.questions).toEqual([]);
        const owner = peopleOf(bank).owner;
        const owners = gold.facts.filter((f) => 'session' in f.where && f.where.session <= 2);
        expect(owners.filter((f) => f.primary === 'owner_recall' && f.claimant === owner)).toHaveLength(3);
        expect(owners.filter((f) => f.hard_case === 'owner_quotes_other' && f.primary === 'false_owner')).toHaveLength(1);
        expect(gold.facts.filter((f) => 'session' in f.where && f.where.session === 3)).toEqual([]);
        for (const w of plan.workers) {
          const facts = gold.facts.filter((f) => 'session' in f.where && f.where.session === w.session);
          expect(facts).toHaveLength(1);
          expect(facts[0]).toMatchObject({ claimant: `agent:${CAPTURE_AGENT}`, hard_case: 'agent_brief_in_user_seat', primary: 'false_owner', subject: owner, launch: w.launch });
          expect(w.brief).toContain('The user prefers');
          expect(w.brief).toContain(facts[0]!.token);
        }
        const toml = bank.get(`${dir}/task.toml`)!;
        expect(toml.match(/\[\[turns\]\]/g)).toHaveLength(3);
        expect(toml).toContain(`bash ${CAPTURE_LAUNCHER}`);
        for (const f of gold.facts.filter((f) => f.launch !== 'typed')) expect(toml).not.toContain(f.token);
      }
    });
  }
});

const wireModule = (h: string) => require(join(import.meta.dir, '..', 'harnesses', h, 'capture', 'wire-capture.cjs'));
const LAUNCHER_BIN = '/harness-state/.gbrain/hook-launcher/gbrain-hook', GBRAIN_BIN = '/harness-state/.local/bin/gbrain';

describe('the adapter wiring (capture/wire-capture.cjs)', () => {
  test('the two harness copies of the launcher and the wiring are byte-identical', () => {
    for (const f of ['launch-workers.sh', 'wire-capture.cjs']) expect(readFileSync(`harnesses/codex/capture/${f}`)).toEqual(readFileSync(`harnesses/claude-code/capture/${f}`));
    expect(statSync('harnesses/codex/capture/launch-workers.sh').mode & 0o111).toBeGreaterThan(0);
  });
  test('the hook commands and the Codex trust hash are the ones gbrain bootstrap writes (gbrain dbc45825)', () => {
    const w = wireModule('codex');
    expect(w.claudeSessionEndCommand(GBRAIN_BIN, LAUNCHER_BIN)).toBe(`env GBRAIN_HOOK_LANE=harness ${LAUNCHER_BIN} ${GBRAIN_BIN} hook session-end`);
    const codex = w.codexSessionEndCommand(GBRAIN_BIN, LAUNCHER_BIN);
    expect(codex).toBe(`sh -c 't="$(mktemp)"; cat >"$t"; GBRAIN_PAYLOAD="$t" GBRAIN_HOOK_LAUNCHER="$0" GBRAIN_BIN="$1" nohup sh -c '\\''"$GBRAIN_HOOK_LAUNCHER" "$GBRAIN_BIN" hook session-end --harness codex <"$GBRAIN_PAYLOAD"; rm -f "$GBRAIN_PAYLOAD"'\\'' >/dev/null 2>&1 &' ${LAUNCHER_BIN} ${GBRAIN_BIN}`);
    expect(w.codexTrustHash(codex, 3)).toBe('sha256:2ae3daf2d3b8de26a4c4a232283e5f4204852280b24c2ba5d26e1d1fefecda46');
  });
});

/** A state dir with the gbrain binary and hook launcher the installer view places, and a harness config dir. */
function wired(harness: 'claude-code' | 'codex', name: string, env: Record<string, string>) {
  const root = join(tmp, name), state = join(root, 'state'), logs = join(root, 'logs'), cap = join(root, 'cap'), ws = join(root, 'ws');
  for (const d of [join(state, '.local/bin'), join(state, '.gbrain/hook-launcher'), logs, ws]) mkdirSync(d, { recursive: true });
  writeFileSync(join(state, '.local/bin/gbrain'), '#!/bin/sh\n');
  writeFileSync(join(state, '.gbrain/hook-launcher/gbrain-hook'), '#!/bin/sh\n');
  const config = join(state, harness === 'codex' ? 'codex' : 'claude');
  mkdirSync(config, { recursive: true });
  if (harness === 'claude-code') writeFileSync(join(config, 'settings.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'x', _gbrain: 'turn-rule-v1' }] }] } }));
  else {
    writeFileSync(join(config, 'hooks.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'x', timeout: 3 }] }] } }));
    writeFileSync(join(config, 'config.toml'), 'model = "m"\n\n[hooks.state."/x/hooks.json:user_prompt_submit:0:0"]\ntrusted_hash = "sha256:00"\n');
  }
  const mcp = join(state, 'mcp.json');
  writeFileSync(mcp, '{}\n');
  const plan = dev.get('dev/oi-16-capture/capture.json')!;
  const rec = wireModule(harness).wire([harness, state, config, logs, cap, ws, ...(harness === 'claude-code' ? [mcp] : [])], { HE_OI_CAPTURE_B64: Buffer.from(plan).toString('base64'), ...env });
  return { root, state, logs, cap, ws, config, mcp, rec };
}

const FAKE = { HE_MODEL_NAME: 'model-x', ANTHROPIC_API_KEY: 'he-fake-proxy-token', HE_MODEL_API_KEY: 'he-fake-proxy-token', HE_WORLD_MCP_TOKEN: 'he-fake-bot-token', OPENAI_API_KEY: 'sk-fake-not-forwarded', HOME: '/harness-state' };

describe('wiring a state dir', () => {
  test('claude-code: one SessionEnd group beside the turn-rule hook, the plan and a 0600 worker.env without other keys', () => {
    const w = wired('claude-code', 'wire-claude', { ...FAKE, PATH: '/usr/bin:/bin', CLAUDE_CONFIG_DIR: '/harness-state/claude', CLAUDE_CODE_MAX_RETRIES: '2' });
    expect(w.rec).toMatchObject({ status: 'ok', code: null, task: 'oi-16-capture' });
    const s = JSON.parse(readFileSync(join(w.config, 'settings.json'), 'utf8'));
    expect(s.hooks.UserPromptSubmit).toHaveLength(1);
    expect(s.hooks.SessionEnd).toEqual([{ hooks: [{ type: 'command', command: `env GBRAIN_HOOK_LANE=harness ${w.state}/.gbrain/hook-launcher/gbrain-hook ${w.state}/.local/bin/gbrain hook session-end`, timeout: 60, _gbrain: 'bootstrap-harness-v1' }] }]);
    expect(readdirSync(join(w.cap, 'workers')).sort()).toEqual(['1', '2', '3', '4']);
    expect(['1', '2', '3', '4'].map((n) => readFileSync(join(w.cap, 'workers', n, 'agent'), 'utf8'))).toEqual(['orchestrator', '', 'orchestrator', '']);
    const env = readFileSync(join(w.cap, 'worker.env'), 'utf8');
    expect(statSync(join(w.cap, 'worker.env')).mode & 0o777).toBe(0o600);
    expect(env).toContain("export CLAUDE_CODE_MAX_RETRIES='2'");
    expect(env).toContain(`export HE_OI_MCP_CONFIG=${w.mcp}`);
    expect(env).not.toContain('OPENAI_API_KEY');
    const rec = JSON.parse(readFileSync(join(w.logs, 'oi-capture.json'), 'utf8'));
    expect(rec.worker_env_names).toContain('ANTHROPIC_API_KEY');
    expect(JSON.stringify(rec)).not.toContain('he-fake');
  });
  test('codex: the SessionEnd group in hooks.json and its trust table in gbrain\'s managed block after the installer\'s table', () => {
    const w = wired('codex', 'wire-codex', { ...FAKE, PATH: '/usr/bin:/bin', CODEX_HOME: '/harness-state/codex' });
    expect(w.rec.status).toBe('ok');
    const hooks = JSON.parse(readFileSync(join(w.config, 'hooks.json'), 'utf8'));
    expect(hooks.hooks.UserPromptSubmit).toHaveLength(1);
    expect(hooks.hooks.SessionEnd).toHaveLength(1);
    const toml = readFileSync(join(w.config, 'config.toml'), 'utf8');
    expect(toml.startsWith('model = "m"\n\n[hooks.state."/x/hooks.json:user_prompt_submit:0:0"]')).toBe(true);
    expect(toml).toContain(`[hooks.state.${JSON.stringify(join(w.config, 'hooks.json') + ':session_end:0:0')}]\ntrusted_hash = "${wireModule('codex').codexTrustHash(hooks.hooks.SessionEnd[0].hooks[0].command, 3)}"`);
    expect(readFileSync(join(w.cap, 'worker.env'), 'utf8')).toContain("export HE_WORLD_MCP_TOKEN='he-fake-bot-token'");
  });
  test('no gbrain binary, a hook already there or a bad plan is HE-ADAPTER-008 with the reason recorded', () => {
    const w = wired('codex', 'wire-twice', { ...FAKE, PATH: '/usr/bin:/bin' });
    const again = wireModule('codex').wire(['codex', w.state, w.config, w.logs, w.cap, w.ws], { HE_OI_CAPTURE_B64: Buffer.from(dev.get('dev/oi-16-capture/capture.json')!).toString('base64') });
    expect(again).toMatchObject({ status: 'error', code: 'HE-ADAPTER-008' });
    expect(again.error).toMatch(/already has a gbrain SessionEnd hook/);
    rmSync(join(w.state, '.local/bin/gbrain'));
    expect(wireModule('codex').wire(['codex', w.state, w.config, w.logs, w.cap, w.ws], { HE_OI_CAPTURE_B64: 'e30=' }).error).toMatch(/no workers/);
    expect(wireModule('codex').wire(['codex', w.state, join(tmp, 'none'), w.logs, w.cap, w.ws], { HE_OI_CAPTURE_B64: Buffer.from(dev.get('dev/oi-16-capture/capture.json')!).toString('base64') }).error).toMatch(/no gbrain binary/);
    expect(wireModule('codex').wire(['hermes', w.state, w.config, w.logs, w.cap, w.ws], {}).error).toMatch(/no family C capture route/);
  });
});

/** A stand-in harness binary: records its argv, GBRAIN_SESSION_AGENT, stdin and its ancestors' process names, prints one line. */
const STANDIN = `#!/bin/bash
p=$PPID a=''
while [ "$p" -gt 1 ]; do a="$a $(cat /proc/$p/comm)"; s=$(cat /proc/$p/stat); s=\${s##*) }; s=\${s#* }; p=\${s%% *}; done
{ printf 'argv:%s\\n' "$*"; printf 'agent:%s\\n' "\${GBRAIN_SESSION_AGENT-<unset>}"; printf 'ancestors:%s\\n' "$a"; printf 'stdin:'; cat; } > "$HE_TEST_OUT/$$.txt"
echo '{"result":"ok"}'
`;

describe('the launcher under a stand-in orchestrator (capture/launch-workers.sh)', () => {
  for (const harness of ['claude-code', 'codex'] as const) {
    const bin = harness === 'codex' ? 'codex' : 'claude';
    test(`${harness}: four workers under the orchestrator, the env label on two, the brief on stdin, nothing secret printed`, () => {
      const root = join(tmp, `launch-${harness}`), workerBin = join(root, 'worker-bin'), orchBin = join(root, 'orch-bin'), out = join(root, 'out');
      for (const d of [workerBin, orchBin, out]) mkdirSync(d, { recursive: true });
      writeFileSync(join(workerBin, bin), STANDIN); chmodSync(join(workerBin, bin), 0o755);
      writeFileSync(join(orchBin, bin), '#!/bin/bash\nbash "$1"\nexit $?\n'); chmodSync(join(orchBin, bin), 0o755);
      const PATH = `${workerBin}:/usr/bin:/bin`;
      const w = wired(harness, `launch-wire-${harness}`, { ...FAKE, PATH });
      expect(w.rec.status).toBe('ok');
      const launcher = join(import.meta.dir, '..', 'harnesses', harness, 'capture', 'launch-workers.sh');
      const r = Bun.spawnSync(['env', '-i', `PATH=${PATH}`, `HOME=${process.env.HOME}`, `HE_OI_CAPTURE_DIR=${w.cap}`, `HE_TEST_OUT=${out}`, 'GBRAIN_SESSION_AGENT=leaked-from-orchestrator', 'CLAUDECODE=1', join(orchBin, bin), launcher]);
      const stdout = r.stdout.toString();
      expect(r.exitCode).toBe(0);
      expect(stdout.trim().split('\n')).toEqual(['worker 1: exit 0', 'worker 2: exit 0', 'worker 3: exit 0', 'worker 4: exit 0', 'DONE 4 of 4 workers exited 0']);
      const gold = goldOf(dev, 'dev/oi-16-capture'), plan = planOf(dev, 'dev/oi-16-capture');
      for (const s of [...gold.facts.map((f) => f.token), 'he-fake', 'sk-fake']) expect(stdout + r.stderr.toString()).not.toContain(s);
      const runs = readdirSync(out).map((f) => readFileSync(join(out, f), 'utf8'));
      expect(runs).toHaveLength(4);
      for (const wk of plan.workers) {
        const run = runs.find((x) => x.includes(wk.brief))!;
        expect(run).toBeDefined();
        expect(run).toContain(`agent:${wk.agent ?? '<unset>'}\n`);
        const argv = run.match(/^argv:(.*)$/m)![1]!;
        if (harness === 'claude-code') expect(argv).toBe(`-p --output-format json --model model-x --permission-mode bypassPermissions --disallowedTools WebSearch,WebFetch --mcp-config ${w.mcp} --strict-mcp-config`);
        else expect(argv).toBe(`exec --json --skip-git-repo-check --strict-config -C ${w.ws} -`);
        // gbrain's detection rule: a headless claude or codex with a claude or codex process among its ancestors.
        expect(run.match(/^ancestors:(.*)$/m)![1]!.trim().split(' ')).toContain(bin);
      }
      const rows = readFileSync(join(w.logs, 'launch.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(rows[0].ancestors.some((a: string) => a.endsWith(`:${bin}`))).toBe(true);
      expect(rows.slice(1, 1 + plan.workers.length).map((x) => [x.worker, x.launch, x.started])).toEqual(plan.workers.map((wk) => [wk.n, wk.launch, true]));
      expect(rows.slice(1 + plan.workers.length).map((x) => [x.worker, x.launch, x.exit])).toEqual(plan.workers.map((wk) => [wk.n, wk.launch, 0]));
    });
  }
  test('with no plan the launcher refuses and starts nothing', () => {
    const r = Bun.spawnSync(['env', '-i', 'PATH=/usr/bin:/bin', `HOME=${process.env.HOME}`, `HE_OI_CAPTURE_DIR=${join(tmp, 'no-plan')}`, 'bash', 'harnesses/codex/capture/launch-workers.sh']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString()).toMatch(/the adapter wrote no capture plan/);
  });
});

describe('the runner side', () => {
  test('captureEnv: {} for other tasks, the plan for a capture task, HE-TASK-006 for a cell that cannot run it', () => {
    const dir = taskDir('dev/oi-16-capture');
    const cell = { id: 'c', harness: 'codex', gbrain: { llm: 'proxy', install: 'gbrain-installer' } };
    expect(captureEnv(join(tmp, 'tasks'), cell)).toEqual({});
    expect(Buffer.from(captureEnv(dir, cell).HE_OI_CAPTURE_B64!, 'base64').toString()).toBe(dev.get('dev/oi-16-capture/capture.json')!);
    expect(() => captureEnv(dir, { ...cell, harness: 'openclaw' })).toThrow(/^HE-TASK-006 .*harness openclaw has no capture wiring/);
    expect(() => captureEnv(dir, { ...cell, gbrain: { install: 'gbrain-installer' } })).toThrow(/gbrain.llm is not "proxy"/);
    expect(() => captureEnv(dir, { ...cell, gbrain: { llm: 'proxy', install: 'mcp' } })).toThrow(/gbrain.install is not "gbrain-installer"/);
    expect(() => captureEnv(dir, { ...cell, config: 'route-hook' })).toThrow(/config route-hook is not the default/);
  });

  test('checkCapture finds each gold session by its tokens and checks the decision source in its speaker sidecar', () => {
    const dir = taskDir('dev/oi-16-capture');
    const gold = goldOf(dev, 'dev/oi-16-capture'), plan = planOf(dev, 'dev/oi-16-capture');
    const root = join(tmp, 'check'), state = join(root, 'state'), logs = join(root, 'logs'), spool = join(state, '.gbrain/transcripts/corpus/sourced');
    mkdirSync(spool, { recursive: true }); mkdirSync(logs, { recursive: true });
    const tokens = (n: number) => gold.facts.filter((f) => 'session' in f.where && f.where.session === n).map((f) => f.token).join(' ');
    const bank = (sid: string, text: string, speaker?: object) => {
      writeFileSync(join(spool, `${sid}.unresolved.txt`), text);
      if (speaker) writeFileSync(join(spool, `${sid}.speaker.json`), JSON.stringify({ version: 1, ...speaker, harness: 'codex', first_seen: '2026-11-19T00:00:00Z' }));
    };
    bank('s1', `USER: ${tokens(1)}`); bank('s2', `USER: ${tokens(2)}`); bank('s3', 'USER: start my workers\nASSISTANT: DONE 4 of 4');
    bank('s4', tokens(4), { principal: 'orchestrator', source: 'env' });
    bank('s5', tokens(5), { principal: 'agent-launched', source: 'detected' });
    bank('s6', tokens(6), { principal: 'orchestrator', source: 'env' });
    bank('s7', tokens(7));
    mkdirSync(join(state, '.gbrain/integrations/hooks'), { recursive: true });
    writeFileSync(join(state, '.gbrain/integrations/hooks/heartbeat.jsonl'), [{ event: 'session-end', outcome: 'ok' }, { event: 'session-end', outcome: 'ok' }, { event: 'user-prompt', outcome: 'ok' }].map((x) => JSON.stringify(x)).join('\n') + '\n');
    writeFileSync(join(logs, 'launch.jsonl'), [{ launcher_pid: 9, ancestors: ['9:bash', '8:codex', '7:bash'] }, ...plan.workers.map((wk) => ({ worker: wk.n, launch: wk.launch, exit: 0, seconds: 30 }))].map((x) => JSON.stringify(x)).join('\n') + '\n');
    const out = join(root, 'owner-identity', 'capture.json');
    const c = checkCapture({ taskDir: dir, stateDir: state, logsDir: logs, out });
    expect(c.sessions.map((s) => [s.n, s.sessions, s.pass])).toEqual([[1, ['s1'], true], [2, ['s2'], true], [3, ['s3'], true], [4, ['s4'], true], [5, ['s5'], true], [6, ['s6'], true], [7, ['s7'], false]]);
    expect(c.sessions[6]!.reason).toBe('decision source no sidecar (owner), expected agent-launched/detected');
    expect(c.pass).toBe(false);
    expect(c.heartbeat!.session_end).toEqual({ ok: 2 });
    expect(c.launch).toMatchObject({ harness_ancestor: true, workers: plan.workers.map((wk) => ({ worker: wk.n, launch: wk.launch, exit: 0, seconds: 30 })) });
    // Started rows: a worker still running when the turn ended keeps its row, with no exit.
    writeFileSync(join(logs, 'launch.jsonl'), [{ launcher_pid: 9, ancestors: ['9:bash', '8:codex', '7:bash'] }, ...plan.workers.map((wk) => ({ worker: wk.n, launch: wk.launch, started: true })),
      ...plan.workers.slice(1).map((wk) => ({ worker: wk.n, launch: wk.launch, exit: 0, seconds: 30 }))].map((x) => JSON.stringify(x)).join('\n') + '\n');
    const hung = checkCapture({ taskDir: dir, stateDir: state, logsDir: logs });
    expect(hung.launch!.workers).toEqual(plan.workers.map((wk, i) => ({ worker: wk.n, launch: wk.launch, exit: i ? 0 : null, seconds: i ? 30 : null })));
    expect(JSON.parse(readFileSync(out, 'utf8')).pass).toBe(false);
    expect(captureLines(c)).toContain('FAIL session 7 worker (detected): decision source no sidecar (owner), expected agent-launched/detected');
    expect(captureLines(c)).toContain('PASS session 4 worker (env): banked as orchestrator/env');

    writeFileSync(join(spool, 's5.speaker.json'), JSON.stringify({ version: 1, principal: 'agent-launched', source: 'detected' }));
    writeFileSync(join(spool, 's7.speaker.json'), JSON.stringify({ version: 1, principal: 'agent-launched', source: 'detected' }));
    writeFileSync(join(spool, 's3.unresolved.txt'), `USER: start my workers\nASSISTANT: ${tokens(4)}`);
    const mixed = checkCapture({ taskDir: dir, stateDir: state, logsDir: logs });
    expect(mixed.sessions[2]).toMatchObject({ n: 3, pass: false, reason: "not banked: no corpus session carries this session's text" });
    expect(mixed.sessions[3]).toMatchObject({ n: 4, sessions: ['s3', 's4'], pass: false });
    rmSync(join(spool, 's3.unresolved.txt'));
    writeFileSync(join(spool, 's3.unresolved.txt'), 'USER: start my workers');
    expect(checkCapture({ taskDir: dir, stateDir: state, logsDir: logs }).pass).toBe(true);

    const cli = (...args: string[]) => Bun.spawnSync(['env', '-i', `PATH=${process.env.PATH}`, `HOME=${process.env.HOME}`, process.execPath, 'scripts/owner-identity/capture-check.ts', ...args]);
    const stale = cli('--trial', root);
    expect(stale.exitCode).toBe(1);
    expect(stale.stdout.toString()).toContain(`FAIL ${root} (`);
    const rerun = cli('--trial', root, '--task', dir);
    expect(rerun.exitCode).toBe(0);
    expect(rerun.stdout.toString()).toContain(`PASS ${root} (`);
    expect(JSON.parse(readFileSync(out, 'utf8')).pass).toBe(true);
    expect(cli('--trial', join(tmp, 'no-such-trial')).stdout.toString()).toContain('the trial ran no family C check');
    expect(cli().exitCode).toBe(2);
  });
});

describe('the corpus sweep in the drain', () => {
  test('sweepCounts reads gbrain sweep --json', () => {
    expect(sweepCounts({ corpusIngested: 3, skipped: [{ reason: 'already_ingested', count: 2 }, { reason: 'corpus_source_unresolved', count: 1 }] })).toEqual({ ingested: 3, skipped: { already_ingested: 2, corpus_source_unresolved: 1 } });
    expect(sweepCounts({ phases: [] })).toBeNull();
  });
  test('with a corpus dir the drain copies it into the brain copy, points gbrain at it and sweeps until a pass ingests nothing', async () => {
    const corpus = join(tmp, 'drain-corpus');
    mkdirSync(join(corpus, 'sourced'), { recursive: true });
    writeFileSync(join(corpus, 'sourced', 'a.unresolved.txt'), 'USER: hi');
    writeFileSync(join(corpus, 'sourced', 'a.speaker.json'), '{}');
    const scripts: string[] = [];
    let sweeps = 0;
    const run = async (argv: string[]) => {
      if (argv[1] === 'cp') mkdirSync(join(argv[4]!, '.gbrain'), { recursive: true });
      if (argv.some((a) => a.includes('owner-identity-dump'))) return { status: 0, stdout: JSON.stringify({ gbrain_version: 'v', owner_member: null, pages: [], facts: [], absorb_log: [], absorb_jobs: [] }), stderr: '' };
      if (argv[0] === 'docker' && argv.includes('-c')) {
        const script = argv.at(-1)!;
        scripts.push(script);
        const brain = argv[argv.indexOf('-v') + 1]!.split(':')[0]!;
        expect(existsSync(join(brain, 'he-capture-corpus', 'sourced', 'a.speaker.json'))).toBe(true);
        if (script.includes('sweep --once')) return { status: 0, stdout: JSON.stringify({ corpusIngested: sweeps++ === 0 ? 1 : 0, skipped: [] }), stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const sidecar = { url: 'http://x', token: 't', image: 'harness-eval/gbrain:dev', container: 'c', cliRunArgs: [], cliEnv: [], halt: async () => undefined };
    const { record } = await drainGbrain({ sidecar, trialId: 't', trialDir: join(tmp, 'drain-trial'), since: '2026-11-19T00:00:00.000Z', log: () => undefined, corpusDir: corpus, quietMs: 0, pollMs: 1, run, callTool: async (tool) => (tool === 'get_stats' ? { pages: 0 } : null) });
    expect(record.error).toBeUndefined();
    expect(record.capture_sweep).toEqual({ corpus_files: 1, passes: 2, ingested: 1, skipped: {} });
    expect(scripts[0]).toMatch(/rebind-sources\.ts .* config set dream\.synthesize\.session_corpus_dir \/brain\/he-capture-corpus/);
    expect(scripts.slice(1).every((s) => s.includes('sweep --once') && !s.includes('rebind-sources'))).toBe(true);
  });
  test('a failed sweep is a drain error carrying the counts so far', async () => {
    const corpus = join(tmp, 'drain-corpus');
    const run = async (argv: string[]) => {
      if (argv[1] === 'cp') mkdirSync(join(argv[4]!, '.gbrain'), { recursive: true });
      if (argv.includes('-c') && argv.at(-1)!.includes('sweep --once')) return { status: 1, stdout: '', stderr: 'gbrain sweep: total failure' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const sidecar = { url: 'http://x', token: 't', image: 'i', container: 'c', cliRunArgs: [], cliEnv: [], halt: async () => undefined };
    const { record, store } = await drainGbrain({ sidecar, trialId: 't', trialDir: join(tmp, 'drain-trial2'), since: '2026-11-19T00:00:00.000Z', log: () => undefined, corpusDir: corpus, quietMs: 0, pollMs: 1, run, callTool: async (tool) => (tool === 'get_stats' ? { pages: 0 } : null) });
    expect(store).toBeNull();
    expect(record.error).toMatch(/gbrain sweep --once failed \(exit 1\): gbrain sweep: total failure/);
    expect(record.capture_sweep).toMatchObject({ corpus_files: 1, passes: 1, ingested: 0 });
  });
});

describe('grading a family C store', () => {
  const gold = goldOf(dev, 'dev/oi-16-capture'), people = peopleOf(dev);
  const ownerSlug = people.people.find((p) => p.id === OWNER)!.page_slug;
  let id = 1;
  const row = (text: string, over: Partial<StoreFact> = {}): StoreFact => ({ id: id++, source_id: 'default', entity_slug: ownerSlug, fact: text, context: null, kind: 'fact', visibility: 'private', source: 'sweep:corpus', source_category: 'sweep', source_session: null, attributed_to: null, unattributed: false, expired: false, ...over });
  const store = (facts: StoreFact[]): GbrainStore => ({ schema_version: 1, kind: 'gbrain', read_via: "gbrain/owner-identity-dump.ts (read-only SQL through gbrain's engine)", gbrain_version: 'v', owner_member: null, pages: [], facts, absorb_log: [], absorb_jobs: [] });
  const worker = (launch: string) => gold.facts.filter((f) => f.launch === launch);
  test('a brief fact on the owner page marked with gbrain\'s speaker note is reported, a plain one is a false owner; by_launch splits them', () => {
    const [env1, env2] = worker('env'), [det1, det2] = worker('detected');
    const owners = gold.facts.filter((f) => f.primary === 'owner_recall');
    const v = gradeOwnerIdentity({ store: store([
      row(env1!.text, { context: 'speaker: agent orchestrator, not the owner' }),
      row(env2!.text, { context: 'speaker: agent orchestrator, not the owner' }),
      row(det1!.text, { context: 'speaker: agent agent-launched, not the owner' }),
      row(det2!.text),
      ...owners.map((f) => row(f.text)),
    ]), gold, people });
    const by = (fid: string) => v.facts.find((f) => f.id === fid)!;
    expect([env1, env2, det1].map((f) => [by(f!.id).false_owner_hit, by(f!.id).correctly_reported])).toEqual([[false, true], [false, true], [false, true]]);
    expect(by(det2!.id).false_owner_hit).toBe(true);
    expect(v.summary.by_launch!.env!.false_owner).toMatchObject({ num: 0, den: 2 });
    expect(v.summary.by_launch!.detected!.false_owner).toMatchObject({ num: 1, den: 2 });
    expect(v.summary.by_launch!.typed!.owner_recall).toMatchObject({ num: 3, den: 3 });
  });
});
