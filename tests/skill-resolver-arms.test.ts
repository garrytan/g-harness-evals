/**
 * internal-task, the skill-resolver arms on the four push harnesses (scripts/skill-resolver/ARMS.md). Keyless throughout: no model is
 * called, no key is read, and every spawned process gets a scrubbed environment (env -i plus PATH and HOME).
 *
 * 1. The stand-in resolver (scripts/skill-resolver/gbrain-stub.ts): a byte-identical index for the same inputs, the schema_version 1
 *    object (gateless contract, spec section 9: ranker {id, version, variant, k}, no_skill only with reason ack or no_match),
 *    shadow, session-wide dedupe, the 2,000-token session block budget and its switch, the per-harness block lines, usage errors
 *    (exit 2), runtime errors with and without --fail-open, the failure switch, CATALOG_MISMATCH and the stale index; the paced
 *    budget (k 5, 3, 1 by phase; only name matches after half), the 10-turn re-suggest, the explicit name, shadow's own state.
 *    The shadow replay check (scripts/skill-resolver/shadow-replay-check.ts) passes on the stand-in and fails on a build whose
 *    shadow shares on mode's state; its --until-exhausted mode runs the budget out. The field-name table (result-fields.ts)
 *    covers every field of the stand-in's result.
 * 2. The hook wrapper (scripts/skill-resolver/hook-wrapper.ts): each harness's reply shape in push mode, nothing in shadow mode, one
 *    resolve per turn, exit 0 and no output on every failure (exit 2, exit 1, bad JSON, wrong schema, a timeout, no turn, no config),
 *    and the INFRA marks (stale index, index_hash or gbrain_version unlike the receipt, CATALOG_MISMATCH); a spent block budget is
 *    coded BUDGET_EXHAUSTED and is not INFRA.
 * 3. The "got the skill" extractor (scripts/skill-resolver/got-skill.ts) on fixture traces for each harness.
 * 4. Adapter refusals at the config parse (process level, nothing written): a skills config on the run entry, and
 *    skills-usage-ordered off OpenClaw. OpenClaw's install step (the adapter's own Python, on a fake kit) keeps a task's seeded
 *    skills (t37's start tree) and refuses only an entry named like a skill it installs.
 * 5. The capture checks (docker; skipped without docker, the kit images harness-eval/<h>:skills-kit or a capture directory):
 *    scripts/skill-resolver/arm-captures.ts writes one keyless capture per harness and arm, and this block re-checks each one it
 *    finds under HE_SKILL_ARM_CAPTURES (default ~/.capy/work/internal-task/arm-captures) with checkCapture.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARMS, checkCapture, loadCapture, type Arm, type H } from '../scripts/skill-resolver/arm-captures.ts';
import { gotSkill, shellReads, type Harness } from '../scripts/skill-resolver/got-skill.ts';
import { FRESH_SESSION, normalizeReceipt, normalizeResult, RESULT_FIELDS } from '../scripts/skill-resolver/result-fields.ts';

const ROOT = join(import.meta.dir, '..');
const BUN = process.execPath;
const STUB = join(ROOT, 'scripts', 'skill-resolver', 'gbrain-stub.ts');
const WRAPPER = join(ROOT, 'scripts', 'skill-resolver', 'hook-wrapper.ts');
const REPLAY = join(ROOT, 'scripts', 'skill-resolver', 'shadow-replay-check.ts');
const ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const tmp = mkdtempSync(join(tmpdir(), 'he-skill-arms-'));

const SKILLS: Record<string, string> = {
  pdf: 'Read, merge and split PDF files.',
  xlsx: 'Build and edit Excel spreadsheets with formulas.',
  'git-workflow': 'Rebase branches and resolve merge conflicts in git.',
  '3-statement-model': 'Build integrated income statement, balance sheet and cash flow models.',
};
const GIT = 'Please rebase my git branch and resolve the merge conflicts.';

function catalog(dir: string, skills = SKILLS) {
  for (const [name, d] of Object.entries(skills)) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'SKILL.md'), '---\nname: ' + name + '\ndescription: ' + d + '\n---\n\nBody of ' + name + '.\n');
  }
}

function stub(home: string, args: string[], input = '', extra: Record<string, string> = {}) {
  const r = spawnSync(BUN, [STUB, ...args], { input, encoding: 'utf8', env: { ...ENV, GBRAIN_HOME: home, ...extra } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: (() => { try { return JSON.parse(r.stdout); } catch { return null; } })() };
}

function setup(name: string) {
  const dir = join(tmp, name), skills = join(dir, 'skills'), home = join(dir, 'home');
  catalog(skills);
  const b = stub(home, ['skills', 'index', 'build', '--catalog', 'he-skills', '--dir', skills, '--json']);
  expect(b.status).toBe(0);
  return { dir, skills, home, raw: b.json as Record<string, unknown>, receipt: normalizeReceipt(b.json) };
}

const resolveArgs = (extra: string[] = []) => ['skills', 'resolve', '--catalog', 'he-skills', '--stdin', '--json', ...extra];

describe('the stand-in resolver (gbrain-stub.ts)', () => {
  test('the same inputs build a byte-identical index; the receipt names it', () => {
    const a = setup('build-a');
    const index = join(a.home, '.gbrain', 'skill-index', 'he-skills', 'index.bin');
    const first = readFileSync(index);
    const again = stub(a.home, ['skills', 'index', 'build', '--catalog', 'he-skills', '--dir', a.skills]);
    expect(again.status).toBe(0);
    expect(readFileSync(index).equals(first)).toBe(true);
    expect(a.raw).toMatchObject({ schema_version: 1, catalog: { name: 'he-skills', skill_count: 4 }, index: { index_hash: sha(first) }, block: { tokenizer: 'he-stub-utf8-bytes-div-4' }, stand_in: true });
    expect(JSON.parse(readFileSync(join(a.home, '.gbrain', 'skill-index', 'he-skills', 'receipt.json'), 'utf8'))).toMatchObject({ index: { index_hash: sha(first) } });
    expect(typeof a.receipt.catalog_hash).toBe('string');
    expect(normalizeReceipt(again.json).catalog_hash).toBe(a.receipt.catalog_hash);
  });

  test('a resolve returns the schema_version 1 object, deterministic but for meta.timing_ms', () => {
    const a = setup('resolve');
    const one = stub(a.home, resolveArgs(['--harness', 'claude-code', '--expect-catalog', String(a.receipt.catalog_hash)]), JSON.stringify({ message: GIT }));
    const two = stub(a.home, resolveArgs(['--harness', 'claude-code', '--expect-catalog', String(a.receipt.catalog_hash)]), JSON.stringify({ message: GIT }));
    expect(one.status).toBe(0);
    const r = one.json;
    for (const k of ['schema_version', 'gbrain_version', 'catalog_hash', 'index_hash', 'ranker', 'suggestions', 'no_skill', 'no_skill_reason', 'block', 'block_tokens', 'block_reason', 'k', 'budget_phase', 'deduped', 'budget_exhausted', 'shadow', 'meta']) expect(r).toHaveProperty(k);
    expect(r).not.toHaveProperty('no_skill_score');
    expect(Object.keys(r.ranker).sort()).toEqual(['id', 'k', 'variant', 'version']);
    expect(r).toMatchObject({ schema_version: 1, no_skill_reason: null, budget_exhausted: false, ranker: { k: 5 }, k: 5, block_reason: 'match', budget_phase: 'under_half', catalog_hash: a.receipt.catalog_hash, index_hash: a.receipt.index_hash, gbrain_version: a.receipt.gbrain_version, no_skill: false, shadow: false, meta: { index_stale: false } });
    expect(r.suggestions[0]).toMatchObject({ id: 'git-workflow', name: 'git-workflow', path: join(a.skills, 'git-workflow', 'SKILL.md') });
    for (const k of ['id', 'name', 'score', 'hint', 'path', 'reason']) expect(r.suggestions[0]).toHaveProperty(k);
    expect(r.block.split('\n')[0]).toBe('Skills that may fit this request (gbrain skills resolve):');
    expect(r.block).toContain('\n- git-workflow: Rebase branches and resolve merge conflicts in git.\n');
    expect(r.block.endsWith('To open one: use the Skill tool.')).toBe(true);
    expect(r.block_tokens).toBe(Math.ceil(Buffer.byteLength(r.block) / 4));
    const strip = (x: { meta: { timing_ms?: number } }) => ({ ...x, meta: { ...x.meta, timing_ms: 0 } });
    expect(strip(two.json)).toEqual(strip(r));
  });

  test('Codex block lines carry the path; --shadow returns the same block marked shadow', () => {
    const a = setup('codex');
    const r = stub(a.home, resolveArgs(['--harness', 'codex', '--shadow']), JSON.stringify({ message: GIT })).json;
    expect(r.shadow).toBe(true);
    expect(r.block).toContain('- git-workflow (' + join(a.skills, 'git-workflow', 'SKILL.md') + '): Rebase');
    expect(r.block.endsWith('To open one: open the SKILL.md path on its line.')).toBe(true);
  });

  test('dedupe is session-wide: a session never repeats a skill it already suggested', () => {
    const a = setup('dedupe');
    const turn = (session = 'dm:pree') => stub(a.home, resolveArgs(['--session', session]), JSON.stringify({ message: GIT })).json;
    const t = [turn(), turn(), turn(), turn(), turn(), turn()];
    expect(t[0].suggestions.map((s: { id: string }) => s.id)).toContain('git-workflow');
    for (const r of t.slice(1)) { expect(r.block).toBe(''); expect(r.deduped).toContain('git-workflow'); expect(r).toMatchObject({ no_skill: false, budget_exhausted: false, block_reason: 'deduped' }); }
    expect(turn('dm:ilse').suggestions.map((s: { id: string }) => s.id)).toContain('git-workflow');
  });

  test('a strong top-1 match returns 10 or more turns after it was last suggested; an explicit skill name bypasses no-repeat', () => {
    const a = setup('resuggest');
    const ask = (message: string) => stub(a.home, resolveArgs(['--session', 'dm:pree']), JSON.stringify({ message })).json;
    const ids = (r: { suggestions: { id: string }[] }) => r.suggestions.map((s) => s.id);
    expect(ids(ask(GIT))).toContain('git-workflow');
    const named = ask('Use git-workflow here.');
    expect([named.block_reason, ids(named)]).toEqual(['match', ['git-workflow']]);
    for (let turn = 3; turn <= 10; turn++) expect(ask('ok thanks').no_skill_reason).toBe('ack');
    const early = ask(GIT);
    expect([early.block_reason, early.deduped.includes('git-workflow')]).toEqual(['deduped', true]);
    const back = ask(GIT);
    expect([back.block_reason, ids(back)]).toEqual(['match', ['git-workflow']]);
    expect(back.deduped).toEqual(['pdf']);
  });

  test('shadow keeps its own session state: on and shadow turns interleaved in one session give the same blocks', () => {
    const a = setup('namespace');
    for (const message of [GIT, GIT, 'Split the PDF files.', 'ok', 'Use git-workflow again.']) {
      const on = stub(a.home, resolveArgs(['--session', 's1']), JSON.stringify({ message })).json;
      const sh = stub(a.home, resolveArgs(['--session', 's1', '--shadow']), JSON.stringify({ message })).json;
      expect([sh.shadow, sh.block, sh.block_reason, sh.session_block_tokens]).toEqual([true, on.block, on.block_reason, on.session_block_tokens]);
    }
    expect(readdirSync(join(a.home, '.gbrain', 'skill-sessions')).length).toBe(2);
  });

  test('no_skill only for an acknowledgement ("ack") or no match ("no_match"); any match is suggested, no score gate', () => {
    const a = setup('noskill');
    const none = stub(a.home, resolveArgs(), JSON.stringify({ message: 'hello there, how are you today?' }));
    expect(none.status).toBe(0);
    expect(none.json).toMatchObject({ no_skill: true, no_skill_reason: 'no_match', block: '', suggestions: [] });
    expect(stub(a.home, resolveArgs(), JSON.stringify({ message: 'Thanks, got it!' })).json).toMatchObject({ no_skill: true, no_skill_reason: 'ack', block: '' });
    const weak = stub(a.home, resolveArgs(), JSON.stringify({ message: 'formulas' })).json;
    expect(weak).toMatchObject({ no_skill: false, no_skill_reason: null });
    expect(weak.suggestions.map((s: { id: string }) => s.id)).toEqual(['xlsx']);
  });

  test('the 2,000-token session budget is paced: k 5, 3 from half, 1 from 80%; after half only name matches spend; then empty', () => {
    const dir = join(tmp, 'budget'), skills = join(dir, 'skills'), home = join(dir, 'home');
    catalog(skills, { xlsx: SKILLS.xlsx!, ...Object.fromEntries(Array.from({ length: 80 }, (_, i) => ['ledger-tool-' + String(i).padStart(2, '0'), 'Reconcile the ledger and audit journal entries, variant ' + i + ', with a description long enough to reach the hint cap.'])) });
    expect(stub(home, ['skills', 'index', 'build', '--catalog', 'he-skills', '--dir', skills]).status).toBe(0);
    const ask = (message: string, extra: Record<string, string> = {}, session = 'channel:C1') => stub(home, resolveArgs(['--session', session]), JSON.stringify({ message }), extra).json;
    const first = ask('formulas');
    expect(first).toMatchObject({ block_reason: 'match', budget_phase: 'under_half', k: 5 });
    let spent = first.session_block_tokens as number, belowPace = false;
    const seq: Record<string, unknown>[] = [];
    while (seq.length < 40) {
      const phase = spent >= 1600 ? 'over_80' : spent >= 1000 ? 'half_to_80' : 'under_half';
      if (phase === 'half_to_80' && !belowPace) {
        belowPace = true;
        expect(ask('edit spreadsheet formulas')).toMatchObject({ block: '', block_reason: 'below_pace', budget_phase: 'half_to_80', k: 3, session_block_tokens: spent });
      }
      const r = ask('reconcile the ledger');
      seq.push(r);
      expect(r.k).toBe({ under_half: 5, half_to_80: 3, over_80: 1 }[phase]);
      if (r.budget_exhausted) break;
      expect(r).toMatchObject({ budget_phase: phase, block_reason: 'match', session_block_tokens: spent + (r.block_tokens as number) });
      expect((r.suggestions as unknown[]).length).toBe(r.k as number);
      spent = r.session_block_tokens as number;
    }
    expect(belowPace).toBe(true);
    expect(seq.some((r) => r.budget_phase === 'over_80')).toBe(true);
    expect(seq.at(-1)).toMatchObject({ budget_exhausted: true, budget_phase: 'exhausted', block_reason: 'budget_exhausted', block: '', suggestions: [], session_block_tokens: spent });
    expect(spent).toBeLessThanOrEqual(2000);
    expect(spent).toBeGreaterThan(2000 - 60);
    expect(ask('reconcile the ledger')).toMatchObject({ budget_exhausted: true, budget_phase: 'exhausted', block: '', k: 0 });
    expect(ask('ok thanks')).toMatchObject({ no_skill_reason: 'ack', budget_exhausted: true, budget_phase: 'exhausted' });
    const sw = stub(home, resolveArgs(['--session', 'channel:C2']), JSON.stringify({ message: 'reconcile the ledger' }), { GBRAIN_STUB_BUDGET_EXHAUSTED: '1' });
    expect([sw.status, sw.json.block, sw.json.budget_exhausted, sw.json.budget_phase, sw.json.block_reason]).toEqual([0, '', true, 'exhausted', 'budget_exhausted']);
  }, 120_000);

  test('usage errors exit 2; runtime errors exit 1 without --fail-open and 0 with it', () => {
    const a = setup('errors');
    expect(stub(a.home, resolveArgs(['--bogus']), '{}').status).toBe(2);
    expect(stub(a.home, ['skills', 'resolve', '--catalog', 'he-skills', '--stdin'], '{}').status).toBe(2);
    expect(stub(a.home, resolveArgs(['--top-k', 'zero']), '{}').status).toBe(2);
    const mismatch = stub(a.home, resolveArgs(['--expect-catalog', 'f'.repeat(64)]), JSON.stringify({ message: GIT }));
    expect(mismatch.status).toBe(1);
    expect(mismatch.json.error.code).toBe('CATALOG_MISMATCH');
    const open = stub(a.home, resolveArgs(['--expect-catalog', 'f'.repeat(64), '--fail-open']), JSON.stringify({ message: GIT }));
    expect(open.status).toBe(0);
    expect(open.json).toMatchObject({ block: '', suggestions: [], error: { code: 'CATALOG_MISMATCH' } });
    expect(stub(a.home, ['skills', 'resolve', '--catalog', 'other', '--stdin', '--json', '--fail-open'], JSON.stringify({ message: GIT })).json.error.code).toBe('INDEX_MISSING');
    expect(stub(a.home, resolveArgs(['--fail-open']), 'not json').json.error.code).toBe('INPUT_INVALID');
    const sw = stub(a.home, resolveArgs(['--fail-open']), JSON.stringify({ message: GIT }), { GBRAIN_STUB_FAIL: 'TIMEOUT' });
    expect(sw.status).toBe(0);
    expect(sw.json).toMatchObject({ block: '', error: { code: 'TIMEOUT' } });
    writeFileSync(join(a.home, 'stub-fail'), 'INDEX_STALE\n');
    expect(stub(a.home, resolveArgs(['--fail-open']), JSON.stringify({ message: GIT })).json.error.code).toBe('INDEX_STALE');
  });

  test('a changed SKILL.md makes the index stale', () => {
    const a = setup('stale');
    writeFileSync(join(a.skills, 'pdf', 'SKILL.md'), '---\nname: pdf\ndescription: changed\n---\n');
    expect(stub(a.home, resolveArgs(), JSON.stringify({ message: GIT })).json.meta.index_stale).toBe(true);
  });
});

describe('the shadow replay check (shadow-replay-check.ts)', () => {
  test('passes on the stand-in; fails with exit 1 when shadow shares on mode state; usage errors exit 2', () => {
    const dir = join(tmp, 'replay');
    mkdirSync(dir, { recursive: true });
    const run = (args: string[]) => spawnSync(BUN, [REPLAY, ...args], { encoding: 'utf8', env: ENV });
    const ok = run(['--gbrain', shim(dir, 'gbrain', 'exec ' + BUN + ' ' + STUB + ' "$@"'), '--harness', 'codex']);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/^SHADOW_REPLAY_OK turns=40 blocks=\d+ sequence_sha256=[0-9a-f]{64} harness=codex .* phases=under_half,half_to_80,over_80,exhausted /);
    const source = readFileSync(STUB, 'utf8'), shared = source.replace("(shadow ? 'shadow' : 'on')", "'on'");
    expect(shared).not.toBe(source);
    writeFileSync(join(dir, 'gbrain-stub-shared.ts'), shared);
    const bad = run(['--gbrain', shim(dir, 'gbrain-shared', 'exec ' + BUN + ' ' + join(dir, 'gbrain-stub-shared.ts') + ' "$@"')]);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/^SHADOW_REPLAY_FAIL .*the shadow block differs from the on block/);
    expect(run(['--bogus', 'x']).status).toBe(2);
    expect(run([]).status).toBe(2);
  }, 180_000);

  test('--until-exhausted replays until the budget runs out: at most 2,000 tokens delivered, then every block empty', () => {
    const dir = join(tmp, 'replay-budget');
    mkdirSync(dir, { recursive: true });
    const r = spawnSync(BUN, [REPLAY, '--gbrain', shim(dir, 'gbrain', 'exec ' + BUN + ' ' + STUB + ' "$@"'), '--until-exhausted', '--out', join(dir, 'r.json')], { encoding: 'utf8', env: ENV });
    expect(r.status).toBe(0);
    const m = /^BUDGET_REPLAY_OK turns=(\d+) exhausted_at=(\d+) spent=(\d+) /.exec(r.stdout);
    expect(m).not.toBeNull();
    expect(Number(m![3])).toBeLessThanOrEqual(2000);
    expect(Number(m![1])).toBe(Number(m![2]) + 3);
    const report = JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8'));
    expect(report.turns.at(-1).on.fields).toMatchObject({ budget_exhausted: true, block: '', budget_phase: 'exhausted' });
  }, 180_000);
});

describe('the field-name table (result-fields.ts)', () => {
  test("every field the table reads is in the stand-in's result, and normalizing it (derived fields included) changes nothing", () => {
    const a = setup('fields');
    const raw = stub(a.home, resolveArgs(['--session', 's1']), JSON.stringify({ message: GIT })).json;
    const at = (o: unknown, p: string) => p.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o);
    for (const [name, f] of Object.entries(RESULT_FIELDS)) if (!name.startsWith('error')) expect([name, at(raw, f.from) !== undefined]).toEqual([name, true]);
    const n = normalizeResult(raw, FRESH_SESSION);
    expect(n).toMatchObject({ block: raw.block, block_reason: raw.block_reason, budget_phase: raw.budget_phase, session_block_tokens: raw.session_block_tokens, k: raw.k, index_stale: raw.meta.index_stale, error: null, error_code: null });
    expect(normalizeResult(raw)).toMatchObject({ block_reason: null, budget_phase: null, session_block_tokens: null });
    expect(n.suggestions).toEqual(raw.suggestions.map((s: { id: string }) => s.id));
    expect(normalizeResult({ error: { code: 'TIMEOUT', message: 'slow' } })).toMatchObject({ error_code: 'TIMEOUT', error_message: 'slow', block: '' });
  });
});

// ---- the hook wrapper -------------------------------------------------------------------------------------------------------------

function shim(dir: string, name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, '#!/bin/sh\n' + body + '\n');
  chmodSync(p, 0o755);
  return p;
}

function wrapperCase(name: string, opts: { harness?: string; mode?: 'shadow' | 'push'; gbrain?: string; expect?: string; receipt?: Record<string, unknown>; turn?: Record<string, unknown> | null; timeout_ms?: number } = {}) {
  const a = setup('w-' + name);
  const gbrain = opts.gbrain ?? shim(a.dir, 'gbrain', 'exec ' + BUN + ' ' + STUB + ' "$@"');
  const receiptPath = join(a.dir, 'receipt.json');
  writeFileSync(receiptPath, JSON.stringify({ ...a.raw, ...(opts.receipt ?? {}) }));
  const status = join(a.dir, 'logs', 'skill-resolver');
  const config = { harness: opts.harness ?? 'claude-code', arm: opts.mode === 'shadow' ? 'native' : 'resolver', mode: opts.mode ?? 'push', gbrain, gbrain_home: a.home, catalog: 'he-skills',
    expect_catalog: opts.expect ?? a.receipt.catalog_hash, receipt: receiptPath, status_dir: status, turn_file: join(a.dir, 'turn.json'), top_k: 5, timeout_ms: opts.timeout_ms ?? 20000 };
  writeFileSync(join(a.dir, 'hook.json'), JSON.stringify(config));
  if (opts.turn !== null) writeFileSync(config.turn_file, JSON.stringify(opts.turn ?? { turn: 1, name: 'turn-0001', session_key: 'dm:pree', session_turn: 1, message: GIT }));
  const run = (cfg = join(a.dir, 'hook.json')) => spawnSync(BUN, [WRAPPER, cfg], { input: '{"hook_event_name":"UserPromptSubmit","prompt":"x"}', encoding: 'utf8', env: ENV });
  const lines = () => existsSync(join(status, 'status.ndjson')) ? readFileSync(join(status, 'status.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  const results = () => existsSync(join(status, 'results.ndjson')) ? readFileSync(join(status, 'results.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  return { a, config, run, lines, results };
}

describe('the hook wrapper (hook-wrapper.ts)', () => {
  test('push mode prints each harness reply shape around the exact block and logs a coded status line', () => {
    for (const h of ['claude-code', 'codex', 'hermes', 'openclaw']) {
      const w = wrapperCase('push-' + h, { harness: h });
      const r = w.run();
      expect(r.status).toBe(0);
      const block = w.results()[0].result.block as string;
      expect(block.length).toBeGreaterThan(0);
      const want = h === 'openclaw' ? block : h === 'hermes' ? JSON.stringify({ context: block }) : JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: block } });
      expect(r.stdout).toBe(want);
      const [s] = w.lines();
      expect(s).toMatchObject({ name: 'turn-0001', session_key: 'dm:pree', harness: h, code: 'OK', injected: true, infra: false, index_stale: false, block_sha256: sha(block), autorebuild_off: true, no_skill: false, no_skill_reason: null, budget_exhausted: false, k: 5, block_reason: 'match', budget_phase: 'under_half' });
      for (const k of ['timing_ms', 'index_hash', 'gbrain_version', 'catalog_hash', 'block_tokens', 'suggestions']) expect(s[k]).not.toBeNull();
      expect(s.argv).toContain('--fail-open');
      expect(s.argv[s.argv.indexOf('--expect-catalog') + 1]).toBe(w.a.receipt.catalog_hash);
      expect(s.argv).not.toContain('--shadow');
    }
  });

  test('a second call in the same turn reuses the turn result: the same output, one resolve', () => {
    const w = wrapperCase('repeat');
    const first = w.run().stdout, second = w.run().stdout;
    expect(second).toBe(first);
    expect(w.lines().map((l) => l.repeat)).toEqual([false, true]);
    expect(w.results().length).toBe(1);
  });

  test('shadow mode prints nothing and logs the shadow result', () => {
    const w = wrapperCase('shadow', { harness: 'codex', mode: 'shadow' });
    const r = w.run();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    const [s] = w.lines();
    expect(s).toMatchObject({ mode: 'shadow', code: 'OK', injected: false, infra: false });
    expect(s.suggestions).toContain('git-workflow');
    expect(s.argv).toContain('--shadow');
    expect(w.results()[0].result.shadow).toBe(true);
  });

  test('every failure exits 0 with no output and a code', () => {
    const cases: [string, string, string][] = [
      ['exit2', 'cat > /dev/null; echo "gbrain: usage: unknown flag" >&2; exit 2', 'EXIT_2'],
      ['exit1', 'cat > /dev/null; exit 1', 'EXIT_1'],
      ['badjson', 'cat > /dev/null; echo not-json', 'BAD_JSON'],
      ['schema', 'cat > /dev/null; echo \'{"schema_version":2,"block":"x"}\'', 'BAD_SCHEMA'],
      ['slow', 'sleep 5', 'WRAPPER_TIMEOUT'],
    ];
    for (const [name, body, code] of cases) {
      const dir = join(tmp, 'shim-' + name);
      mkdirSync(dir, { recursive: true });
      const w = wrapperCase('fail-' + name, { gbrain: shim(dir, 'gbrain', body), timeout_ms: 800 });
      const r = w.run();
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
      expect(w.lines()[0]).toMatchObject({ code, injected: false });
    }
    const noTurn = wrapperCase('noturn', { turn: null });
    expect(noTurn.run().stdout).toBe('');
    expect(noTurn.lines()[0].code).toBe('NO_TURN');
    const r = noTurn.run(join(tmp, 'no-such-config.json'));
    expect([r.status, r.stdout]).toEqual([0, '']);
  });

  test('a spent block budget prints nothing, is coded BUDGET_EXHAUSTED and is not INFRA; no_skill carries its reason', () => {
    const budget = wrapperCase('budget');
    writeFileSync(join(budget.a.home, 'stub-budget-exhausted'), '');
    const r = budget.run();
    expect([r.status, r.stdout]).toEqual([0, '']);
    expect(budget.lines()[0]).toMatchObject({ code: 'BUDGET_EXHAUSTED', budget_exhausted: true, budget_phase: 'exhausted', block_reason: 'budget_exhausted', k: 0, injected: false, infra: false, infra_reasons: [] });
    const ack = wrapperCase('ack', { turn: { turn: 1, name: 'turn-0001', session_key: 'dm:pree', session_turn: 1, message: 'ok thanks' } });
    expect(ack.run().stdout).toBe('');
    expect(ack.lines()[0]).toMatchObject({ code: 'NO_SKILL', no_skill: true, no_skill_reason: 'ack', block_reason: 'ack', budget_phase: 'under_half', budget_exhausted: false, infra: false });
  });

  test('INFRA: a stale index, an index_hash or gbrain_version unlike the receipt, CATALOG_MISMATCH', () => {
    const stale = wrapperCase('infra-stale');
    writeFileSync(join(stale.a.skills, 'pdf', 'SKILL.md'), '---\nname: pdf\ndescription: changed\n---\n');
    stale.run();
    expect(stale.lines()[0]).toMatchObject({ index_stale: true, infra: true, infra_reasons: ['INDEX_STALE'] });
    const receipt = wrapperCase('infra-receipt', { receipt: { index: { index_hash: '0'.repeat(64) }, gbrain_version: '9.9.9' } });
    receipt.run();
    expect(receipt.lines()[0]).toMatchObject({ code: 'OK', infra: true, infra_reasons: ['INDEX_HASH_DIFFERS', 'GBRAIN_VERSION_DIFFERS'] });
    const mismatch = wrapperCase('infra-catalog', { expect: 'e'.repeat(64) });
    expect(mismatch.run().stdout).toBe('');
    expect(mismatch.lines()[0]).toMatchObject({ code: 'CATALOG_MISMATCH', injected: false, infra: true });
    expect(mismatch.lines()[0].infra_reasons).toContain('CATALOG_MISMATCH');
  });
});

// ---- the extractor ----------------------------------------------------------------------------------------------------------------

describe('got the skill (got-skill.ts) on fixture traces', () => {
  const fx = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'skill-resolver', 'got-skill.json'), 'utf8'));
  for (const h of ['openclaw', 'claude-code', 'codex', 'hermes'] as Harness[]) {
    test(h, () => {
      const r = gotSkill({ harness: h, catalog: fx.catalog, requests: fx[h].requests, traces: [fx[h].trace] });
      expect(r.catalog_opened).toEqual(fx[h].expect.catalog_opened);
      expect(r.other_opened).toEqual(fx[h].expect.other_opened);
      expect([...new Set(r.failed.map((f) => f.skill))].sort()).toEqual(fx[h].expect.failed);
    });
  }
  test('only a read opens a skill: a Write, an edit or patch, an echo, a grep or a search naming the path does not; each harness\'s read does', () => {
    const P = (h: Harness) => ({ openclaw: '/workspace/skills', 'claude-code': '/harness-state/claude/skills', codex: '/harness-state/codex/skills', hermes: '/harness-state/hermes/skills' })[h] + '/pdf/SKILL.md';
    const anthropic = (calls: [string, unknown][]) => ({ messages: [{ role: 'assistant', content: calls.map(([name, input], i) => ({ type: 'tool_use', id: 'c' + i, name, input })) }] });
    const responses = (calls: [string, unknown][]) => ({ input: calls.map(([name, input], i) => ({ type: 'function_call', call_id: 'c' + i, name, arguments: JSON.stringify(input) })) });
    const body = (h: Harness, calls: [string, unknown][]) => h === 'codex' || h === 'hermes' ? responses(calls) : anthropic(calls);
    const notReads: Record<Harness, [string, unknown][]> = {
      openclaw: [['write', { path: P('openclaw'), content: 'x' }], ['edit', { path: P('openclaw') }], ['exec', { command: 'echo ' + P('openclaw') }], ['exec', { command: 'grep -n name ' + P('openclaw') }], ['exec', { command: 'cat > ' + P('openclaw') + " <<'EOF'\nx\nEOF" }], ['exec', { command: "sed -i 's/a/b/' " + P('openclaw') }]],
      'claude-code': [['Write', { file_path: P('claude-code'), content: 'x' }], ['Edit', { file_path: P('claude-code') }], ['Grep', { pattern: 'name', path: P('claude-code') }], ['Bash', { command: 'echo "see ' + P('claude-code') + '"' }], ['Bash', { command: 'ls ' + P('claude-code') + ' && find / -name SKILL.md' }]],
      codex: [['exec', { cmd: 'echo ' + P('codex') }], ['exec', { cmd: 'rg -n pdf ' + P('codex') }], ['apply_patch', { input: '*** Update File: ' + P('codex') }], ['exec', { cmd: 'printf x >> ' + P('codex') }]],
      hermes: [['write_file', { path: P('hermes'), content: 'x' }], ['search_files', { pattern: 'pdf', path: P('hermes') }], ['patch', { path: P('hermes') }], ['terminal', { command: 'echo ' + P('hermes') }]],
    };
    const reads: Record<Harness, [string, unknown][]> = {
      openclaw: [['read', { path: P('openclaw') }], ['exec', { command: 'cd /workspace && cat ' + P('openclaw') + ' | head -50' }]],
      'claude-code': [['Read', { file_path: P('claude-code') }], ['Bash', { command: 'sed -n 1,80p ' + P('claude-code') }]],
      codex: [['exec', { cmd: "bash -lc 'cat " + P('codex') + "'" }], ['shell', { command: ['bash', '-lc', 'head -40 ' + P('codex')] }]],
      hermes: [['read_file', { path: P('hermes') }], ['terminal', { command: 'tail -n +1 ' + P('hermes') }]],
    };
    for (const h of ['openclaw', 'claude-code', 'codex', 'hermes'] as Harness[]) {
      expect([h, gotSkill({ harness: h, catalog: ['pdf'], requests: [body(h, notReads[h])] }).catalog_opened]).toEqual([h, []]);
      for (const call of reads[h]) expect([h, call[0], gotSkill({ harness: h, catalog: ['pdf'], requests: [body(h, [call])] }).catalog_opened]).toEqual([h, call[0], ['pdf']]);
    }
    expect(shellReads('cat a/SKILL.md > b/SKILL.md; echo c/SKILL.md | tee d/SKILL.md')).toEqual(['a']);
  });

  test('Codex code mode: a reader command inside exec\'s JavaScript opens the skill; an echo or a grep there does not', () => {
    const P = '/harness-state/codex/skills/pdf/SKILL.md';
    const code = (cmd: string) => ({ input: [{ type: 'custom_tool_call', call_id: 'c0', name: 'exec', input: 'const r = await tools.exec_command(' + JSON.stringify({ cmd, login: false }) + ');\ntext(r.output);' }] });
    const got = (cmd: string) => gotSkill({ harness: 'codex', catalog: ['pdf'], requests: [code(cmd)] }).catalog_opened;
    expect([got('cat ' + P), got("sed -n '1,80p' \"" + P + '"'), got('cd /tmp\nhead -40 ' + P)]).toEqual([['pdf'], ['pdf'], ['pdf']]);
    expect([got('echo ' + P), got('rg -n pdf ' + P), got('printf x >> ' + P)]).toEqual([[], [], []]);
  });

  test('the CLI prints the same answer', () => {
    const dir = join(tmp, 'got-cli');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'names.txt'), fx.catalog.join('\n'));
    writeFileSync(join(dir, 'fake.ndjson'), fx.codex.requests.map((b: unknown) => JSON.stringify({ method: 'POST', path: '/v1/responses', body: b })).join('\n') + '\n');
    writeFileSync(join(dir, 'trace.jsonl'), fx.codex.trace.join('\n') + '\n');
    const r = spawnSync(BUN, [join(ROOT, 'scripts', 'skill-resolver', 'got-skill.ts'), '--harness', 'codex', '--catalog', join(dir, 'names.txt'), '--requests', join(dir, 'fake.ndjson'), '--trace', join(dir, 'trace.jsonl')], { encoding: 'utf8', env: ENV });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('GOT codex catalog=3-statement-model,lbo-model,merger-model other=imagegen failed=0 tool_calls=3');
  });
});

// ---- adapter refusals at the config parse -------------------------------------------------------------------------------------

describe('adapters: skills configs refused where no arm runs (HE-ADAPTER-007, exit 2)', () => {
  const base = (h: string) => ({ HE_LOG_DIR: join(tmp, 'refuse-' + h + '-' + Math.random().toString(36).slice(2)), HE_SESSION_STATE_DIR: join(tmp, 'state-' + h), HE_WORKSPACE_DIR: join(tmp, 'ws-' + h),
    HE_MODEL_BASE_URL: 'http://127.0.0.1:9/x/' + (h === 'codex' ? 'openai' : 'anthropic'), HE_MODEL_API_KEY: 'trial-token:refusal-test', HE_MODEL_NAME: h === 'codex' ? 'gpt-6.1-sol' : 'claude-opus-5-5', HE_TRIAL_ID: 'refusal' });
  const cases: [string, string, string][] = [
    ['claude-code', 'run', 'skills-native'], ['claude-code', 'serve', 'skills-usage-ordered'], ['claude-code', 'serve', 'cli+skills-resolver'],
    ['codex', 'run', 'skills-resolver'], ['codex', 'serve', 'skills-usage-ordered'],
    ['openclaw', 'run', 'skills-native'], ['hermes', 'run', 'skills-native'], ['hermes', 'serve', 'skills-usage-ordered'],
  ];
  for (const [h, entry, config] of cases) {
    test(h + ' ' + entry + ' ' + config, () => {
      const env = base(h);
      const r = spawnSync('bash', [join(ROOT, 'harnesses', h, 'adapter.sh'), entry], { encoding: 'utf8', env: { ...ENV, ...env, HE_HARNESS_CONFIG: config }, timeout: 60_000 });
      expect(r.status).toBe(2);
      const log = readFileSync(join(env.HE_LOG_DIR, 'adapter.log'), 'utf8');
      expect(log).toContain('HE-ADAPTER-007');
      expect(log).toContain(config);
      expect(existsSync(join(env.HE_LOG_DIR, 'ready'))).toBe(false);
      expect(existsSync(join(env.HE_LOG_DIR, 'skill-arm.json'))).toBe(false);
    });
  }
});

// ---- OpenClaw's install step against a seeded skills root --------------------------------------------------------------------

describe("OpenClaw's skills arm keeps a task's own skills (t37's start tree) and refuses only a name clash", () => {
  const src = readFileSync(join(ROOT, 'harnesses', 'openclaw', 'adapter.sh'), 'utf8');
  const at = src.indexOf('skill_line=$(python3 - "$skill_arm"');
  const body = src.slice(src.indexOf("<<'PY'\n", at) + 6, src.indexOf('\nPY\n)', at));
  const T37 = join(ROOT, 'tasks', 'skill-resolver', 'T', 'tasks', 't37-leaked-flag-release-notes', 'start');
  const MTIME = 1762560000;
  const digest = (d: string, top: string[]) => {
    const lines: string[] = [];
    const walk = (rel: string) => {
      for (const n of (rel ? readdirSync(join(d, rel)) : top).slice().sort()) {
        const r = rel ? rel + '/' + n : n;
        if (statSync(join(d, r)).isDirectory()) walk(r); else lines.push(sha(readFileSync(join(d, r))) + '  ' + r);
      }
    };
    walk('');
    return sha(lines.join('\n') + '\n');
  };
  const kit = (dir: string) => {
    catalog(join(dir, 'catalog', 'skills'));
    for (const b of ['gbrain', 'he-skill-hook']) { mkdirSync(join(dir, 'bin'), { recursive: true }); writeFileSync(join(dir, 'bin', b), '#!/bin/sh\n'); chmodSync(join(dir, 'bin', b), 0o755); }
    const receipt = join(dir, 'index', 'openclaw', 'gbrain-home', '.gbrain', 'skill-index', 'he-skills');
    mkdirSync(receipt, { recursive: true });
    writeFileSync(join(receipt, 'receipt.json'), JSON.stringify({ catalog: { catalog_hash: 'gbrain-catalog' }, index: { index_hash: 'index-1' } }));
    mkdirSync(join(dir, 'openclaw-plugin'), { recursive: true });
    writeFileSync(join(dir, 'openclaw-plugin', 'package.json'), '{}');
    writeFileSync(join(dir, 'openclaw-plugin', 'openclaw.plugin.json'), '{}');
    writeFileSync(join(dir, 'openclaw-plugin', 'index.js'), 'const hook = "__HE_SKILL_HOOK__", config = "__HE_SKILL_CONFIG__";\n');
    writeFileSync(join(dir, 'kit.json'), JSON.stringify({ catalog_hash: 'kit-catalog', gbrain_version: '0.60.633.0', catalog_mtime_s: MTIME,
      files: { 'catalog/skills': digest(join(dir, 'catalog', 'skills'), Object.keys(SKILLS)) }, index: { openclaw: { index_hash: 'index-1' } } }));
    return dir;
  };
  const install = (name: string, seed: (root: string) => void) => {
    const dir = join(tmp, 'oc-install-' + name), root = join(dir, 'workspace', 'skills'), state = join(dir, 'state'), logs = join(dir, 'logs');
    for (const d of [root, state, logs, join(dir, 'oc')]) mkdirSync(d, { recursive: true });
    seed(root);
    const r = spawnSync('python3', ['-', 'native', kit(join(dir, 'kit')), root, join(state, 'he-skills'), logs, '150'], { input: body, encoding: 'utf8',
      env: { ...ENV, OPENCLAW_STATE_DIR: join(dir, 'oc'), OPENCLAW_CONFIG_PATH: join(dir, 'oc', 'openclaw.json') } });
    return { r, root, rec: JSON.parse(readFileSync(join(logs, 'skill-arm.json'), 'utf8')) };
  };

  test("t37's skills/release-notes stays byte for byte beside the catalog; the root keeps the kit's mtime so the index stays fresh", () => {
    const { r, root, rec } = install('t37', (root) => cpSync(join(T37, 'skills'), root, { recursive: true }));
    expect(r.stdout).toStartWith('ok 4 ');
    expect(r.status).toBe(0);
    expect(rec.install).toMatchObject({ skills: 4, kept: ['release-notes'], names: Object.keys(SKILLS).sort() });
    for (const f of ['SKILL.md', 'scripts/check.sh']) expect(readFileSync(join(root, 'release-notes', f), 'utf8')).toBe(readFileSync(join(T37, 'skills', 'release-notes', f), 'utf8'));
    expect(readdirSync(root).sort()).toEqual([...Object.keys(SKILLS), 'release-notes'].sort());
    expect(Math.round(statSync(root).mtimeMs / 1000)).toBe(MTIME);
    expect(Math.round(statSync(join(root, 'pdf', 'SKILL.md')).mtimeMs / 1000)).toBe(MTIME);
    expect(Math.round(statSync(join(root, 'release-notes', 'SKILL.md')).mtimeMs / 1000)).not.toBe(MTIME);
  });

  test('a seeded entry named like a catalog skill is refused (HE-ADAPTER-007), and nothing is installed over it', () => {
    const { r, root, rec } = install('clash', (root) => { mkdirSync(join(root, 'pdf')); writeFileSync(join(root, 'pdf', 'SKILL.md'), 'the task\'s own pdf'); });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('HE-ADAPTER-007 the skills arm could not be applied: the skills root ' + root + ' already holds 1 entries named like skills the arm installs (pdf)');
    expect(rec.status).toBe('error');
    expect(readdirSync(root)).toEqual(['pdf']);
    expect(readFileSync(join(root, 'pdf', 'SKILL.md'), 'utf8')).toBe("the task's own pdf");
  });
});

// ---- capture checks (docker) ------------------------------------------------------------------------------------------------------

const CAPTURES = process.env.HE_SKILL_ARM_CAPTURES ?? join(homedir(), '.capy', 'work', 'internal-task', 'arm-captures');
const haveDocker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
const haveKit = (h: string) => haveDocker && spawnSync('docker', ['image', 'inspect', 'harness-eval/' + h + ':skills-kit'], { stdio: 'ignore' }).status === 0;
const captured = existsSync(CAPTURES) ? readdirSync(CAPTURES).filter((d) => existsSync(join(CAPTURES, d, 'capture.json'))) : [];

describe.skipIf(!haveDocker || !captured.length)('capture checks: each keyless capture under ' + CAPTURES, () => {
  const summary = existsSync(join(CAPTURES, 'summary.json')) ? JSON.parse(readFileSync(join(CAPTURES, 'summary.json'), 'utf8')) as { kit: string; usage_order: string } : null;
  for (const d of captured) {
    const m = /^(openclaw|claude-code|codex|hermes)-(.+)$/.exec(d);
    if (!m) continue;
    const [, h, arm] = m as unknown as [string, H, Arm];
    if (!(ARMS as readonly string[]).includes(arm)) continue;
    test.skipIf(!haveKit(h))(h + ' ' + arm, () => {
      const kit = summary?.kit && existsSync(join(summary.kit, 'catalog', 'skills')) ? summary.kit : null;
      if (!kit) return;
      const names = new Set(readdirSync(join(kit, 'catalog', 'skills')));
      const usage = summary?.usage_order && existsSync(summary.usage_order) ? readFileSync(summary.usage_order, 'utf8').split('\n').filter(Boolean) : undefined;
      const chk = checkCapture(h, arm, loadCapture(join(CAPTURES, d)), names, usage);
      expect(chk.problems).toEqual([]);
    });
  }
});

process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
