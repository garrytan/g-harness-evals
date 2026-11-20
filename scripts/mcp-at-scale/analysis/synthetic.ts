#!/usr/bin/env bun
// Synthetic MCP-at-scale outcomes for the keyless end-to-end check (internal-task): two harnesses on Opus at all four rungs
// (claude-code holds, hermes slips), Claude Code's tool-search-off arm, the four gbrain arms at 150, set T at 30 and 300,
// and a pilot of every arm, in grade.py's outcomes.json shape inside the trial index stats.ts reads. Nothing here is a
// measurement; the numbers are chosen so the decision rules have something known to find.
//
//   bun scripts/mcp-at-scale/analysis/synthetic.ts --out <dir>
//
// Writes <out>/sets/set-{r,t,g}.jsonl, <out>/pilot/set-{r,t,g}.jsonl, <out>/trials.jsonl, <out>/pilot-trials.jsonl,
// <out>/places.json, <out>/gbrain-surfaces.json, <out>/audit-status.json, <out>/arms.json (the arms these trials cover,
// with the planned spend from analysis/arms.json).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Ladder } from '../catalog-load.ts';
import { itemSha, loadLadder, twinsOf, type GItem, type Item, type RItem, type TItem } from '../requests/sets.ts';
import { SYNTHETIC_SURFACES, jsonl, syntheticSets } from '../requests/synthetic.ts';
import type { Outcomes, Trial } from './stats.ts';

const MODEL = 'claude-opus-5-5';
/** Right-tool probability by harness, arm and rung. */
export const P_RIGHT: Record<string, Record<number, number>> = {
  'claude-code|native': { 30: 0.92, 75: 0.92, 150: 0.91, 300: 0.91 },
  'hermes|native': { 30: 0.92, 75: 0.9, 150: 0.8, 300: 0.66 },
  'claude-code|tool-search-off': { 30: 0.93, 75: 0.93, 150: 0.92, 300: 0.92 },
};
const USD: Record<string, Record<number, number>> = {
  'claude-code|native': { 30: 0.1, 75: 0.104, 150: 0.11, 300: 0.12 }, 'hermes|native': { 30: 0.08, 75: 0.1, 150: 0.13, 300: 0.18 },
  'claude-code|tool-search-off': { 30: 0.12, 75: 0.2, 150: 0.35, 300: 0.6 },
};
const P_T: Record<string, Record<number, number>> = { 'claude-code': { 30: 0.85, 300: 0.85 }, hermes: { 30: 0.85, 300: 0.65 } };
const P_G: Record<string, { starter: number; full_only: number }> = { full: { starter: 0.88, full_only: 0.86 }, starter: { starter: 0.88, full_only: 0 }, verbs: { starter: 0.87, full_only: 0.83 }, registered: { starter: 0.87, full_only: 0.82 } };
const INFRA_RATE = 0.01;

const u = (...parts: (string | number)[]) => parseInt(createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 8), 16) / 2 ** 32;

function outcomes(o: { item: Item; rung: number; servers: string[]; right: boolean; wrongTool: string | null; none: boolean; noneCalled: boolean; infra: boolean; fixtures?: string[] }): Outcomes {
  const calls: Outcomes['calls'] = [];
  const it = o.item;
  if (o.fixtures) for (const f of o.fixtures) { const s = (it as TItem).fixtures.find((x) => x.id === f)!; calls.push({ server: s.server!, tool: s.tool, arguments: {}, validation_ok: true, fixture: f }); }
  else if (!o.none) {
    if (o.wrongTool) calls.push({ server: o.wrongTool.split('/')[0]!, tool: o.wrongTool.split('/')[1]!, arguments: {}, validation_ok: true, fixture: 'default' });
    if (o.right) { const a = (it as RItem | GItem).acceptable[0]!; calls.push({ server: a.server, tool: a.tool, arguments: {}, validation_ok: true, fixture: 'default' }); }
  } else if (o.noneCalled) calls.push({ server: o.servers[0]!, tool: 'x', arguments: {}, validation_ok: true, fixture: 'default' });
  const connected = o.infra ? o.servers.slice(1) : o.servers;
  const kind = o.none ? 'none' : 'tool';
  const right = o.none ? null : calls.length > 0 && (o.right || !!o.fixtures);
  return { request: it.id, kind, rung: String(o.rung), servers_expected: o.servers, servers_connected: connected, servers_missing: o.servers.filter((s) => !connected.includes(s)),
    infra: o.infra ? { code: 'HE-MCP-001', detail: '1 of ' + o.servers.length + ' expected MCP servers were not connected (initialize and tools/list): ' + o.servers[0] } : null,
    calls, right_tool: right, first_right_call: right ? calls.length - 1 : null, wrong_tools: o.wrongTool && !o.none ? [o.wrongTool] : [], tool_when_none: o.none ? o.noneCalled : null,
    invalid_calls: 0, reward: o.infra ? 0 : o.none ? (o.noneCalled ? 0 : 1) : right ? 1 : 0 };
}

