#!/usr/bin/env bun
// The checks before any counted skills-at-scale cell (internal-task-a, internal-task-b; plan "What waits", review F14), keyless, per harness:
//   ready      the arm came up: sas-arm.json ok, gbrain doctor --only skill_resolver ok, the catalog's index fresh at trial start
//   trigger    a two-turn session through the real installer and a fake model. Turn 1 asks for a task only skill A fits, turn 2
//              one only skill B fits (each names A's or B's own tool word; the pair is the first two target skills the pinned
//              gbrain ranks first offline for their request). Turn 1's request must carry a block naming A, and turn 2's request
//              must carry a new block naming B: a lane that ranks the previous message fails here (internal-task's OpenClaw bug).
//   pins       on skills-gbrain-pins only: every pin gbrain renders (gbrain skills pin list: the pins under its 600-token cap)
//              is in a <pinned_skills> block of turn 1's request; the cut pins are recorded. At v0.60.742.0 pins reach Hermes,
//              OpenClaw and Pi, and none reach Claude Code or Codex, so the check fails there
//   lanes      every turn's lane outcome from gbrain's own logs (<state>/.gbrain/skill-index/logs: delivered, no_catalog,
//              payload_dropped, weak_top_match, timeout and so on), printed per turn; one line per member turn must be there
// Exits 1 naming each failed cell and its fix. --preamble gives the cells another preamble: preamble.message-only.md (each turn
// is the member's message alone) or preamble.turn.md (the per-turn header and the message, with the Hermes -system-preamble
// configs carrying the rest in the system prompt). The resolver hooks rank the user turn, so the preamble is part of the
// ranked text.
//
//   bun scripts/skills-at-scale/checks.ts --rung <rung dir> --tag <image tag> --out <dir> [--harness h,...] [--config skills-gbrain-setup]
//       [--preamble <file>]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { turnRequests, type LogRow } from '../skill-resolver/footprint.ts';
import { pinnedGbrain, readCatalog } from './build-kit.ts';
import { SAS_HARNESSES, type SasHarness } from './arm.ts';
import { runSession } from './session.ts';

export const BLOCK_OPEN = '<relevant_skills>';
export const triggerText = (s: { name: string; tool_word?: string }) => 'Please use the ' + (s.tool_word ?? s.name) + ' tool to sort out the ' + s.name.replace(/-/g, ' ') + ' work for me today.';

const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
};

/** Every resolver block in a request, in the order the request carries them. */
export function blocks(body: unknown): string[] {
  const out: string[] = [];
  for (const s of strings(body)) {
    let i = s.indexOf(BLOCK_OPEN);
    while (i >= 0) {
      const j = s.indexOf('</relevant_skills>', i);
      out.push(s.slice(i, j < 0 ? undefined : j + '</relevant_skills>'.length));
      i = s.indexOf(BLOCK_OPEN, i + 1);
    }
  }
  return out;
}

/** The skill ids a block names. */
export const blockIds = (block: string): string[] => [...block.matchAll(/id: "([^"]+)"/g)].map((m) => m[1]!);

export type TriggerResult = { ok: boolean; turn1_ids: string[]; turn2_new_ids: string[]; problems: string[] };

/** Turn 1's request must carry a block naming a; turn 2's must carry a block turn 1's did not, naming b. */
export function judgeTrigger(turn1: unknown, turn2: unknown, a: string, b: string): TriggerResult {
  const problems: string[] = [];
  const b1 = turn1 ? blocks(turn1) : [], b2 = turn2 ? blocks(turn2) : [];
  const fresh = b2.filter((x) => !b1.includes(x));
  const ids1 = b1.flatMap(blockIds), ids2 = fresh.flatMap(blockIds);
  if (!turn1) problems.push('no agent request found for turn 1');
  if (!turn2) problems.push('no agent request found for turn 2');
  if (turn1 && !ids1.includes(a)) problems.push('turn 1 carries no block naming ' + a + (b1.length ? ' (its block names ' + (ids1.join(', ') || 'nothing') + ')' : ' (no block at all)'));
  if (turn2 && !ids2.includes(b)) problems.push('turn 2 carries no new block naming ' + b + (fresh.length ? ' (its new block names ' + (ids2.join(', ') || 'nothing') + ')' : ' (no new block: the lane delivered nothing for this message, or repeated an earlier block)'));
  return { ok: problems.length === 0, turn1_ids: ids1, turn2_new_ids: ids2, problems };
}

