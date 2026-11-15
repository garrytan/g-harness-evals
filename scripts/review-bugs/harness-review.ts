#!/usr/bin/env bun
/**
 * Review sessions on the OpenClaw and Hermes gstack overlays for the real-bug review eval (cells C3 particle-1 in
 * OpenClaw and C4 DeepSeek V4 Pro in Hermes; eval plan, "Arms", "Cells", build step 2).
 * One session is one PR-pass: one unit repo, one arm, one pass, one model, run through harnesses/run-trial.sh on an overlay
 * image, with the metering proxy as the only network the container has.
 *
 *   told     print the told text of an arm on a host, and its sha256
 *   session  run one PR-pass and write <out>/session.json beside run-trial.sh's <out>/trial/
 *   collect  turn a directory of sessions into one arm in gstack-evals' noloss arm contract v1 (lanes/review-noloss/README.md):
 *            arm.json, findings/<unit>.jsonl and cost.tsv from the metering proxy's usage log
 *
 *   bun scripts/review-bugs/harness-review.ts told --arm plain|review --harness openclaw|hermes --base main
 *   bun scripts/review-bugs/harness-review.ts session --harness openclaw --arm review --unit owner/repo#12@abc1234 \
 *     --unit-repo <dir> --base main --pass 1 --image harness-eval/openclaw:gstack-4bee369d --model particle-1 \
 *     --base-url http://host.docker.internal:8787/<slot>/particle --api-key "$cred" --out <dir> \
 *     [--trial-id <slot>] [--time-budget 3600] [--network <internal net> --host-gateway <gateway ip>] [--pr-context <dir>] [--dry-run]
 *   bun scripts/review-bugs/harness-review.ts collect --sessions <dir> --out <arm dir> --id <arm id> --label <text> \
 *     --suite <suite id> --usage-log <proxy usage ndjson> [--usage-log ...] [--suite-sha256 <hex>] [--date YYYY-MM-DD]
 *
 * The session:
 * - The work dir is the unit repo. Its tree is copied as it is (history included) into the trial's /workspace, and the told
 *   text is the instruction.md the counted adapters read from there; /instruction.md is added to .git/info/exclude so git
 *   status stays clean and git diff <base>...HEAD shows the PR's changes only. The repo must have the base branch, a HEAD that
 *   is not the base, and a clean tree.
 * - The image decides the arm. plain needs an overlay built with GSTACK_COMMIT=none (label org.harness-eval.gstack.commit
 *   none: no gstack in the image, the wrapper logs "gstack: none"); review needs one built at a 40-character gstack commit.
 *   Both need the start hook off (label org.harness-eval.gstack.start_hook off): gstack ships the hook off on both hosts
 *   (lib/harness-start-hook.ts: "Off unless the user asks"), so the -hook images are not as shipped and are refused here.
 *   The overlay label must name the session's harness.
 * - run-trial.sh runs with a scrubbed environment (PATH and HOME only). With --network the container joins that docker
 *   network (create it internal, as runner/trial/docker.ts ensureInternalNetwork does, and start the proxy on its gateway), so
 *   the proxy is the only address it can reach.
 * - Findings: the final assistant text of the main session, read from the harness's own transcript by
 *   scripts/gsta-135/evidence.ts (OpenClaw's session store, Hermes's state.db), parsed by the gstack-evals rig's parser
 *   (rig-findings.ts): findings, empty, missing, malformed, or incomplete when the run did not exit 0 or the transcript is
 *   not complete. Malformed and incomplete are coverage gaps; collect marks the arm stopped.
 * - Read audit: evidence.ts's classified tool calls (skill_open, helper_run, gstack_path). A plain session is clean only when
 *   all three are zero and gstack-register.log carries the wrapper's "gstack: none" line (CREW.md, "Clean no-gstack arms").
 * - session.json never holds the token; the base URL is kept with its slot.
 * - --pr-context <dir>: the session is told the PR's title and first description, as the Claude Code cells are with
 *   gstack-evals review-units --pr-context. It reads <dir>/<unit id with / # and @ as _>/pr.md (build-unit.ts's layout) and
 *   tells TOLD_PR_TEMPLATE (told.ts); session.json's told block records the template's sha256 and the pr.md's sha256. A
 *   missing or unshowable pr.md refuses the session before anything runs.
 * - collect checks that every session shares one told line apart from its per-unit parts (base, PR text and the filled
 *   text's sha256), so a run whose units differ in base branch or PR text collects as one arm.
 *
 * Exit codes: 0 the session ran (whatever its outcome) or the command finished; 2 a refusal before any model request (bad
 * unit repo, wrong image for the arm, a session dir that is not empty); 64 usage.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extract } from '../gsta-135/evidence.ts';
import { parseFinalTurn, renderFindings, outcomeLabel, PARSER_SHA256, UPSTREAM_PARSER_SHA256, type ParseOutcome } from './rig-findings.ts';
import { prTextProblem, REVIEW_ARMS, REVIEW_HARNESSES, sha256, toldRecord, toldText, type ReviewArm, type ReviewHarness } from './told.ts';

const ROOT = resolve(import.meta.dir, '../..');
export const SESSION_SCHEMA = 1;

export class ReviewError extends Error {
  constructor(public code: 'E_REVIEW_UNIT' | 'E_REVIEW_IMAGE' | 'E_REVIEW_OUT' | 'E_REVIEW_USAGE' | 'E_REVIEW_SESSION' | 'E_REVIEW_PR', message: string) { super(code + ' ' + message); }
}

const git = (dir: string, ...args: string[]) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' } });
const gitOut = (dir: string, ...args: string[]) => { const r = git(dir, ...args); return r.status === 0 ? r.stdout.trim() : null; };

/** The unit repo's facts, or a refusal: base branch present, HEAD off it, a clean tree. */
export function checkUnitRepo(dir: string, base: string) {
  if (!existsSync(join(dir, '.git'))) throw new ReviewError('E_REVIEW_UNIT', dir + ' is not a git work tree (no .git)');
  const head = gitOut(dir, 'rev-parse', 'HEAD');
  const baseSha = gitOut(dir, 'rev-parse', '--verify', 'refs/heads/' + base);
  if (!head) throw new ReviewError('E_REVIEW_UNIT', dir + ' has no HEAD commit');
  if (!baseSha) throw new ReviewError('E_REVIEW_UNIT', dir + ' has no local branch ' + base + ' (the told text names it as the base)');
  if (head === baseSha) throw new ReviewError('E_REVIEW_UNIT', dir + ': HEAD is the base branch ' + base + ', so there is no diff to review');
  const status = gitOut(dir, 'status', '--porcelain', '--untracked-files=all');
  if (status === null || status !== '') throw new ReviewError('E_REVIEW_UNIT', dir + ' has a dirty or unreadable work tree (git status --porcelain: ' + (status ?? 'failed').slice(0, 200) + ')');
  const mergeBase = gitOut(dir, 'merge-base', 'HEAD', base);
  const diffStat = gitOut(dir, 'diff', '--shortstat', base + '...HEAD');
  return { head, base, base_sha: baseSha, merge_base: mergeBase, branch: gitOut(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), diff_shortstat: diffStat };
}

