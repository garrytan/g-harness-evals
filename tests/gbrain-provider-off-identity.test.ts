// internal-task (QM M1): provider-aware scoring is off by default. With upstream.provider unset the tap writes the same events
// as the tap at BASE (origin/main when this change started), and with --provider-aware unset scripts/v03/mechanism.ts
// writes the committed mechanism tables of the v0.3 pilot (docs/benchmarks/2026-10-29-v03-pilot) byte for byte.
//
// The tap check replays every gbrain event the pilot recorded: the request is rebuilt from the event's tool and args and
// the upstream reply from its outcome and effect (pages, sources, facts, degraded stamp, error code), then the same
// request and reply go through BASE's tap and this tree's. The rebuilt replies are not gbrain's bytes, only the same input
// for both taps; wall_ts and latency_ms are the clock's and are blanked.

import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog, type WorldEvent } from '../world/services/events.ts';
import * as current from '../world/services/gbrain-tap.ts';
import type { Member } from '../world/types.ts';

const ROOT = join(import.meta.dir, '..');
const BASE = '7da83ed94';
const PILOT = join(ROOT, 'docs', 'benchmarks', '2026-10-29-v03-pilot', 'results');
const tmp = mkdtempSync(join(tmpdir(), 'he-provider-off-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const env = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? tmp };

test('mechanism.ts without --provider-aware writes the committed v0.3 pilot tables byte for byte; with it, the pilot stops on MECH-CALLER-MISSING', () => {
  const out = join(tmp, 'mechanism');
  const args = ['scripts/v03/mechanism.ts', '--results', PILOT, '--tasks', 'tasks/multiuser/v0.3/dev'];
  const off = spawnSync('bun', [...args, '--out', out], { cwd: ROOT, env, encoding: 'utf8' });
  expect(off.status).toBe(0);
  const md = readFileSync(join(PILOT, 'mechanism', 'mechanism.md'), 'utf8');
  expect(readFileSync(join(out, 'mechanism.json'), 'utf8')).toBe(readFileSync(join(PILOT, 'mechanism', 'mechanism.json'), 'utf8'));
  expect(readFileSync(join(out, 'mechanism.md'), 'utf8')).toBe(md);
  expect(off.stdout).toBe(md);
  const on = spawnSync('bun', [...args, '--provider-aware'], { cwd: ROOT, env, encoding: 'utf8' });
  expect(on.status).toBe(1);
  expect(on.stderr).toContain('MECH-CALLER-MISSING');
});

type Tap = typeof current;
const text = (v: unknown) => ({ type: 'text', text: JSON.stringify(v) });

function pilotGbrainEvents(): WorldEvent[] {
  const out: WorldEvent[] = [];
  const walk = (dir: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name === 'events.jsonl') for (const l of readFileSync(p, 'utf8').split(String.fromCharCode(10))) if (l.includes('"via":"gbrain"')) out.push(JSON.parse(l) as WorldEvent);
    }
  };
  walk(join(PILOT, 'trials'));
  return out;
}

/** The request and upstream behaviour one recorded event implies. */
function rebuild(e: WorldEvent, id: number): { request: unknown; respond: () => Response } {
  const name = e.tool.slice('gbrain.'.length);
  const request = name === 'initialize' || name === 'tools/list' ? { jsonrpc: '2.0', id, method: name, params: {} } : { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: e.args } };
  const fx = (e.effect ?? {}) as { pages?: string[]; count?: number; sources?: string[]; facts?: unknown[]; degraded?: string };
  const error = e.error ?? '';
  const reply = (body: Record<string, unknown>) => () => Response.json({ jsonrpc: '2.0', id, ...body });
  if (error === 'upstream_unreachable') return { request, respond: () => { throw new Error('connect ECONNREFUSED'); } };
  if (/^upstream_\d+$/.test(error)) return { request, respond: () => Response.json({ error: 'x' }, { status: Number(error.slice(9)) }) };
  if (error === 'no_response') return { request, respond: () => Response.json({ jsonrpc: '2.0', id: id + 1, result: {} }) };
  if (error.startsWith('rpc_')) return { request, respond: reply({ error: { code: Number(error.slice(4)) || -32000, message: 'x' } }) };
  if (e.outcome === 'error') return { request, respond: reply({ result: { isError: true, content: [text({ code: error, error })] } }) };
  if (name === 'initialize') return { request, respond: reply({ result: { protocolVersion: '2025-03-26', serverInfo: { name: 'gbrain' } } }) };
  if (name === 'tools/list') return { request, respond: reply({ result: { tools: Array.from({ length: fx.count ?? 0 }, (_, i) => ({ name: 't' + i })) } }) };
  const sources = fx.sources ?? [];
  const rows = (fx.pages ?? []).map((slug, i) => ({ slug, ...(sources.length ? { source_id: sources[i % sources.length] } : {}) }));
  if (name === 'recall') return { request, respond: reply({ result: { content: [text({ results: rows, facts: fx.facts ?? [], ...(fx.degraded ? { search_degraded: fx.degraded } : {}) })] } }) };
  return { request, respond: reply({ result: { content: [text(rows)], ...(fx.facts ? { _meta: { retrieval: { saved_facts: fx.facts } } } : {}) } }) };
}