/** Pinned ids a request carries inside gbrain's pinned block (<pinned_skills>, src/core/setup/skill-pins.ts). */
export function pinsCarried(body: unknown, ids: string[]): string[] {
  const text = strings(body).join('\n');
  const pinned = [...text.matchAll(/<pinned_skills>[\s\S]*?<\/pinned_skills>/g)].map((m) => m[0]).join('\n');
  const carried = new Set([...pinned.matchAll(/^\s*-\s*id:\s*"?([^"\s]+)"?/gm)].map((m) => m[1]!));
  return ids.filter((id) => carried.has(id));
}

export type LaneLine = { file: string; event?: string; outcome?: string; code?: string | null; ms?: number; suggested?: string[] };
/** gbrain's per-turn lane lines from a trial's state directory, in the order written. */
export function laneLines(state: string): LaneLine[] {
  const dir = join(state, '.gbrain', 'skill-index', 'logs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => {
    const r = JSON.parse(l) as Record<string, any>;
    return { file: f, event: r.event, outcome: r.outcome ?? r.result, code: r.code ?? r.error_code ?? null, ms: r.ms ?? r.duration_ms, suggested: r.suggested ?? r.suggested_ids };
  }));
}

/** The first two target skills (all skills when none is marked) that the pinned gbrain ranks first for their own request. */
export function pickPair(rung: string, harness: SasHarness, gbrain: string): { a: { name: string; tool_word?: string }; b: { name: string; tool_word?: string } } {
  const home = mkdtempSync(join(tmpdir(), 'sas-pair-'));
  const env = { PATH: '/usr/bin:/bin', HOME: home };
  try {
    const built = spawnSync(gbrain, ['skills', 'index', 'build', '--catalog', 'pair', '--dir', join(rung, 'skills'), '--harness', harness], { env, encoding: 'utf8' });
    if (built.status !== 0) throw new Error('gbrain skills index build failed: ' + (built.stderr ?? '').slice(-300));
    const skills = readCatalog(rung) as { name: string; description: string; target?: boolean; tool_word?: string }[];
    const pool = skills.some((s) => s.target) ? skills.filter((s) => s.target) : skills;
    const good: typeof pool = [];
    for (const s of pool) {
      const r = spawnSync(gbrain, ['skills', 'resolve', '--catalog', 'pair', '--text', triggerText(s), '--json', '--harness', harness], { env, encoding: 'utf8' });
      try { if ((JSON.parse(r.stdout).suggestions ?? [])[0]?.id === s.name) good.push(s); } catch { /* not a pick */ }
      if (good.length === 2) return { a: good[0]!, b: good[1]! };
    }
    throw new Error('no two target skills rank first for their own request');
  } finally { rmSync(home, { recursive: true, force: true }); }
}

export const FIX: Record<string, string> = {
  ready: 'read the trial\'s sas-arm.json and sas-setup.log; fix the install (gbrain setup, doctor or the index) or pin the newest gbrain or harness release that passes',
  timeout: 'the lane missed its deadline (50 ms) and delivered nothing; rerun on an idle machine, and if it repeats, report the timeout rate at this catalog size to gbrain',
  trigger: 'the resolver does not rank the current message on this harness; the cell stays gated until a gbrain release fixes the lane (for OpenClaw, internal-task, fixed in gbrain 0.60.743.0: build the kit with build-kit.ts --gbrain v0.60.743.0 or later, which installs it fresh and runs gbrain setup openclaw --skill-loading resolve before the cell starts)',
  pins: 'gbrain renders the pins but no pin route reaches this harness\'s request (at v0.60.742.0 Claude Code and Codex get none: the hook lane renders no pinned block, though docs/guides/skill-resolver.md says a pin is shown on every turn); report it to gbrain and leave skills-gbrain-pins out on this harness until a release delivers them',
  lanes: 'gbrain logged no lane line for some member turn: the hook or plugin did not run; check the harness loads it (setup\'s own check, hooks doctor, plugins inspect)',
};