export interface ImageLabels { commit: string | null; start_hook: string | null; overlay: string | null; ref: string | null; id: string | null }

export function imageLabels(image: string): ImageLabels {
  const fmt = '{{.Id}}|{{index .Config.Labels "org.harness-eval.gstack.commit"}}|{{index .Config.Labels "org.harness-eval.gstack.start_hook"}}|{{index .Config.Labels "org.harness-eval.gstack.overlay"}}|{{index .Config.Labels "org.harness-eval.gstack.ref"}}';
  const r = spawnSync('docker', ['image', 'inspect', '--format', fmt, image], { encoding: 'utf8' });
  if (r.status !== 0) throw new ReviewError('E_REVIEW_IMAGE', 'docker image inspect ' + image + ' failed: ' + (r.stderr || r.stdout).trim().slice(0, 200));
  const [id, commit, hook, overlay, ref] = r.stdout.trim().split('|').map((s) => (s && s !== '<no value>' ? s : null));
  return { id: id ?? null, commit: commit ?? null, start_hook: hook ?? null, overlay: overlay ?? null, ref: ref ?? null };
}

/** Why an image cannot run an arm on a harness, or null. */
export function imageRefusal(labels: ImageLabels, arm: ReviewArm, harness: ReviewHarness): string | null {
  if (labels.overlay !== harness) return 'the image is the ' + (labels.overlay ?? 'unlabelled') + ' overlay, not the ' + harness + ' gstack overlay (label org.harness-eval.gstack.overlay)';
  if (labels.start_hook !== 'off') return 'the image has start_hook ' + (labels.start_hook ?? 'unlabelled') + '; gstack ships its start hook off, so only an image built with GSTACK_START_HOOK=off is as shipped';
  if (arm === 'plain' && labels.commit !== 'none') return 'the plain arm needs the no-gstack overlay (GSTACK_COMMIT=none), and this image carries gstack ' + (labels.commit ?? 'unlabelled');
  if (arm === 'review' && !/^[0-9a-f]{40}$/.test(labels.commit ?? '')) return 'the review arm needs an overlay built at a 40-character gstack commit, and this image says ' + (labels.commit ?? 'unlabelled');
  return null;
}

