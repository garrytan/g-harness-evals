#!/usr/bin/env bun
// Keyless capture checks of the skill-resolver arms (internal-task, scripts/skill-resolver/ARMS.md), run the way Step 0 ran its
// listing probes: one real trial per harness and arm through the runner in capture mode (scripts/anatomy/capture.ts), the metering
// proxy with the capture dummy keys and the repository's fake model endpoints. No key, no provider, no spend.
//
//   bun scripts/skill-resolver/arm-captures.ts --kit <kit dir> [--out <dir>] [--cell <harness>:<arm>]... [--build] [--check-only]
//       [--usage-order <file>] [--budget-replay]
//
// --build builds harness-eval/<h>:skills-kit (harness-eval/<h>:dev plus the kit at /opt/skill-resolver), its fail-open variant
// harness-eval/<h>:skills-kit-failopen (the index file index.bin removed, receipt kept, so every resolve fails open with INDEX_MISSING) and, for OpenClaw,
// harness-eval/openclaw:skills-kit-usage (a kit built by build-kit.ts --usage-order into <out>/kit-usage, so kit.json records the
// list's sha256; without --usage-order, a test list: the catalog in reverse name order), and harness-eval/<h>:skills-kit-budget (the stand-in's budget switch file stub-budget-exhausted in each gbrain-home,
// so every resolve answers as a session whose block budget is spent; the real gbrain has no such switch). Arms: native, resolver,
// failopen (the resolver arm on the fail-open image), budget (the resolver arm on the budget image), names-only, no-catalog,
// usage-ordered.
// Each capture replaces <out>/<harness>-<arm>/ (default ~/.capy/work/internal-task/arm-captures); --check-only rechecks existing ones.
// The checks (checkCapture) are:
//   resolver       every turn's status line is not INFRA; at least one turn is OK and injected, and each injected block's exact
//                  bytes are in a captured request
//   native         at least one turn logs a shadow result with suggestions; no captured request carries any of those blocks
//   failopen       every turn logs an error code (INDEX_MISSING) and injects nothing; no captured request carries a block header
//   budget         every turn logs BUDGET_EXHAUSTED (budget_exhausted true, budget_phase exhausted), is not INFRA and injects
//                  nothing; no captured request carries a block header. When the kit's gbrain is not the stand-in (kit.json
//                  gbrain.stand_in false), or with --budget-replay, the budget cell is instead the long-transcript replay of
//                  shadow-replay-check.ts --until-exhausted with the kit's bin/gbrain for that harness: no capture, no image
// Every resolver turn's status line (resolver, native, failopen, budget) also carries no_skill_reason, budget_exhausted, k,
// block_reason and budget_phase.
//   names-only     the first request lists as many catalog skills as Step 0 counted for the names-only config
//   no-catalog     the first request lists no catalog skill, and as many harness skills as Step 0 counted with bundled skills off
//   usage-ordered  every listed catalog skill is in the top list
// Writes <out>/summary.json and exits 1 when any check fails.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { normalizeResult } from './result-fields.ts';
import { shadowReplay } from './shadow-replay-check.ts';
import { buildKit } from './build-kit.ts';

export const ARMS = ['native', 'resolver', 'failopen', 'budget', 'names-only', 'no-catalog', 'usage-ordered'] as const;
export type Arm = (typeof ARMS)[number];
export type H = 'openclaw' | 'claude-code' | 'codex' | 'hermes';
export const PROVIDER: Record<H, { provider: string; model: string }> = {
  openclaw: { provider: 'anthropic', model: 'claude-opus-5-5' }, 'claude-code': { provider: 'anthropic', model: 'claude-opus-5-5' },
  codex: { provider: 'openai', model: 'gpt-6.1-sol' }, hermes: { provider: 'anthropic', model: 'claude-opus-5-5' },
};
/** Step 0's counts (handoffs/internal-task/step0): catalog skills listed in names-only; harness skills listed with bundled skills off. */
export const STEP0 = {
  namesOnlyCatalog: { openclaw: 313, 'claude-code': 349, codex: 351, hermes: 342 } as Record<H, number>,
  noBundledHarness: { openclaw: 1, 'claude-code': 1, codex: 0, hermes: 1 } as Record<H, number>,
};
/** Harness skills the no-catalog arm lists: Step 0's no-bundled count, plus on OpenClaw its own canvas skill, which Step 0 never saw
 *  listed because the catalog's canvas shadows it by name (workspace skills win). */