async function main() {
  const a = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const rung = v('--rung'), tag = v('--tag'), outArg = v('--out');
  if (!rung || !tag || !outArg) { console.error('usage: checks.ts --rung <dir> --tag <image tag> --out <dir> [--harness h,...] [--config skills-gbrain-setup] [--preamble <file>]'); process.exit(2); }
  const out = resolve(outArg);
  const config = v('--config') ?? 'skills-gbrain-setup';
  const preamble = v('--preamble');
  const harnesses = (v('--harness') ?? SAS_HARNESSES.join(',')).split(',') as SasHarness[];
  const gbrain = pinnedGbrain();
  const results: Record<string, unknown>[] = [];
  for (const h of harnesses) {
    const cell = h + ':' + config + ':' + tag;
    const pair = pickPair(resolve(rung), h, gbrain);
    const texts = [triggerText(pair.a), triggerText(pair.b)];
    const s = await runSession({ harness: h, config, image: 'harness-eval/' + h + ':sas-' + tag, turns: texts, dir: join(out, h + '-' + config + '-' + tag), preamble });
    const fails: { check: string; why: string }[] = [];
    const armFile = s.trial ? join(s.trial, 'logs', 'sas-arm.json') : '';
    const arm = armFile && existsSync(armFile) ? JSON.parse(readFileSync(armFile, 'utf8')) : null;
    if (!arm || arm.status !== 'ok') fails.push({ check: 'ready', why: arm?.error ?? 'no sas-arm.json (termination ' + s.termination + ')' });
    else if (arm.doctor?.status !== 'ok' || arm.index?.fresh !== true) fails.push({ check: 'ready', why: 'doctor ' + JSON.stringify(arm.doctor) + ' index ' + JSON.stringify(arm.index) });
    const rows = s.requests as LogRow[];
    const idx = turnRequests(rows, texts);
    const trig = judgeTrigger(idx[0] != null ? rows[idx[0]]!.body : null, idx[1] != null ? rows[idx[1]]!.body : null, pair.a.name, pair.b.name);
    const lanesNow = s.trial ? laneLines(join(s.trial, 'state')).filter((l) => l.event !== 'session-start' && l.event !== 'read') : [];
    if (arm?.status === 'ok' && !trig.ok) fails.push({ check: lanesNow.some((l) => l.outcome === 'timeout') ? 'timeout' : 'trigger', why: trig.problems.join('; ') + (lanesNow.some((l) => l.outcome === 'timeout') ? ' (a lane line says timeout)' : '') });
    let pins: { added: number; rendered: string[]; cut: string[]; carried: string[] } | null = null;
    if (config.startsWith('skills-gbrain-pins') && arm?.status === 'ok') {
      const ids: string[] = arm.pin_ids ?? [];
      const rendered: string[] = arm.pins_rendered?.ids ?? ids;
      pins = { added: ids.length, rendered, cut: arm.pins_rendered?.cut ?? [], carried: idx[0] != null ? pinsCarried(rows[idx[0]]!.body, ids) : [] };
      const missing = rendered.filter((id) => !pins!.carried.includes(id));
      if (missing.length) fails.push({ check: 'pins', why: pins.carried.length + ' of the ' + rendered.length + ' pins gbrain renders reach turn 1\'s request (' + ids.length + ' added, ' + pins.cut.length + ' cut by gbrain\'s 600-token pin cap)' });
    }
    const lanes = s.trial ? laneLines(join(s.trial, 'state')) : [];
    const turnLanes = lanes.filter((l) => l.event !== 'session-start' && l.event !== 'read');
    if (arm?.status === 'ok' && turnLanes.length < texts.length) fails.push({ check: 'lanes', why: turnLanes.length + ' lane lines for ' + texts.length + ' member turns' });
    const r = { cell, harness: h, config, tag, preamble: preamble ?? null, ok: fails.length === 0, termination: s.termination, pair: [pair.a.name, pair.b.name], ready: arm ? { status: arm.status, doctor: arm.doctor, index: arm.index, setup: arm.setup, gbrain_version: arm.gbrain_version } : null,
      trigger: trig, pins, lanes, fails: fails.map((f) => ({ ...f, fix: FIX[f.check] })), trial: s.trial };
    results.push(r);
    console.log((r.ok ? 'CHECK ok ' : 'CHECK FAIL ') + cell + ' pair=' + r.pair.join(',') + ' turn1=' + trig.turn1_ids.join(',') + ' turn2_new=' + trig.turn2_new_ids.join(',') + ' lanes=' + lanes.map((l) => (l.event ?? '?') + ':' + (l.outcome ?? '?') + (l.code ? '(' + l.code + ')' : '')).join(' '));
    for (const f of r.fails) console.log('  FAIL ' + cell + ' ' + f.check + ': ' + f.why + '\n    fix: ' + f.fix);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ schema_version: 1, rung: resolve(rung), tag, config, preamble: preamble ?? null, results }, null, 1) + '\n');
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

if (import.meta.main) await main();