export interface SessionOptions {
  harness: ReviewHarness; arm: ReviewArm; unit: string; unitRepo: string; base: string; pass: number; image: string; model: string;
  baseUrl: string; apiKey: string; out: string; trialId: string; timeBudget: number; network: string | null; hostGateway: string | null;
  prContext?: string | null;
}

/** The unit's pr.md under a --pr-context dir, as build-unit.ts lays it out, or a refusal. */
export function readPrText(dir: string, unit: string): string {
  const file = join(dir, unit.replace(/[/#@]/g, '_'), 'pr.md');
  if (!existsSync(file)) throw new ReviewError('E_REVIEW_PR', 'no pr.md for ' + unit + ' at ' + file);
  const text = readFileSync(file, 'utf8');
  const problem = prTextProblem(text);
  if (problem) throw new ReviewError('E_REVIEW_PR', file + ' cannot be shown: ' + problem);
  return text;
}

/** The task directory run-trial.sh copies: the told text as instruction.md, the unit repo as workspace/, a grader that
 *  always passes (a review session is scored by the judges, never by run-trial.sh's grade). */
export function prepareTask(o: SessionOptions, taskDir: string): string {
  const text = toldText(o.arm, o.harness, o.base, o.prContext ? readPrText(o.prContext, o.unit) : undefined);
  mkdirSync(join(taskDir, 'grader'), { recursive: true });
  writeFileSync(join(taskDir, 'instruction.md'), text);
  writeFileSync(join(taskDir, 'task.toml'), 'id = "review-' + o.trialId + '"\nslice = "review-bugs"\ntime_budget_s = ' + o.timeBudget + '\n');
  writeFileSync(join(taskDir, 'grader', 'check.sh'), '#!/bin/sh\n# A review session has no world grade: the judges score its findings.\nexit 0\n', { mode: 0o755 });
  cpSync(o.unitRepo, join(taskDir, 'workspace'), { recursive: true, verbatimSymlinks: true });
  const exclude = join(taskDir, 'workspace', '.git', 'info', 'exclude');
  mkdirSync(join(taskDir, 'workspace', '.git', 'info'), { recursive: true });
  appendFileSync(exclude, (existsSync(exclude) && !readFileSync(exclude, 'utf8').endsWith('\n') && readFileSync(exclude, 'utf8') ? '\n' : '') + '/instruction.md\n');
  writeFileSync(join(taskDir, 'workspace', 'instruction.md'), text);
  const status = gitOut(join(taskDir, 'workspace'), 'status', '--porcelain', '--untracked-files=all');
  if (status !== '') throw new ReviewError('E_REVIEW_UNIT', 'the copied work tree is not clean with instruction.md in place (' + (status ?? 'git failed').slice(0, 200) + ')');
  rmSync(join(taskDir, 'workspace', 'instruction.md'));
  return text;
}

/** The read audit of one session: the tool calls evidence.ts classifies, and the wrapper's gstack line. */
export function readAudit(trialOut: string, ev: ReturnType<typeof extract>, arm: ReviewArm) {
  const count = (k: string) => ev.events.filter((e) => e.kind === k).length;
  const reg = join(trialOut, 'logs', 'gstack-register.log');
  const regText = existsSync(reg) ? readFileSync(reg, 'utf8') : '';
  const gstackNone = /gstack: none \(no \S+ in this image/.test(regText);
  const audit = { skill_open: count('skill_open'), helper_run: count('helper_run'), gstack_path: count('gstack_path'), wrapper_gstack_none: gstackNone, transcript: ev.transcript, paths: ev.events.slice(0, 20).map((e) => ({ kind: e.kind, tool: e.tool, detail: e.detail.slice(0, 200), locator: e.locator })) };
  const clean = audit.skill_open === 0 && audit.helper_run === 0 && audit.gstack_path === 0 && gstackNone;
  return { ...audit, verdict: arm === 'plain' ? (ev.transcript === 'missing' || ev.transcript === 'unobservable' ? 'unobservable' : clean ? 'clean' : 'contaminated') : 'not-applicable' };
}

const TERMINATION: Record<number, string> = { 0: 'completed', 124: 'timeout', 3: 'model_error', 2: 'harness_error' };

/** The parse of one finished session: incomplete unless run-trial.sh exited 0 and the transcript is complete. */
export function parseSession(exitCode: number, ev: { transcript: string; final_text: string | null }): ParseOutcome {
  if (exitCode !== 0) return { kind: 'incomplete', reason: 'the session ended ' + (TERMINATION[exitCode] ?? 'infra_error') + ' (exit ' + exitCode + ')' };
  if (ev.transcript !== 'complete') return { kind: 'incomplete', reason: 'the transcript is ' + ev.transcript };
  if (ev.final_text === null) return { kind: 'incomplete', reason: 'the session completed with no assistant text' };
  return parseFinalTurn(ev.final_text);
}

export function runSession(o: SessionOptions, dryRun = false) {
  const unit = checkUnitRepo(o.unitRepo, o.base);
  const labels = imageLabels(o.image);
  const refusal = imageRefusal(labels, o.arm, o.harness);
  if (refusal) throw new ReviewError('E_REVIEW_IMAGE', o.image + ': ' + refusal);
  if (existsSync(o.out) && readdirSync(o.out).length) throw new ReviewError('E_REVIEW_OUT', o.out + ' is not empty; one session per directory, never reused');
  const taskDir = join(o.out, 'task');
  const trialOut = join(o.out, 'trial');
  const text = prepareTask(o, taskDir);
  const args = ['harnesses/run-trial.sh', '--harness', o.harness, '--image', o.image, '--task', taskDir, '--trial-id', o.trialId, '--out', trialOut,
    '--base-url', o.baseUrl, '--api-key', o.apiKey, '--model', o.model, '--time-budget', String(o.timeBudget),
    ...(o.network ? ['--network', o.network] : []), ...(o.hostGateway ? ['--host-gateway', o.hostGateway] : [])];
  const base = { schema_version: SESSION_SCHEMA, harness: o.harness, arm: o.arm, unit: o.unit, pass: o.pass, trial_id: o.trialId, model: o.model,
    base_url: o.baseUrl, image: o.image, image_labels: labels, network: o.network, unit_repo: unit,
    told: { ...toldRecord(o.arm, o.harness, !!o.prContext), text_sha256: sha256(text), base: o.base, ...(o.prContext ? { pr_sha256: sha256(readPrText(o.prContext, o.unit)) } : {}) }, parser_sha256: PARSER_SHA256, upstream_parser_sha256: UPSTREAM_PARSER_SHA256 };
  if (dryRun) {
    const plan = { ...base, dry_run: true, command: args.map((a) => (a === o.apiKey ? '<token>' : a)) };
    writeFileSync(join(o.out, 'session.json'), JSON.stringify(plan, null, 2) + '\n');
    return plan;
  }
  const started = Date.now();
  const r = spawnSync('bash', args, { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' }, timeout: (o.timeBudget + 600) * 1000 });
  const wallMs = Date.now() - started;
  writeFileSync(join(o.out, 'run-trial.log'), (r.stdout ?? '') + (r.stderr ?? ''));
  let exitCode = -1;
  try { exitCode = JSON.parse(readFileSync(join(trialOut, 'result.json'), 'utf8')).exit_code; } catch { exitCode = r.status === 0 ? -1 : (r.status ?? -1); }
  const ev = extract(o.harness, trialOut, null);
  const parse = parseSession(exitCode, ev);
  const findings = parse.kind === 'findings' ? renderFindings(parse.findings, o.pass, '/workspace') : [];
  const record = { ...base, exit_code: exitCode, termination: TERMINATION[exitCode] ?? 'infra_error', wall_ms: wallMs,
    transcript: { state: ev.transcript, files: ev.files, note: ev.note ?? null, termination_hint: ev.termination_hint },
    parse: { outcome: outcomeLabel(parse), ...('reason' in parse ? { reason: parse.reason } : {}), findings: findings.length },
    findings, read_audit: readAudit(trialOut, ev, o.arm) };
  writeFileSync(join(o.out, 'session.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}

// ---- collect --------------------------------------------------------------------------------------------------------

export const COST_COLUMNS = ['pr', 'scope', 'pass', 'total_tokens', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'usd', 'wall_seconds', 'meter_source', 'requests', 'refused', 'unknown_calls'] as const;

/** One PR-pass's meter from the proxy's usage lines: every line whose key is the session's slot key. A forwarded line with a
 *  settled actual_usd and no usage_unknown is known; a failed line, or one charged at its reservation, makes the row's usd and
 *  tokens unavailable, never a guess. The proxy's input_tokens counts cache reads and writes; the row's input_tokens is the
 *  uncached rest, so total_tokens is input + output + cache_read + cache_write, as gstack-evals cost.ts writes it. */
export function meterRow(lines: readonly Record<string, any>[], key: string) {
  const u = { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, usd: 0, requests: 0, refused: 0, unknown: 0 };
  for (const l of lines) {
    if (l.key !== key) continue;
    if (l.outcome === 'refused') { u.refused++; continue; }
    u.requests++;
    if (l.outcome !== 'forwarded' || typeof l.actual_usd !== 'number' || l.usage_unknown || l.charged_reservation) { u.unknown++; continue; }
    const read = l.cached_tokens ?? 0, write = l.cache_write_tokens ?? 0;
    u.input += Math.max(0, (l.input_tokens ?? 0) - read - write);
    u.output += l.output_tokens ?? 0;
    u.cache_read += read;
    u.cache_write += write;
    u.reasoning += l.reasoning_tokens ?? 0;
    u.usd += l.actual_usd;
  }
  return u;
}

export function readUsage(paths: readonly string[]): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  for (const p of paths) for (const t of readFileSync(p, 'utf8').split('\n')) { if (!t.trim()) continue; try { out.push(JSON.parse(t)); } catch { /* a torn line is skipped */ } }
  return out;
}

export const unitFile = (unit: string) => unit.replaceAll('/', '__') + '.jsonl';

export interface CollectOptions { sessions: string; out: string; id: string; label: string; suite: string; usageLogs: string[]; suiteSha256: string | null; date: string; meterKey: (s: any) => string; source?: { repo: string; sha: string } }

export function collect(o: CollectOptions) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(o.id)) throw new ReviewError('E_REVIEW_USAGE', 'arm id ' + JSON.stringify(o.id) + ' must match ^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$ (arm contract v1)');
  const sessions = readdirSync(o.sessions).map((d) => join(o.sessions, d, 'session.json')).filter((p) => existsSync(p)).map((p) => JSON.parse(readFileSync(p, 'utf8')));
  const real = sessions.filter((s) => !s.dry_run);
  if (!real.length) throw new ReviewError('E_REVIEW_SESSION', 'no finished session.json under ' + o.sessions);
  const one = (f: string) => { const v = [...new Set(real.map((s) => JSON.stringify(s[f])))]; if (v.length > 1) throw new ReviewError('E_REVIEW_SESSION', 'sessions under ' + o.sessions + ' mix ' + f + ' values ' + v.join(', ') + '; one arm is one harness, arm, model and image'); return JSON.parse(v[0]!); };
  const harness = one('harness'), arm = one('arm'), model = one('model'), image = one('image');
  [...new Set(real.map((s) => { const { text_sha256: _t, base: _b, pr_sha256: _p, ...arm } = s.told ?? {}; return JSON.stringify(arm); }))].length > 1
    && (() => { throw new ReviewError('E_REVIEW_SESSION', 'sessions under ' + o.sessions + ' mix told lines beyond their base and PR text; one arm is one told line'); })();
  const usage = readUsage(o.usageLogs);
  const byUnit = new Map<string, any[]>();
  for (const s of real) byUnit.set(s.unit, [...(byUnit.get(s.unit) ?? []), s]);
  const passes = Math.max(...real.map((s) => s.pass));
  mkdirSync(join(o.out, 'findings'), { recursive: true });
  const gaps: string[] = [];
  const counts: Record<string, number> = { findings: 0, empty: 0, missing: 0, malformed: 0, incomplete: 0 };
  const audit: Record<string, number> = {};
  const cost = [COST_COLUMNS.join('\t')];
  for (const [unit, list] of [...byUnit].sort(([a], [b]) => (a < b ? -1 : 1))) {
    list.sort((a, b) => a.pass - b.pass);
    const seen = new Set<number>();
    for (const s of list) { if (seen.has(s.pass)) throw new ReviewError('E_REVIEW_SESSION', unit + ' pass ' + s.pass + ' appears twice'); seen.add(s.pass); }
    for (let p = 1; p <= passes; p++) if (!seen.has(p)) gaps.push(unit + ' pass ' + p + ': not run');
    writeFileSync(join(o.out, 'findings', unitFile(unit)), list.flatMap((s) => s.findings).map((f: unknown) => JSON.stringify(f) + '\n').join(''));
    for (const s of list) {
      counts[s.parse.outcome] = (counts[s.parse.outcome] ?? 0) + 1;
      if (s.parse.outcome === 'malformed' || s.parse.outcome === 'incomplete') gaps.push(unit + ' pass ' + s.pass + ': ' + s.parse.outcome + (s.parse.reason ? ' (' + s.parse.reason + ')' : ''));
      audit[s.read_audit.verdict] = (audit[s.read_audit.verdict] ?? 0) + 1;
      const m = meterRow(usage, o.meterKey(s));
      const known = m.unknown === 0 && m.requests > 0;
      const n = (x: number) => (known ? String(x) : 'unavailable');
      cost.push([unit, 'all', String(s.pass), n(m.input + m.output + m.cache_read + m.cache_write), n(m.input), n(m.output), n(m.cache_read), n(m.cache_write), n(m.reasoning), known ? m.usd.toFixed(6) : 'unavailable', String(Math.round(s.wall_ms / 100) / 10), 'proxy-journal', String(m.requests), String(m.refused), String(m.unknown)].join('\t'));
    }
  }
  const armJson = {
    contract_version: 1, id: o.id, label: o.label, suite: o.suite, ...(o.suiteSha256 ? { suite_sha256: o.suiteSha256 } : {}), date: o.date, passes, kind: arm === 'plain' ? 'reference' : 'variant', provenance: 'live',
    status: gaps.length ? 'stopped' : 'complete', ...(gaps.length ? { coverage_gaps: gaps } : {}), models: [{ role: 'driver', model }],
    run_by: 'harness-evals scripts/review-bugs/harness-review.ts', ...(o.source ? { source: o.source } : {}),
    arm_provenance: { harness, image, image_labels: real[0].image_labels, told: real[0].told, parser_sha256: real[0].parser_sha256, upstream_parser_sha256: real[0].upstream_parser_sha256 },
    parse_outcomes: counts, read_audit: audit,
    notes: arm === 'plain' ? 'plain arm on the no-gstack overlay; read_audit counts sessions by verdict (clean, contaminated, unobservable)' : 'gstack /review on the ' + harness + ' host; exposure is read by scripts/review-bugs/exposure.ts',
  };
  writeFileSync(join(o.out, 'arm.json'), JSON.stringify(armJson, null, 2) + '\n');
  writeFileSync(join(o.out, 'cost.tsv'), cost.join('\n') + '\n');
  return armJson;
}

// ---- CLI ------------------------------------------------------------------------------------------------------------

function parseFlags(argv: string[]) {
  const flags = new Map<string, string[]>();
  const bools = new Set(['--dry-run']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) throw new ReviewError('E_REVIEW_USAGE', 'unexpected argument ' + a);
    if (bools.has(a)) { flags.set(a, ['1']); continue; }
    const v = argv[++i];
    if (v === undefined) throw new ReviewError('E_REVIEW_USAGE', a + ' needs a value');
    flags.set(a, [...(flags.get(a) ?? []), v]);
  }
  const one = (k: string, fallback?: string) => { const v = flags.get(k)?.at(-1) ?? fallback; if (v === undefined) throw new ReviewError('E_REVIEW_USAGE', 'missing ' + k); return v; };
  return { flags, one, many: (k: string) => flags.get(k) ?? [], has: (k: string) => flags.has(k) };
}

const pick = <T extends string>(v: string, allowed: readonly T[], what: string): T => { if (!allowed.includes(v as T)) throw new ReviewError('E_REVIEW_USAGE', what + ' must be one of ' + allowed.join(', ') + ', not ' + v); return v as T; };

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    const f = parseFlags(rest);
    if (cmd === 'told') {
      const text = toldText(pick(f.one('--arm'), REVIEW_ARMS, '--arm'), pick(f.one('--harness'), REVIEW_HARNESSES, '--harness'), f.one('--base'));
      console.log(text);
      console.error('sha256 ' + sha256(text));
    } else if (cmd === 'session') {
      const pass = Number(f.one('--pass'));
      const budget = Number(f.one('--time-budget', '3600'));
      if (!Number.isInteger(pass) || pass < 1) throw new ReviewError('E_REVIEW_USAGE', '--pass must be a whole number from 1');
      if (!Number.isInteger(budget) || budget < 60) throw new ReviewError('E_REVIEW_USAGE', '--time-budget must be whole seconds, at least 60');
      const out = resolve(f.one('--out'));
      const trialId = f.one('--trial-id', out.split('/').at(-1)!);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trialId)) throw new ReviewError('E_REVIEW_USAGE', '--trial-id must be letters, digits, . _ -');
      mkdirSync(out, { recursive: true });
      const rec = runSession({ harness: pick(f.one('--harness'), REVIEW_HARNESSES, '--harness'), arm: pick(f.one('--arm'), REVIEW_ARMS, '--arm'), unit: f.one('--unit'), unitRepo: resolve(f.one('--unit-repo')),
        base: f.one('--base'), pass, image: f.one('--image'), model: f.one('--model'), baseUrl: f.one('--base-url'), apiKey: f.one('--api-key'), out, trialId, timeBudget: budget,
        network: f.flags.get('--network')?.at(-1) ?? null, hostGateway: f.flags.get('--host-gateway')?.at(-1) ?? null, prContext: f.flags.get('--pr-context')?.at(-1) ? resolve(f.flags.get('--pr-context')!.at(-1)!) : null }, f.has('--dry-run'));
      const r = rec as any;
      console.log(JSON.stringify({ session: join(out, 'session.json'), exit_code: r.exit_code ?? null, parse: r.parse ?? null, read_audit: r.read_audit?.verdict ?? null, dry_run: r.dry_run ?? false }));
    } else if (cmd === 'collect') {
      const date = f.one('--date', new Date().toISOString().slice(0, 10));
      const arm = collect({ sessions: resolve(f.one('--sessions')), out: resolve(f.one('--out')), id: f.one('--id'), label: f.one('--label'), suite: f.one('--suite'), usageLogs: f.many('--usage-log'),
        suiteSha256: f.flags.get('--suite-sha256')?.at(-1) ?? null, date, meterKey: (s) => 'trial-token:' + s.trial_id,
        source: { repo: 'garrytan/harness-evals', sha: spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim() } });
      console.log(JSON.stringify({ arm: arm.id, status: arm.status, parse_outcomes: arm.parse_outcomes, read_audit: arm.read_audit, coverage_gaps: (arm as any).coverage_gaps?.length ?? 0 }));
    } else {
      throw new ReviewError('E_REVIEW_USAGE', 'usage: harness-review.ts told|session|collect ... (see the file head)');
    }
  } catch (e) {
    if (e instanceof ReviewError) { console.error(e.message); process.exit(e.code === 'E_REVIEW_USAGE' ? 64 : 2); }
    throw e;
  }
}