export const NO_CATALOG_HARNESS: Record<H, number> = { ...STEP0.noBundledHarness, openclaw: STEP0.noBundledHarness.openclaw + 1 };
export const BLOCK_HEADER = 'Skills that may fit this request (gbrain skills resolve):';
const ROOT = resolve(import.meta.dir, '../..');

const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
};

export type Listing = { catalog: string[]; harness: string[] };

/** The skills the first model request lists, split into catalog skills (from the catalog's own root) and the harness's own. */
export function listing(h: H, body: unknown, catalog: Set<string>): Listing {
  const all = strings(body);
  const out: Listing = { catalog: [], harness: [] };
  const put = (name: string, fromCatalog: boolean) => (fromCatalog && catalog.has(name) ? out.catalog : out.harness).push(name);
  if (h === 'openclaw') {
    const s = all.find((x) => x.includes('<available_skills>'));
    const region = s ? s.slice(s.indexOf('<available_skills>'), s.indexOf('</available_skills>')) : '';
    for (const m of region.matchAll(/<skill>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<location>([^<]*)<\/location>[\s\S]*?<\/skill>/g)) put(m[1]!.trim(), m[2]!.startsWith('/workspace/skills/'));
  } else if (h === 'hermes') {
    const s = all.find((x) => x.includes('<available_skills>'));
    const region = s ? s.slice(s.indexOf('<available_skills>'), s.indexOf('</available_skills>')) : '';
    let category = '';
    for (const line of region.split('\n')) {
      const c = /^ {0,3}(\S[^:]*):\s*$/.exec(line);
      if (c) { category = c[1]!.trim(); continue; }
      const m = /^\s+- ([^:\s]+)(?::|$)/.exec(line);
      if (m) put(m[1]!, m[1] === category);
    }
  } else if (h === 'claude-code') {
    const marker = 'The following skills are available for use with the Skill tool:';
    const s = all.find((x) => x.includes(marker));
    if (s) {
      const lines = s.slice(s.indexOf(marker) + marker.length).split('\n').map((l) => l.trimEnd());
      let started = false;
      for (const l of lines) {
        if (!l.trim() && !started) continue;
        if (!l.startsWith('- ')) { if (started) break; continue; }
        started = true;
        put(l.slice(2).split(':')[0]!.trim(), true);
      }
    }
  } else {
    const s = all.find((x) => x.includes('<skills_instructions>'));
    const region = s ? s.slice(s.indexOf('<skills_instructions>'), s.indexOf('</skills_instructions>')) : '';
    const roots = new Map([...region.matchAll(/(r\d+)\S*\s*[=:|]\s*\S*?(\/[^\s|]+)/g)].map((m) => [m[1]!, m[2]!]));
    for (const m of region.matchAll(/^- ([^:\n]+): .*\(file: (r\d+)\/[^)]*\)\s*$/gm)) put(m[1]!.trim(), !(roots.get(m[2]!) ?? '').includes('.system'));
  }
  return out;
}

export type Capture = { requests: unknown[]; status: Record<string, unknown>[]; results: { name: string; result: unknown }[]; arm: Record<string, unknown> | null; trialDir: string | null };