export function syntheticRun(ladder: Ladder, twins: Record<string, string[]>, o: { pilot?: boolean } = {}) {
  const sets = o.pilot ? syntheticSets(ladder, twins, { prefix: 'p', perTool: 2, none: 0, tasks: 10, g: 20 }) : syntheticSets(ladder, twins);
  const serversAt = (r: number) => ladder.rungs[String(r)]!.servers.map((s) => s.server);
  const trials: Trial[] = [];
  const twinTool = (server: string) => { const t = twins[server]?.[0]; const s = t ? ladder.rungs['300']!.servers.find((x) => x.server === t) : null; return s ? s.server + '/' + s.tools[0] : null; };
  let n = 0;
  const push = (harness: string, arm: string, rung: number, item: Item, out: Outcomes, usd: number, extra: Partial<Trial> = {}) => {
    n++;
    const search = arm === 'tool-search-off' ? 0 : 1 + Math.floor(u('s', n) * 2);
    const log: Array<Record<string, unknown>> = [...out.servers_connected.flatMap((s) => [{ server: s, method: 'initialize', ok: true }, { server: s, method: 'tools/list', ok: true }]), ...out.calls.map((c) => ({ server: c.server, method: 'tools/call', tool: c.tool, fixture: c.fixture, ok: c.validation_ok }))];
    if (arm.startsWith('gbrain-')) log.unshift({ server: 'gbrain', method: 'initialize', ok: true }, { server: 'gbrain', method: 'tools/list', ok: true });
    if (arm === 'gbrain-verbs' || arm === 'gbrain-registered') log.push({ server: 'gbrain', method: 'tools/call', tool: 'request_tools', ok: true }, { server: 'gbrain', method: 'tools/call', tool: SYNTHETIC_SURFACES.full.at(-1)!, ok: true });
    trials.push({ trial_id: (o.pilot ? 'pilot-' : '') + 't' + n, set: item.set, harness, model: MODEL, arm, rung, request: item.id, outcomes: out,
      usage: { input_tokens: Math.round(usd * 1e5), cache_read_tokens: Math.round(usd * 6e4), usd: o.pilot ? usd / 4 : usd },
      effort: { source: 'trajectory', turns: search + 1, found: !!out.right_tool, turns_before_right: out.right_tool ? search : null, search_calls: search, search_calls_before_right: search }, builtin_attempts: 0, cache_break_after_load: false,
      ...(o.pilot ? { host_log_lines: log, ...(arm === 'gbrain-starter' ? { gbrain_listed_tools: SYNTHETIC_SURFACES.starter } : {}) } : {}), ...extra });
  };
  for (const harness of ['claude-code', 'hermes']) {
    for (const arm of harness === 'claude-code' ? ['native', 'tool-search-off'] : ['native']) {
      const key = harness + '|' + arm;
      for (const rung of [30, 75, 150, 300]) {
        const servers = serversAt(rung);
        for (const it of sets.R) {
          const infra = u('infra', key, rung, it.id) < INFRA_RATE;
          const latent = u('latent', harness, it.id) + (u('tool', it.target?.tool ?? it.id) - 0.5) * 0.1;
          const right = it.kind === 'tool' && latent < P_RIGHT[key]![rung]!;
          const wrong = it.kind === 'tool' && !right && u('wrong', key, rung, it.id) < 0.6 ? twinTool(it.target!.server) : null;
          const noneCalled = it.kind === 'none' && u('none', harness, it.id) < 0.05;
          push(harness, arm, rung, it, outcomes({ item: it, rung, servers, right, wrongTool: wrong, none: it.kind === 'none', noneCalled, infra }), USD[key]![rung]! * (0.8 + 0.4 * u('usd', n)));
        }
        if (arm === 'native' && (rung === 30 || rung === 300)) for (const it of sets.T) {
          const ok = u('t', harness, it.id) < P_T[harness]![rung]!;
          push(harness, arm, rung, it, outcomes({ item: it, rung, servers, right: ok, wrongTool: null, none: false, noneCalled: false, infra: false, fixtures: ok ? it.fixtures.map((f) => f.id) : it.fixtures.slice(0, 1).map((f) => f.id) }), USD[key]![rung]! * 2);
        }
      }
    }
    for (const s of ['full', 'starter', 'verbs', 'registered']) {
      const servers = serversAt(150);
      for (const it of sets.G) {
        const right = u('g', harness, it.id) < P_G[s]![it.half_kind];
        push(harness, 'gbrain-' + s, 150, it, outcomes({ item: it, rung: 150, servers, right, wrongTool: null, none: false, noneCalled: false, infra: false }), 0.15);
      }
      for (const it of sets.R.slice(0, o.pilot ? 10 : 160)) {
        const latent = u('latent', harness, it.id) + (u('tool', it.target?.tool ?? it.id) - 0.5) * 0.1;
        const right = it.kind === 'tool' && latent < P_RIGHT[harness + '|native']![150]! - 0.01;
        push(harness, 'gbrain-' + s, 150, it, outcomes({ item: it, rung: 150, servers, right, wrongTool: null, none: it.kind === 'none', noneCalled: false, infra: false }), 0.14);
      }
    }
  }
  return { sets, trials };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : undefined;
  if (!out) { console.error('usage: synthetic.ts --out <dir>'); process.exit(2); }
  const ladder = loadLadder(), twins = twinsOf();
  const main = syntheticRun(ladder, twins), pilot = syntheticRun(ladder, twins, { pilot: true });
  for (const d of ['sets', 'pilot']) mkdirSync(join(out, d), { recursive: true });
  for (const k of ['R', 'T', 'G'] as const) { writeFileSync(join(out, 'sets', 'set-' + k.toLowerCase() + '.jsonl'), jsonl(main.sets[k])); writeFileSync(join(out, 'pilot', 'set-' + k.toLowerCase() + '.jsonl'), jsonl(pilot.sets[k])); }
  writeFileSync(join(out, 'trials.jsonl'), main.trials.map((t) => JSON.stringify(t)).join('\n') + '\n');
  writeFileSync(join(out, 'pilot-trials.jsonl'), pilot.trials.map((t) => JSON.stringify(t)).join('\n') + '\n');
  const core = ladder.core.flatMap((c) => c.tools.map((t) => c.server + '/' + t));
  writeFileSync(join(out, 'places.json'), JSON.stringify(Object.fromEntries(['claude-code', 'hermes'].map((h) => [h, Object.fromEntries([30, 75, 150, 300].map((r) => [r, Object.fromEntries(core.map((t) => [t, h === 'claude-code' ? 'name_only' : r <= 150 ? 'description' : 'name_only']))]))])), null, 1) + '\n');
  writeFileSync(join(out, 'gbrain-surfaces.json'), JSON.stringify(SYNTHETIC_SURFACES, null, 1) + '\n');
  const all = [...main.sets.R, ...main.sets.T, ...main.sets.G];
  writeFileSync(join(out, 'audit-status.json'), JSON.stringify({ schema: 'he-mcp-at-scale-audit-status/1', counts: { passed: all.length }, drops_by_stratum: {}, twin_kept: 0,
    items: Object.fromEntries(all.map((i) => [i.id, 'passed'])), audited_item_sha256: Object.fromEntries(all.map((i) => [i.id, itemSha(i)])) }, null, 1) + '\n');
  const arms = JSON.parse(readFileSync(join(import.meta.dir, 'arms.json'), 'utf8')) as { arms: Array<{ id: string }> };
  const keep = ['native:claude-code', 'native:hermes', 'mechanism:claude-code-tool-search-off', 'gbrain:full', 'gbrain:starter', 'gbrain:verbs', 'gbrain:registered'];
  writeFileSync(join(out, 'arms.json'), JSON.stringify({ ...arms, arms: arms.arms.filter((a) => keep.includes(a.id)) }, null, 1) + '\n');
  console.log('synthetic: ' + main.trials.length + ' trials, ' + pilot.trials.length + ' pilot trials, written to ' + out);
}
