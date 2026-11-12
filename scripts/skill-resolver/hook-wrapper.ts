#!/usr/bin/env bun
// The skill-resolver hook wrapper (internal-task), one program for the four push harnesses' per-turn hooks: the OpenClaw
// he-skill-resolver plugin (before_prompt_build), the Claude Code and Codex UserPromptSubmit lane of its own, and the Hermes
// pre_llm_call shell hook. The kit ships it compiled (bin/he-skill-hook, scripts/skill-resolver/build-kit.ts), so it runs in
// every image whatever the image carries (the Hermes image has no node, the Claude Code and Codex images no python3).
//
//   he-skill-hook <config.json>        (the harness's hook payload on stdin, read and ignored)
//
// config.json, written by the adapter: { harness, arm, mode: "shadow"|"push", gbrain, gbrain_home, catalog, expect_catalog,
// receipt, status_dir, turn_file, top_k, timeout_ms }. turn_file is the turn context the adapter writes before every member
// turn: { turn, name, session_key, session_turn, message, previous_user_message }.
//
// Each call runs one resolve (a repeated call in the same turn reuses the turn's result):
//   <gbrain> skills resolve --catalog <c> --input-json - --json --session <session_key> --harness <h> --top-k <k>
//       [--shadow --shadow-log <status_dir>/shadow/<turn>.ndjson] --fail-open --expect-catalog <hash>
// with env -i plus PATH, HOME, GBRAIN_HOME and GBRAIN_SKILLS_NO_AUTOREBUILD=1. In shadow mode the release prints a quiet
// result (block "", no suggestions) and appends the result it would have injected to the --shadow-log file, so the wrapper
// reads that one; a call that leaves no shadow log line (an error, the stand-in) is read from stdout. The wrapper keeps the
// session's delivered block tokens and whether its budget ran out in <status_dir>/session-tokens.json, per mode and session key, and derives
// session_block_tokens, budget_phase and block_reason from it (result-fields.ts deriveSessionFields). It appends one coded status line to
// <status_dir>/status.ndjson (code, timing_ms, index_stale, index_hash, gbrain_version, catalog_hash, block sha256 and bytes,
// block_tokens, suggestions, deduped, no_skill and no_skill_reason, budget_exhausted, session_block_tokens, k, block_reason,
// budget_phase, injected, infra and why) and the full result to <status_dir>/results.ndjson. A turn is
// INFRA when the result says index_stale, when index_hash or gbrain_version differ from the build receipt, or on
// CATALOG_MISMATCH (also when the receipt cannot be read). Every result and the receipt are read through the field-name tables in
// result-fields.ts; results.ndjson keeps the raw result and, as fields, the same result under the eval's names. An empty block because the session's block budget is spent
// (code BUDGET_EXHAUSTED) is a result, not INFRA.
//
// Output: in push mode with a non-empty block and no error, the harness's own reply shape (Claude Code and Codex
// hookSpecificOutput.additionalContext, Hermes {"context": block}, OpenClaw the block's bytes alone for the plugin). Shadow mode
// prints nothing. Any failure (a usage error's exit 2, any nonzero exit, a timeout, output that is not the schema_version 1
// object, an unreadable config) prints nothing. The wrapper always exits 0.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FRESH_SESSION, normalizeReceipt, normalizeResult, type NormalizedResult, type SessionBefore } from './result-fields.ts';

export type HookConfig = {
  harness: 'openclaw' | 'claude-code' | 'codex' | 'hermes'; arm: string; mode: 'shadow' | 'push'; gbrain: string; gbrain_home: string; catalog: string;
  expect_catalog: string; receipt: string; status_dir: string; turn_file: string; top_k?: number; timeout_ms?: number;
};
export type TurnContext = { turn?: number | string; name?: string; session_key?: string; session_turn?: number; message?: string; previous_user_message?: string };
export type StatusLine = {
  name: string | null; turn: number | string | null; session_key: string | null; session_turn: number | null; harness: string; arm: string; mode: string;
  code: string; exit: number | null; timing_ms: number | null; wall_ms: number; index_stale: boolean | null; index_hash: string | null; gbrain_version: string | null;
  catalog_hash: string | null; block_sha256: string | null; block_bytes: number; block_tokens: number | null; suggestions: string[]; deduped: string[]; no_skill: boolean | null;
  no_skill_reason: string | null; budget_exhausted: boolean | null; session_block_tokens: number | null; k: number | null; block_reason: string | null; budget_phase: string | null;
  injected: boolean; repeat: boolean; infra: boolean; infra_reasons: string[]; argv: string[]; autorebuild_off: boolean; error: string | null;
};