export function loadCapture(dir: string): Capture {
  const requests = existsSync(join(dir, 'fake.ndjson')) ? readFileSync(join(dir, 'fake.ndjson'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as { method?: string; body?: unknown })
    .filter((r) => r.method === 'POST' && r.body && typeof r.body === 'object').map((r) => r.body) : [];
  let trialDir: string | null = null;
  const walk = (d: string, depth: number) => {
    if (trialDir || depth > 6 || !existsSync(d)) return;
    if (existsSync(join(d, 'logs', 'ready'))) { trialDir = d; return; }
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && e.name !== 'state' && e.name !== 'workspace') walk(join(d, e.name), depth + 1);
  };
  walk(join(dir, 'run', 'trials'), 0);
  const nd = (p: string) => existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
  const logs = trialDir ? join(trialDir, 'logs') : '';
  return {
    requests, trialDir,
    status: trialDir ? nd(join(logs, 'skill-resolver', 'status.ndjson')) : [],
    results: trialDir ? nd(join(logs, 'skill-resolver', 'results.ndjson')) : [],
    arm: trialDir && existsSync(join(logs, 'skill-arm.json')) ? JSON.parse(readFileSync(join(logs, 'skill-arm.json'), 'utf8')) : null,
  };
}

export type Check = { harness: H; arm: Arm; ok: boolean; facts: Record<string, unknown>; problems: string[] };

export function checkCapture(h: H, arm: Arm, c: Capture, catalog: Set<string>, usageOrder?: string[]): Check {
  const problems: string[] = [], facts: Record<string, unknown> = { requests: c.requests.length, turns_logged: c.status.length };
  if (!c.requests.length) problems.push('no captured model request');
  if (c.arm?.status !== 'ok') problems.push('skill-arm.json is not ok: ' + JSON.stringify(c.arm?.error ?? c.arm));
  const reqStrings = c.requests.map((b) => strings(b));
  const inRequests = (block: string) => reqStrings.filter((ss) => ss.some((s) => s.includes(block))).length;
  const turns = c.status.filter((s) => !s.repeat);
  facts.codes = turns.map((s) => s.code);
  if (arm === 'resolver' || arm === 'native' || arm === 'failopen' || arm === 'budget') {
    if (!turns.length) problems.push('no per-turn status line');
    if (turns.some((s) => s.infra) && arm !== 'failopen') problems.push('INFRA turn: ' + turns.filter((s) => s.infra).map((s) => s.name + ' ' + (s.infra_reasons as string[]).join(',')).join('; '));
    for (const s of turns) for (const k of ['code', 'timing_ms', 'index_stale', 'index_hash', 'gbrain_version', 'catalog_hash', 'block_sha256', 'block_tokens', 'suggestions', 'no_skill_reason', 'budget_exhausted', 'k', 'block_reason', 'budget_phase']) if (!(k in s)) problems.push('status line lacks ' + k);
  }
  const blocks = c.results.map((r) => ({ name: r.name, block: normalizeResult(r.result).block })).filter((b) => b.block);
  if (arm === 'resolver') {
    const injected = turns.filter((s) => s.code === 'OK' && s.injected);
    facts.injected_turns = injected.length;
    if (!injected.length) problems.push('no turn injected a block');
    facts.block_carried = blocks.map((b) => ({ name: b.name, requests_carrying: inRequests(b.block) }));
    for (const b of blocks) if (!inRequests(b.block)) problems.push(b.name + ': the block is in no captured request');
  }
  if (arm === 'native') {
    const shadow = turns.filter((s) => s.mode === 'shadow' && s.code === 'OK' && (s.suggestions as string[]).length);
    facts.shadow_turns_with_suggestions = shadow.length;
    if (!shadow.length) problems.push('no shadow result with suggestions was logged');
    if (turns.some((s) => s.injected)) problems.push('a shadow turn was marked injected');
    facts.block_carried = blocks.map((b) => ({ name: b.name, requests_carrying: inRequests(b.block) }));
    for (const b of blocks) if (inRequests(b.block)) problems.push(b.name + ': the shadow block reached a request');
    if (inRequests(BLOCK_HEADER)) problems.push('a request carries the block header');
  }
  if (arm === 'failopen') {
    if (turns.some((s) => s.injected)) problems.push('a fail-open turn injected');
    if (!turns.every((s) => s.code === 'INDEX_MISSING')) problems.push('not every turn logged INDEX_MISSING: ' + turns.map((s) => s.code).join(','));
    if (inRequests(BLOCK_HEADER)) problems.push('a request carries the block header');
  }
  if (arm === 'budget') {
    if (turns.some((s) => s.injected)) problems.push('a budget-exhausted turn injected');
    if (!turns.every((s) => s.code === 'BUDGET_EXHAUSTED' && s.budget_exhausted === true && s.budget_phase === 'exhausted')) problems.push('not every turn logged BUDGET_EXHAUSTED: ' + turns.map((s) => s.code).join(','));
    if (inRequests(BLOCK_HEADER)) problems.push('a request carries the block header');
  }
  if (arm === 'names-only' || arm === 'no-catalog' || arm === 'usage-ordered') {
    const l = listing(h, c.requests[0], catalog);
    facts.listed_catalog = new Set(l.catalog).size;
    facts.listed_harness = l.harness.length;
    facts.listed_harness_names = l.harness;
    if (turns.length) problems.push('a listing arm logged resolver turns');
    if (arm === 'names-only' && facts.listed_catalog !== STEP0.namesOnlyCatalog[h]) problems.push('names-only lists ' + facts.listed_catalog + ' catalog skills, Step 0 counted ' + STEP0.namesOnlyCatalog[h]);
    if (arm === 'no-catalog') {
      if (facts.listed_catalog !== 0) problems.push('no-catalog lists ' + facts.listed_catalog + ' catalog skills');
      if (facts.listed_harness !== NO_CATALOG_HARNESS[h]) problems.push('no-catalog lists ' + facts.listed_harness + ' harness skills, expected ' + NO_CATALOG_HARNESS[h] + ' (Step 0 counted ' + STEP0.noBundledHarness[h] + ' with bundled skills off and the catalog installed)');
    }
    if (arm === 'usage-ordered') {
      const top = new Set(usageOrder ?? []);
      const outside = l.catalog.filter((n) => !top.has(n));
      if (outside.length) problems.push('listed outside the top list: ' + outside.slice(0, 5).join(', '));
      facts.installed = (c.arm?.install as { skills?: number } | undefined)?.skills ?? null;
    }
  }
  return { harness: h, arm, ok: problems.length === 0, facts, problems };
}