async function replay(tap: Tap, events: WorldEvent[], upstream: current.GbrainUpstream): Promise<WorldEvent[]> {
  const log = new EventLog('replay', null, () => '2026-10-30T09:00:00Z');
  const opts = (respond: () => Response) => ({ upstream, log, resolveActor: () => ({ id: 'assistant' } as Member), fetchImpl: (async () => respond()) as unknown as typeof fetch });
  let id = 0;
  for (const e of events) {
    const { request, respond } = rebuild(e, ++id);
    await tap.handleGbrainRequest(new Request('http://world/gbrain', { method: 'POST', headers: { authorization: 'Bearer xoxb-bot', 'content-type': 'application/json' }, body: JSON.stringify(request) }), opts(respond));
  }
  return log.events.map((e) => ({ ...e, wall_ts: '', ...(e.effect ? { effect: { ...e.effect, latency_ms: 0 } } : {}) }));
}

/** world/services/gbrain-tap.ts at BASE, loaded once. Its only imports are types, which Bun strips. */
let baseTap: Tap | null = null;
async function loadBase(): Promise<Tap> {
  if (baseTap) return baseTap;
  const dir = join(tmp, 'base', 'world', 'services');
  mkdirSync(dir, { recursive: true });
  const show = spawnSync('git', ['show', BASE + ':world/services/gbrain-tap.ts'], { cwd: ROOT, maxBuffer: 64 << 20, encoding: 'utf8' });
  if (show.status !== 0) throw new Error('git show ' + BASE + ' failed (CI checks out with fetch-depth 0): ' + show.stderr);
  writeFileSync(join(dir, 'gbrain-tap.ts'), show.stdout);
  return (baseTap = (await import(join(dir, 'gbrain-tap.ts'))) as Tap);
}

test('scope "sources" denials, all denied and mixed in a batch, are recorded and answered exactly as at BASE', async () => {
  const base = await loadBase();
  const upstream = { url: 'http://gbrain.invalid', token: 'gbrain_unscoped', grants: { members: { 'dana-okafor': ['private-dana-okafor', 'public'] }, public: ['public'] } };
  const call = (id: number, name: string, args: Record<string, unknown>) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const bodies = [
    call(1, 'search', { query: 'renewal', source_ids: ['team-north'] }),
    [call(2, 'search', { query: 'renewal', source_ids: ['team-north'] }), call(3, 'search', { query: 'renewal', source_ids: ['team-north', 'public'] }), call(4, 'get_page', { slug: 'dev/notes/a' })],
  ];
  const run = async (tap: Tap) => {
    const log = new EventLog('denied', null, () => '2026-10-30T09:00:00Z');
    const out: string[] = [];
    for (const body of bodies) {
      const res = await tap.handleGbrainRequest(new Request('http://world/gbrain', { method: 'POST', headers: { authorization: 'Bearer xoxb-bot', 'content-type': 'application/json' }, body: JSON.stringify(body) }), {
        upstream, log, requester: () => 'dana-okafor', resolveActor: () => ({ id: 'assistant' } as Member),
        fetchImpl: (async (_u: string, init: RequestInit) => {
          const sent = JSON.parse(String(init.body)) as Array<{ id: number }>;
          return Response.json((Array.isArray(sent) ? sent : [sent]).map((m) => ({ jsonrpc: '2.0', id: m.id, result: { content: [text([{ slug: 'dev/notes/a', source_id: 'public' }])] } })));
        }) as unknown as typeof fetch,
      });
      out.push(res.status + ' ' + (await res.text()));
    }
    return [...out, ...log.events.map((e) => JSON.stringify({ ...e, wall_ts: '', ...(e.effect ? { effect: { ...e.effect, latency_ms: 0 } } : {}) }))];
  };
  const before = await run(base);
  expect(before.some((l) => l.includes('permission_denied'))).toBe(true);
  expect(before.length).toBe(2 + 4);
  expect(await run(current)).toEqual(before);
});

test('the tap without upstream.provider records every v0.3 pilot gbrain call exactly as the tap at BASE; with it, only caller and effect.returned_by_gbrain are added', async () => {
  const base = await loadBase();
  const events = pilotGbrainEvents();
  expect(events.length).toBe(7674);
  const upstream = { url: 'http://gbrain.invalid', token: 'gbrain_unscoped' };
  const before = await replay(base, events, upstream);
  const after = await replay(current, events, upstream);
  const lines = (es: object[]) => es.map((e) => JSON.stringify(e));
  /** The first line that differs, or null; keeps a failure readable instead of printing 7,674 events. */
  const firstDiff = (a: string[], b: string[]) => { const i = a.findIndex((x, j) => x !== b[j]); return i < 0 && a.length === b.length ? null : { line: i, got: a[i], want: b[i] }; };
  expect(before.length).toBe(events.length);
  expect(firstDiff(lines(after), lines(before))).toBeNull();
  const aware = await replay(current, events, { ...upstream, provider: { tokens: ['qm-provider-token'], actor: 'assistant' } });
  expect(aware.every((e) => e.caller === 'model' && !('provider_actor' in e))).toBe(true);
  expect(aware.filter((e) => (e.effect as { returned_by_gbrain?: unknown } | undefined)?.returned_by_gbrain !== undefined).length).toBe(events.filter((e) => e.tool !== 'gbrain.initialize' && e.tool !== 'gbrain.tools/list').length);
  const stripped = aware.map((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'caller').map(([k, v]) => [k, k === 'effect' ? Object.fromEntries(Object.entries(v as object).filter(([j]) => j !== 'returned_by_gbrain')) : v])));
  expect(firstDiff(lines(stripped), lines(before))).toBeNull();
}, 120_000);