const sha = (b: string) => createHash('sha256').update(b).digest('hex');

export function hookOutput(harness: string, block: string): string {
  if (harness === 'openclaw') return block;
  if (harness === 'hermes') return JSON.stringify({ context: block });
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: block } });
}

export function resolveArgv(c: HookConfig, session: string, shadowLog: string): string[] {
  return [c.gbrain, 'skills', 'resolve', '--catalog', c.catalog, '--input-json', '-', '--json', '--session', session, '--harness', c.harness,
    '--top-k', String(c.top_k ?? 5), ...(c.mode === 'shadow' ? ['--shadow', '--shadow-log', shadowLog] : []), '--fail-open', '--expect-catalog', c.expect_catalog];
}

/** The last JSON line of a --shadow-log file, or null. */
function lastLogLine(path: string): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(path, 'utf8').trim().split('\n').pop()!) as Record<string, unknown>; } catch { return null; }
}

/** One hook call. Returns what to print (possibly empty); never throws. */
export function runHook(configPath: string): string {
  const t0 = performance.now();
  let c: HookConfig;
  try { c = JSON.parse(readFileSync(configPath, 'utf8')) as HookConfig; } catch { return ''; }
  const line: StatusLine = {
    name: null, turn: null, session_key: null, session_turn: null, harness: c.harness, arm: c.arm, mode: c.mode, code: 'WRAPPER_ERROR', exit: null, timing_ms: null,
    wall_ms: 0, index_stale: null, index_hash: null, gbrain_version: null, catalog_hash: null, block_sha256: null, block_bytes: 0, block_tokens: null, suggestions: [],
    deduped: [], no_skill: null, no_skill_reason: null, budget_exhausted: null, session_block_tokens: null, k: null, block_reason: null, budget_phase: null, injected: false, repeat: false, infra: false, infra_reasons: [], argv: [], autorebuild_off: true, error: null,
  };
  let printed = '';
  let result: Record<string, unknown> | null = null;
  let stdoutResult: Record<string, unknown> | null = null;
  let fields: NormalizedResult | null = null;
  try {
    mkdirSync(c.status_dir, { recursive: true });
    let ctx: TurnContext;
    try { ctx = JSON.parse(readFileSync(c.turn_file, 'utf8')) as TurnContext; } catch { line.code = 'NO_TURN'; line.error = 'no readable turn context at ' + c.turn_file; return ''; }
    Object.assign(line, { name: ctx.name ?? null, turn: ctx.turn ?? null, session_key: ctx.session_key ?? null, session_turn: ctx.session_turn ?? null });
    const cacheFile = join(c.status_dir, 'turns', String(ctx.name ?? ctx.turn ?? 'turn') + '.json');
    if (existsSync(cacheFile)) {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as { status: StatusLine; printed: string };
      Object.assign(line, cached.status, { repeat: true, wall_ms: 0 });
      printed = cached.printed;
      return printed;
    }
    const session = ctx.session_key ?? 'he-skill-session';
    const shadowLog = join(c.status_dir, 'shadow', String(ctx.name ?? ctx.turn ?? 'turn') + '.ndjson');
    if (c.mode === 'shadow') { mkdirSync(dirname(shadowLog), { recursive: true }); rmSync(shadowLog, { force: true }); }
    const tallyFile = join(c.status_dir, 'session-tokens.json');
    let tally: Record<string, SessionBefore> = {};
    try { tally = JSON.parse(readFileSync(tallyFile, 'utf8')) as Record<string, SessionBefore>; } catch { /* first turn */ }
    const tallyKey = c.mode + '\n' + session;
    line.argv = resolveArgv(c, session, shadowLog);
    const input = JSON.stringify({ message: ctx.message ?? '', ...(ctx.previous_user_message ? { previous_user_message: ctx.previous_user_message } : {}), session_id: session,
      harness: c.harness, top_k: c.top_k ?? 5, exclude: [], shadow: c.mode === 'shadow' });
    const r = spawnSync(line.argv[0]!, line.argv.slice(1), { input, encoding: 'utf8', timeout: c.timeout_ms ?? 10_000, maxBuffer: 8 << 20,
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: dirname(c.gbrain_home), GBRAIN_HOME: c.gbrain_home, GBRAIN_SKILLS_NO_AUTOREBUILD: '1' } });
    line.exit = r.status;
    if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') { line.code = 'WRAPPER_TIMEOUT'; line.error = 'killed after ' + (c.timeout_ms ?? 10_000) + ' ms'; }
    else if (r.error && (r.error as NodeJS.ErrnoException).code !== 'EPIPE') { line.code = 'SPAWN_FAILED'; line.error = String(r.error.message).slice(0, 300); }
    else if (r.status !== 0) { line.code = 'EXIT_' + (r.status ?? 'SIGNAL'); line.error = String(r.stderr ?? '').trim().slice(0, 300); }
    else {
      try { result = JSON.parse(String(r.stdout)) as Record<string, unknown>; } catch { line.code = 'BAD_JSON'; line.error = String(r.stdout).slice(0, 200); }
      const logged = result && c.mode === 'shadow' ? lastLogLine(shadowLog) : null;
      if (logged) { stdoutResult = result; result = logged; }
      fields = result ? normalizeResult(result, tally[tallyKey] ?? FRESH_SESSION) : null;
      if (result && fields?.schema_version !== 1) { line.code = 'BAD_SCHEMA'; line.error = 'schema_version ' + JSON.stringify(fields?.schema_version); result = null; fields = null; }
    }
    if (fields) {
      const block = fields.block;
      Object.assign(line, {
        timing_ms: fields.timing_ms, index_stale: fields.index_stale, index_hash: fields.index_hash, gbrain_version: fields.gbrain_version, catalog_hash: fields.catalog_hash,
        block_sha256: block ? sha(block) : null, block_bytes: Buffer.byteLength(block, 'utf8'), block_tokens: fields.block_tokens, suggestions: fields.suggestions,
        deduped: fields.deduped, no_skill: fields.no_skill, no_skill_reason: fields.no_skill_reason, budget_exhausted: fields.budget_exhausted,
        session_block_tokens: fields.session_block_tokens, k: fields.k, block_reason: fields.block_reason, budget_phase: fields.budget_phase,
      });
      if (fields.error) { line.code = fields.error_code!; line.error = fields.error_message!.slice(0, 300); }
      else if (line.no_skill) line.code = 'NO_SKILL';
      else if (line.budget_exhausted) line.code = 'BUDGET_EXHAUSTED';
      else if (!block) line.code = 'EMPTY';
      else line.code = 'OK';
      if (line.code === 'OK' && c.mode === 'push') { printed = hookOutput(c.harness, block); line.injected = true; }
      const was = tally[tallyKey] ?? FRESH_SESSION;
      tally[tallyKey] = { spent: fields.session_block_tokens ?? was.spent, exhausted: was.exhausted || fields.budget_phase === 'exhausted' };
      writeFileSync(tallyFile + '.tmp', JSON.stringify(tally));
      renameSync(tallyFile + '.tmp', tallyFile);
    }
    let receipt: ReturnType<typeof normalizeReceipt> | null = null;
    try { receipt = normalizeReceipt(JSON.parse(readFileSync(c.receipt, 'utf8'))); } catch { line.infra_reasons.push('RECEIPT_UNREADABLE'); }
    if (line.code === 'CATALOG_MISMATCH') line.infra_reasons.push('CATALOG_MISMATCH');
    if (line.index_stale === true) line.infra_reasons.push('INDEX_STALE');
    if (receipt && fields) {
      if (line.index_hash !== receipt.index_hash) line.infra_reasons.push('INDEX_HASH_DIFFERS');
      if (line.gbrain_version !== receipt.gbrain_version) line.infra_reasons.push('GBRAIN_VERSION_DIFFERS');
    }
    line.infra = line.infra_reasons.length > 0;
    line.wall_ms = Math.round(performance.now() - t0);
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile + '.tmp', JSON.stringify({ status: line, printed }));
    renameSync(cacheFile + '.tmp', cacheFile);
    return printed;
  } catch (e) {
    line.code = 'WRAPPER_ERROR';
    line.error = String((e as Error).message ?? e).slice(0, 300);
    printed = '';
    return '';
  } finally {
    line.wall_ms = line.wall_ms || Math.round(performance.now() - t0);
    try {
      appendFileSync(join(c.status_dir, 'status.ndjson'), JSON.stringify(line) + '\n');
      if (result && !line.repeat) appendFileSync(join(c.status_dir, 'results.ndjson'), JSON.stringify({ name: line.name, turn: line.turn, session_key: line.session_key, result, ...(stdoutResult ? { stdout_result: stdoutResult } : {}), fields }) + '\n');
    } catch { /* the status dir is gone; nothing else to do */ }
  }
}

if (import.meta.main) {
  let out = '';
  try {
    try { readFileSync(0); } catch { /* no stdin */ }
    out = process.argv[2] ? runHook(process.argv[2]) : '';
  } catch { out = ''; }
  if (out) process.stdout.write(out);
  process.exit(0);
}