function sh(cmd: string[], timeoutMs = 1_800_000): { status: number | null; out: string } {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { encoding: 'utf8', timeout: timeoutMs, cwd: ROOT, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' } });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

function buildImages(kit: string, hs: H[], usageOrder: string, out: string) {
  for (const h of hs) {
    const steps: [string, string, string][] = [
      ['skills-kit', kit, 'ARG BASE\nFROM ${BASE}\nCOPY . /opt/skill-resolver/\n'],
      ['skills-kit-failopen', kit, 'FROM harness-eval/' + h + ':skills-kit\nUSER root\nRUN rm /opt/skill-resolver/index/*/gbrain-home/.gbrain/skill-index/he-skills/index.bin\n'],
      ['skills-kit-budget', kit, 'FROM harness-eval/' + h + ':skills-kit\nUSER root\nRUN for d in /opt/skill-resolver/index/*/gbrain-home; do touch "$d/stub-budget-exhausted"; done\n'],
    ];
    if (h === 'openclaw') {
      const kitUsage = join(out, 'kit-usage');
      const standIn = (JSON.parse(readFileSync(join(kit, 'kit.json'), 'utf8')) as { gbrain?: { stand_in?: boolean } }).gbrain?.stand_in !== false;
      buildKit({ catalog: join(kit, 'catalog'), out: kitUsage, gbrain: standIn ? undefined : join(kit, 'bin', 'gbrain'), usageOrder, harnesses: ['openclaw'], index: true });
      steps.push(['skills-kit-usage', kitUsage, 'ARG BASE\nFROM ${BASE}\nCOPY . /opt/skill-resolver/\n']);
    }
    for (const [tag, ctx, dockerfile] of steps) {
      const r = spawnSync('docker', ['build', '-q', '-f', '-', '--build-arg', 'BASE=harness-eval/' + h + ':dev', '-t', 'harness-eval/' + h + ':' + tag, ctx], { input: dockerfile, encoding: 'utf8' });
      if (r.status !== 0) throw new Error('docker build ' + h + ':' + tag + ' failed: ' + r.stderr.slice(0, 400));
      console.log('IMAGE harness-eval/' + h + ':' + tag);
    }
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const all = (n: string) => argv.flatMap((a, i) => (a === '--' + n && argv[i + 1] ? [argv[i + 1]!] : []));
  const kit = all('kit')[0] ? resolve(all('kit')[0]!) : '';
  if (!kit || !existsSync(join(kit, 'kit.json'))) { console.error('usage: arm-captures.ts --kit <kit dir> [--out <dir>] [--cell <harness>:<arm>]... [--build] [--check-only] [--usage-order <file>] [--budget-replay]'); process.exit(2); }
  const out = resolve(all('out')[0] ?? join(homedir(), '.capy/work/internal-task/arm-captures'));
  mkdirSync(out, { recursive: true });
  const catalogNames = readdirSync(join(kit, 'catalog', 'skills')).sort();
  const usagePath = all('usage-order')[0] ? resolve(all('usage-order')[0]!) : join(out, 'usage-order.test.txt');
  if (!all('usage-order')[0]) writeFileSync(usagePath, [...catalogNames].reverse().join('\n') + '\n');
  const usageOrder = readFileSync(usagePath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const defaults: string[] = (['openclaw', 'claude-code', 'codex', 'hermes'] as H[]).flatMap((h) => ['native', 'resolver', 'failopen', 'budget', 'names-only', 'no-catalog', ...(h === 'openclaw' ? ['usage-ordered'] : [])].map((a) => h + ':' + a));
  const cells = (all('cell').length ? all('cell') : defaults).map((c) => c.split(':') as [H, Arm]);
  if (argv.includes('--build')) buildImages(kit, [...new Set(cells.map(([h]) => h))], usagePath, out);
  const catalog = new Set(catalogNames);
  const checks: Check[] = [];
  const kitJson = JSON.parse(readFileSync(join(kit, 'kit.json'), 'utf8')) as { gbrain?: { stand_in?: boolean } };
  const budgetReplay = argv.includes('--budget-replay') || kitJson.gbrain?.stand_in === false;
  for (const [h, arm] of cells) {
    if (arm === 'budget' && budgetReplay) {
      const r = shadowReplay(join(kit, 'bin', 'gbrain'), h, { untilExhausted: true });
      const chk: Check = { harness: h, arm, ok: r.ok, facts: { budget_replay: r.line }, problems: r.problems.slice(0, 10) };
      checks.push(chk);
      console.log((chk.ok ? 'CHECK ok ' : 'CHECK FAIL ') + h + ':budget (replay) ' + r.line + (chk.problems.length ? ' problems: ' + chk.problems.join('; ') : ''));
      continue;
    }
    const dir = join(out, h + '-' + arm);
    if (!argv.includes('--check-only')) {
      rmSync(dir, { recursive: true, force: true });
      const image = 'harness-eval/' + h + ':' + (arm === 'failopen' || arm === 'budget' ? 'skills-kit-' + arm : arm === 'usage-ordered' ? 'skills-kit-usage' : 'skills-kit');
      const config = 'skills-' + (arm === 'failopen' || arm === 'budget' ? 'resolver' : arm);
      const r = sh(['bun', 'scripts/anatomy/capture.ts', '--harness', h, '--scenario', 'plain', '--image', image, '--config', config, '--provider', PROVIDER[h].provider,
        '--model', PROVIDER[h].model, '--egress', 'off', '--record', h + '-' + arm, '--out', dir]);
      console.log('CAPTURE ' + h + ':' + arm + ' exit=' + r.status + ' ' + r.out.trim().split('\n').pop());
    }
    const chk = checkCapture(h, arm, loadCapture(dir), catalog, usageOrder);
    checks.push(chk);
    console.log((chk.ok ? 'CHECK ok ' : 'CHECK FAIL ') + h + ':' + arm + ' ' + JSON.stringify(chk.facts) + (chk.problems.length ? ' problems: ' + chk.problems.join('; ') : ''));
  }
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ kit, kit_json: kitJson, usage_order: usagePath, checks }, null, 1) + '\n');
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}
