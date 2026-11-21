// The MCP-at-scale request-set scaffolding (internal-task): the validator's strata and counts against the ladder's core tools,
// the schema, set T's fixture chains served by the catalog host itself, the sealed half, the author prompts, and the
// ambiguity-audit submitter's dry run (no network) plus its submit, collect and apply steps on a fake provider.
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHost } from '../scripts/mcp-at-scale/catalog-host.ts';
import { loadCatalog, rungServers, syntheticCatalog } from '../scripts/mcp-at-scale/catalog-load.ts';
import { taskSuccess, type Outcomes, type Trial } from '../scripts/mcp-at-scale/analysis/stats.ts';
import { adjudicateInteractive, applyAudit, auditQueue, gbrainListing, collectStage, customId, NO_TOOL, planStage, submitStage, writeStage, type Lease } from '../scripts/mcp-at-scale/requests/audit.ts';
import { authorPrompts, catalogListing, render } from '../scripts/mcp-at-scale/requests/prompts.ts';
import { halves, sealSet } from '../scripts/mcp-at-scale/requests/seal.ts';
import { loadLadder, schemaProblems, twinsOf, validateSet, validateT, type Item, type RItem, type TItem } from '../scripts/mcp-at-scale/requests/sets.ts';
import { SYNTHETIC_SURFACES, syntheticSets } from '../scripts/mcp-at-scale/requests/synthetic.ts';

const ROOT = join(import.meta.dir, '..');
const CATALOG = join(ROOT, 'tasks', 'mcp-at-scale', 'catalog');
const ladder = loadLadder(), twins = twinsOf();
const sets = syntheticSets(ladder, twins);
const tmp = mkdtempSync(join(tmpdir(), 'mcp-req-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const run = (args: string[]) => {
  const p = Bun.spawnSync(['env', '-i', 'PATH=' + (process.env.PATH ?? '/usr/bin:/bin'), 'HOME=' + tmp, process.execPath, ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

describe('validator', () => {
  test('the planned sets pass: R 320 (240 tool, 8 per core tool, 80 none), T 40, G 120; and the pilot sets', () => {
    expect(ladder.core.flatMap((c) => c.tools)).toHaveLength(30);
    for (const k of ['R', 'T', 'G'] as const) expect(validateSet(k, sets[k], { ladder, twins, surfaces: SYNTHETIC_SURFACES }).problems).toEqual([]);
    const pilot = syntheticSets(ladder, twins, { prefix: 'p', perTool: 2, none: 0, tasks: 10, g: 20 });
    for (const k of ['R', 'T', 'G'] as const) expect(validateSet(k, pilot[k], { ladder, twins, pilot: true, counted: sets[k] }).problems).toEqual([]);
    expect(validateSet('R', sets.R.slice(0, 60), { ladder, twins, pilot: true, counted: sets.R }).problems.join('\n')).toContain('is also in the counted set');
  });
  test('the strata are enforced', () => {
    const r = clone(sets.R);
    const cap = r.find((i) => i.stratum === 'capability_only')!;
    cap.text += ' Put it in GitHub.';
    const named = r.find((i) => i.stratum === 'names_service' && i.target!.server === 'slack')!;
    named.text = named.text.replace(/slack/gi, 'the chat');
    const req = r.find((i) => i.kind === 'tool' && i !== cap && i !== named)!;
    req.acceptable[0]!.required = { query: { $ci: 'NOT-IN-TEXT' } };
    const bait = r.find((i) => i.bait)!;
    bait.bait_twin = 'google-maps';
    r.pop();
    const p = validateSet('R', r, { ladder, twins }).problems.join('\n');
    expect(p).toContain('capability_only but names github');
    expect(p).toContain('names_service but does not name slack');
    expect(p).toContain('required value "NOT-IN-TEXT" is not in the text');
    expect(p).toContain('which is not a near-twin of');
    expect(p).toContain('79 no-tool requests, the plan has 80');
  });
  test('capability-only must be at least a third and bait must be spread across both strata', () => {
    const r = clone(sets.R);
    for (const i of r) if (i.stratum === 'capability_only') { i.stratum = 'names_service'; i.text = i.text + ' (in ' + ({ atlassian: 'confluence', github: 'github', grafana: 'grafana', mongodb: 'mongodb', slack: 'slack', terraform: 'terraform' } as Record<string, string>)[i.target!.server] + ')'; }
    const p = validateSet('R', r, { ladder, twins }).problems.join('\n');
    expect(p).toContain('the plan needs at least a third (80)');
    expect(p).toContain('near-twin bait must sit in both strata');
  });
  test('set T chains: after, a match value in the previous result, two core servers, end state and acceptable', () => {
    const t = clone(sets.T);
    t[0]!.fixtures[1]!.match = { ref: { $ci: 'UNRELATED' } };
    t[1]!.fixtures = t[1]!.fixtures.map((f) => ({ ...f, server: t[1]!.fixtures[0]!.server, tool: t[1]!.fixtures[0]!.tool }));
    t[2]!.end_state.fired = ['s1'];
    t[3]!.fixtures[1]!.after = [];
    const p = validateT(t, ladder).problems.join('\n');
    expect(p).toContain(t[0]!.id + ': no match value of step s2 appears in the result of s1');
    expect(p).toContain(t[1]!.id + ': steps use 1 core server(s)');
    expect(p).toContain(t[2]!.id + ': end_state.fired must include the last step');
    expect(p).toContain(t[3]!.id + ': step s2 does not chain after s1');
  });
  test('set G halves are checked against the gbrain surfaces', () => {
    const g = clone(sets.G);
    g[0]!.target.tool = 'find_orphans';
    g[0]!.acceptable[0]!.tool = 'find_orphans';
    expect(validateSet('G', g, { ladder, surfaces: SYNTHETIC_SURFACES }).problems.join('\n')).toContain('starter half, but find_orphans is not a starter tool');
  });
  test('the schema refuses a malformed item', () => {
    const bad = { ...clone(sets.R[0]!), stratum: 'vague' } as unknown as Item;
    expect(schemaProblems([bad]).length).toBe(1);
    expect(schemaProblems([{ ...clone(sets.T[0]!), fixtures: [sets.T[0]!.fixtures[0]] }]).length).toBe(1);
    const namedDefault = clone(sets.T[0]!);
    namedDefault.fixtures[0]!.id = 'default';
    expect(schemaProblems([namedDefault]).join('\n')).toContain('fixture id default is reserved');
  });
  test('the CLI validates a set file', () => {
    const f = join(tmp, 'set-r.jsonl');
    Bun.write(f, sets.R.map((i) => JSON.stringify(i)).join('\n') + '\n');
    const r = run(['scripts/mcp-at-scale/requests/sets.ts', 'validate', '--set', 'R', '--file', f]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('"capability_only":90');
  });
});

describe('set T fixtures in the catalog host\'s own format', () => {
  test('a chained task fires step by step in catalog-host.ts, and the end-state check reads the fixture ids', async () => {
    const cat = syntheticCatalog();
    const servers = rungServers(cat, '30');
    const args = (server: string, tool: string, value: string) => {
      const t = servers.find((s) => s.server === server)!.tools.find((x) => x.name === tool)!;
      const req = t.inputSchema.required as string[];
      const key = req.find((k) => k !== 'workspace')!;
      return { key, args: Object.fromEntries(req.map((k) => [k, k === 'workspace' ? 'acme' : k === key ? value : 'x'])) };
    };
    const a = servers[0]!, b = servers[1]!;
    const s1 = args(a.server, a.tools[0]!.name, 'START-7'), s2 = args(b.server, b.tools[0]!.name, 'ISS-42');
    const item: TItem = { id: 'syn-t-1', set: 'T', kind: 'tool', text: 'Find START-7 and follow it.', fixtures: [
      { id: 's1', server: a.server, tool: a.tools[0]!.name, match: { [s1.key]: { $ci: 'START-7' } }, result: { json: { next: 'ISS-42' } } },
      { id: 's2', server: b.server, tool: b.tools[0]!.name, match: { [s2.key]: { $ci: 'ISS-42' } }, after: ['s1'], result: { json: { ok: true } } },
    ], end_state: { fired: ['s1', 's2'] }, acceptable: [{ server: b.server, tool: b.tools[0]!.name, required: { [s2.key]: { $ci: 'ISS-42' } } }] };
    expect(schemaProblems([item])).toEqual([]);
    expect(validateT([item], cat.ladder).problems.filter((p) => !p.includes('tasks, the plan has'))).toEqual([]);
    const host = createHost({ servers, log: null, fixtures: { requests: { [item.id]: item.fixtures } }, request: item.id });
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: host.fetch });
    try {
      const call = async (srv: string, name: string, a: Record<string, unknown>) => {
        const c = new Client({ name: 't', version: '1' });
        await c.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:' + server.port + '/mcp/' + srv)));
        const r = await c.callTool({ name, arguments: a });
        await c.close();
        return r;
      };
      const early = await call(b.server, b.tools[0]!.name, s2.args);
      expect(JSON.stringify(early.content)).toContain('No results matched');
      const r1 = await call(a.server, a.tools[0]!.name, s1.args);
      expect(JSON.stringify(r1.content)).toContain('ISS-42');
      await call(b.server, b.tools[0]!.name, s2.args);
    } finally { server.stop(true); }
    const calls = host.lines.filter((l) => l.method === 'tools/call');
    expect(calls.map((l) => l.fixture)).toEqual(['default', 's1', 's2']);
    const outcomes = { request: item.id, kind: 'tool', rung: '30', servers_expected: [], servers_connected: [], servers_missing: [], infra: null, right_tool: true, first_right_call: 2, wrong_tools: [], tool_when_none: null, invalid_calls: 0, reward: 1,
      calls: calls.map((l) => ({ server: l.server, tool: l.tool!, arguments: l.arguments, validation_ok: l.validation?.ok ?? null, fixture: l.fixture ?? null, result_ok: l.ok ?? null })) } as Outcomes;
    const trial = { trial_id: 'x', set: 'T', harness: 'h', model: 'm', arm: 'native', rung: 30, request: item.id, outcomes } as Trial;
    expect(taskSuccess(trial, item)).toBe(1);
    expect(taskSuccess({ ...trial, outcomes: { ...outcomes, calls: outcomes.calls.slice(0, 2) } }, item)).toBe(0);
  });
  test('set T credits a step only for a successful host answer to valid arguments, never a failed call or the neutral default', () => {
    const item = { id: 't1', set: 'T', kind: 'tool', text: '', fixtures: [], end_state: { fired: ['s1', 's2'] }, acceptable: [] } as unknown as TItem;
    const step = (fixture: string, extra: object = {}) => ({ server: 'a', tool: 't', arguments: {}, validation_ok: true, fixture, result_ok: true, ...extra });
    const trial = (calls: object[]) => ({ trial_id: 'x', set: 'T', harness: 'h', model: 'm', arm: 'native', rung: 30, request: 't1',
      outcomes: { request: 't1', kind: 'tool', infra: null, calls } } as unknown as Trial);
    expect(taskSuccess(trial([step('s1'), step('s2')]), item)).toBe(1);
    expect(taskSuccess(trial([step('s1'), step('s2', { result_ok: false })]), item)).toBe(0);
    expect(taskSuccess(trial([step('s1'), step('s2', { validation_ok: null })]), item)).toBe(0);
    expect(taskSuccess(trial([step('s1'), step('s2', { result_ok: undefined })]), item)).toBe(0);
    const named = { ...item, end_state: { fired: ['s1', 'default'] } } as TItem;
    expect(taskSuccess(trial([step('s1'), step('default')]), named)).toBe(0);
  });
});

describe('sealed half', () => {
  test('half of set R is sealed by target, outside the checkout, held by digest', () => {
    const h = halves(sets.R);
    const by = (half: string) => new Set(sets.R.filter((i) => i.kind === 'tool' && h.get(i.id) === half).map((i) => i.target!.server + '/' + i.target!.tool));
    expect(by('public').size).toBe(15);
    expect([...by('public')].some((t) => by('sealed').has(t))).toBe(false);
    const out = join(tmp, 'seal-out'), sealedDir = join(tmp, 'sealed-half');
    const rec = sealSet({ set: 'R', items: sets.R, out, sealedDir });
    expect([rec.rows, rec.public_rows]).toEqual([160, 160]);
    expect(rec.tree_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(rec.row_sha256)).toHaveLength(160);
    expect(readdirSync(out).sort()).toEqual(['set-r-public.jsonl', 'set-r-sealed.json']);
    expect(readFileSync(join(out, 'set-r-public.jsonl'), 'utf8')).not.toContain(sets.R.find((i) => h.get(i.id) === 'sealed')!.text);
    expect(() => sealSet({ set: 'R', items: sets.R, out, sealedDir: join(ROOT, 'tmp-sealed') })).toThrow('inside the checkout');
    expect(existsSync(join(ROOT, 'tmp-sealed'))).toBe(false);
  });
});

describe('author prompts', () => {
  test('one prompt per core tool for set R, plus no-tool and set T prompts, with no unfilled slot', () => {
    const p = authorPrompts(loadCatalog(CATALOG), twins);
    expect(p.filter((x) => x.set === 'R' && x.target)).toHaveLength(30);
    expect(p.filter((x) => x.set === 'R' && !x.target)).toHaveLength(4);
    expect(p.filter((x) => x.set === 'T')).toHaveLength(4);
    expect(p.every((x) => !/\{\{\w+\}\}/.test(x.prompt))).toBe(true);
    const gh = p.find((x) => x.target === 'github/list_issues')!;
    expect(gh.prompt).toContain('gitlab');
    expect(gh.prompt).toContain('3 requests that are **capability-only**');
    expect(authorPrompts(loadCatalog(CATALOG), twins, SYNTHETIC_SURFACES).filter((x) => x.set === 'G').length).toBeGreaterThan(0);
    expect(() => render('{{missing}}', {})).toThrow('has no value');
  });
});

describe('ambiguity audit submitter', () => {
  const items: Item[] = [...sets.R.slice(0, 3), sets.R.find((i) => i.kind === 'none')!, sets.T[0]!];
  test('the dry run writes the batch files with prompt caching and makes no network call', () => {
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => { calls++; throw new Error('network'); }) as unknown as typeof fetch;
    try {
      const out = join(tmp, 'audit-dry');
      const m = writeStage(out, 'label', planStage({ stage: 'label', items, catalogText: catalogListing(loadCatalog(CATALOG)) }));
      expect(calls).toBe(0);
      expect(m.batches.map((b) => [b.provider, b.model, b.requests])).toEqual([['anthropic', 'claude-opus-5-5', 5], ['openai', 'gpt-6-astra', 5]]);
      const ant = readFileSync(join(out, 'label', m.batches[0]!.file), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(ant[0].params.system[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(ant[0].custom_id).toBe(customId('label', items[0]!.id));
      const oai = readFileSync(join(out, 'label', m.batches[1]!.file), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(oai[0].url).toBe('/v1/chat/completions');
      expect(oai[0].body.prompt_cache_key).toMatch(/^he-mcp-audit-/);
      expect(new Set(oai.map((l: { body: { messages: Array<{ content: string }> } }) => l.body.messages[0]!.content)).size).toBe(1);
      expect(m.worst_case_list_usd).toBeGreaterThan(0);
    } finally { globalThis.fetch = real; }
  });
  test('the CLI dry run runs with no keys in its environment', () => {
    const f = join(tmp, 'audit-items.jsonl');
    Bun.write(f, items.map((i) => JSON.stringify(i)).join('\n') + '\n');
    const r = run(['scripts/mcp-at-scale/requests/audit.ts', 'label', '--sets', f, '--catalog', CATALOG, '--out', join(tmp, 'audit-cli'), '--dry-run']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('dry run: no network call made');
    expect(existsSync(join(tmp, 'audit-cli', 'label', 'manifest.json'))).toBe(true);
    expect(existsSync(join(tmp, 'audit-cli', 'label', 'journal.json'))).toBe(false);
  });
  test('submit sends each batch once inside the lane, collect settles from usage, apply widens, drops and keeps twins', async () => {
    const out = join(tmp, 'audit-live');
    const r0 = items[0] as RItem;
    const bait = sets.R.find((i) => i.bait && !items.includes(i))! as RItem;
    expect([(items[1] as RItem).bait, (items[2] as RItem).bait]).toEqual([true, false]);
    const its: Item[] = [...items, bait];
    writeStage(out, 'label', planStage({ stage: 'label', items: its, catalogText: 'catalog' }));
    const reserved: Array<[number, string]> = [], settled: Array<[string, number]> = [];
    const lease: Lease = { reserve: (usd, d) => { reserved.push([usd, d]); return 'res-' + reserved.length; }, settle: (id, a) => { settled.push([id, a?.usd ?? -1]); } };
    const seen: string[] = [];
    const answer = (it: Item) => {
      if (it.id === r0.id) return { no_tool_needed: false, acceptable: [r0.target!.server + '/' + r0.target!.tool, 'gitlab/list_issues'] };
      if (it.id === items[2]!.id) return { no_tool_needed: false, acceptable: ['notion/search'] };
      if (it.id === bait.id) return { no_tool_needed: false, acceptable: [bait.bait_twin + '/x'] };
      return { no_tool_needed: it.set === 'R' && it.kind === 'none', acceptable: it.set === 'T' ? it.fixtures.map((f) => f.server + '/' + f.tool) : it.set === 'R' && it.kind === 'tool' ? [it.target!.server + '/' + it.target!.tool] : [] };
    };
    const byCustom = new Map(its.map((i) => [customId('label', i.id), i]));
    const fake = async (url: string, init?: RequestInit) => {
      seen.push((init?.method ?? 'GET') + ' ' + new URL(url).pathname);
      const json = (x: unknown) => new Response(JSON.stringify(x));
      if (url.endsWith('/v1/messages/batches') && init?.method === 'POST') return json({ id: 'msgbatch_1' });
      if (url.endsWith('/v1/files') && init?.method === 'POST') return json({ id: 'file_in' });
      if (url.endsWith('/v1/batches') && init?.method === 'POST') return json({ id: 'batch_1' });
      if (url.endsWith('/v1/messages/batches/msgbatch_1')) return json({ processing_status: 'ended', results_url: 'https://api.anthropic.com/v1/messages/batches/msgbatch_1/results' });
      if (url.endsWith('/results')) return new Response([...byCustom].map(([cid, it]) => JSON.stringify({ custom_id: cid, result: { type: 'succeeded', message: { content: [{ type: 'text', text: JSON.stringify(answer(it)) }], usage: { input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 50 } } } })).join('\n'));
      if (url.endsWith('/v1/batches/batch_1')) return json({ status: 'completed', output_file_id: 'file_out' });
      if (url.endsWith('/v1/files/file_out/content')) return new Response([...byCustom].map(([cid, it]) => JSON.stringify({ custom_id: cid, response: { status_code: 200, body: { choices: [{ message: { content: JSON.stringify(answer(it)) } }], usage: { prompt_tokens: 1010, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 1000 } } } } })).join('\n'));
      return new Response('no', { status: 404 });
    };
    const lanes: string[] = [];
    const sent = await submitStage({ out, stage: 'label', fetch: fake, lease, inLane: (res, fn) => { lanes.push(res); return fn(); } });
    expect(sent.map((s) => s.batch_id)).toEqual(['msgbatch_1', 'batch_1']);
    expect(lanes).toEqual(['res-1', 'res-2']);
    expect(seen).toEqual(['POST /v1/messages/batches', 'POST /v1/files', 'POST /v1/batches']);
    await expect(submitStage({ out, stage: 'label', fetch: fake, lease })).rejects.toThrow('a batch is sent once');
    const c = await collectStage({ out, stage: 'label', fetch: fake, lease });
    expect(c).toEqual({ settled: 2, open: 0 });
    expect(settled.map((s) => s[0])).toEqual(['res-1', 'res-2']);
    expect(settled.every((s) => s[1] > 0 && s[1] < reserved[0]![0] + reserved[1]![0])).toBe(true);
    const { readAnswers } = await import('../scripts/mcp-at-scale/requests/audit.ts');
    const labels = readAnswers(out, 'label', its);
    const q = auditQueue(its, labels);
    expect(q.queue.map((x) => [x.item, x.tool])).toEqual([[r0.id, 'gitlab/list_issues'], [items[2]!.id, 'notion/search']]);
    expect(q.twin_kept.map((x) => x.item)).toEqual([bait.id]);
    const adj = new Map([[r0.id + '\u0000gitlab/list_issues', new Map([['carbon', { verdict: 'acceptable', required: { query: 'x' } }]])], [items[2]!.id + '\u0000notion/search', new Map([['carbon', { verdict: 'ambiguous' }]])]]) as Map<string, Map<string, unknown>>;
    const a = applyAudit(its, labels, adj);
    expect(a.status[r0.id]).toBe('widened');
    expect(a.status[items[2]!.id]).toBe('dropped');
    expect(a.status[bait.id]).toBe('passed');
    expect(a.status[items[3]!.id]).toBe('passed');
    expect(a.status[sets.T[0]!.id]).toBe('passed');
    expect((a.audited.find((i) => i.id === r0.id) as RItem).acceptable.map((x) => x.server + '/' + x.tool)).toContain('gitlab/list_issues');
    expect(Object.values(a.drops_by_stratum)).toEqual([1]);
    expect(applyAudit(its, labels, new Map()).status[r0.id]).toBe('pending');
    expect(NO_TOOL).toBe('(no tool)');
  });
});

describe('set G prompts and audit listing', () => {
  test('no set G prompt targets request_tools, and prompts carry the synthetic page names and real tool definitions', () => {
    const surfaces = { ...SYNTHETIC_SURFACES, starter: [...SYNTHETIC_SURFACES.starter, 'request_tools'], tools: [{ name: SYNTHETIC_SURFACES.starter[0]!, description: 'Find pages by words.', inputSchema: { type: 'object', required: ['query'] } }], pages: ['companies/heronworks.md'] };
    const g = authorPrompts(loadCatalog(CATALOG), twinsOf(join(CATALOG, 'ladder.json')), surfaces).filter((x) => x.set === 'G');
    expect(g.some((x) => x.target === 'gbrain/request_tools')).toBe(false);
    const first = g.find((x) => x.target === 'gbrain/' + SYNTHETIC_SURFACES.starter[0])!;
    expect(first.prompt).toContain('companies/heronworks.md');
    expect(first.prompt).toContain('Find pages by words.');
  });
  test('the set G audit listing is rung 150 plus every gbrain tool', () => {
    const text = gbrainListing(loadCatalog(CATALOG), [{ name: 'query', description: 'Search the brain.', inputSchema: { type: 'object', required: ['q'] } }]);
    expect(text).toContain('- gbrain/query: Search the brain.; required: q');
    expect(text.split('\n').length).toBe(146);
  });
});

describe('interactive adjudication', () => {
  test('sends each Gemini request once to generateContent, writes answers and a settled journal entry, and refuses a resend', async () => {
    const out = mkdtempSync(join(tmpdir(), 'he-mcp-adj-'));
    try {
      const it = sets.R.find((i) => i.acceptable.length)!;
      writeStage(out, 'adjudicate', planStage({ stage: 'adjudicate', items: [it], catalogText: 'catalog', queue: [{ item: it.id, tool: 'x/y', judges: ['opus'] }] }));
      const urls: string[] = [];
      const fetch = async (url: string) => { urls.push(url); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"verdict":"not_acceptable"}' }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 20 } })); };
      const r = await adjudicateInteractive({ out, fetch });
      expect(r).toMatchObject({ answers: 1, errors: 0 });
      expect(urls).toEqual(['https://generativelanguage.googleapis.com/v1beta/models/gemini-4-carbon:generateContent']);
      expect(readFileSync(join(out, 'adjudicate', 'answers.jsonl'), 'utf8')).toContain('not_acceptable');
      await expect(adjudicateInteractive({ out, fetch })).rejects.toThrow('HE-MCP-025');
      expect(urls.length).toBe(1);
      const out2 = mkdtempSync(join(tmpdir(), 'he-mcp-adj-'));
      try {
        writeStage(out2, 'adjudicate', planStage({ stage: 'adjudicate', items: [it], catalogText: 'catalog', queue: [{ item: it.id, tool: 'x/y', judges: ['opus'] }] }));
        let n = 0;
        const thinking = async () => { n++; return new Response(JSON.stringify(n === 1 ? { candidates: [{ content: { parts: [] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 0, thoughtsTokenCount: 16384 } } : { candidates: [{ content: { parts: [{ text: '{"verdict":"acceptable"}' }] } }] })); };
        await adjudicateInteractive({ out: out2, fetch: thinking });
        writeStage(out2, 'adjudicate', planStage({ stage: 'adjudicate', items: [it], catalogText: 'catalog, again', queue: [{ item: it.id, tool: 'x/y', judges: ['opus'] }] }));
        await adjudicateInteractive({ out: out2, fetch: thinking });
        expect(n).toBe(2);
        expect(readFileSync(join(out2, 'adjudicate', 'answers.jsonl'), 'utf8')).toContain('acceptable');
      } finally { rmSync(out2, { recursive: true, force: true }); }
    } finally { rmSync(out, { recursive: true, force: true }); }
  });
});

describe('set T in the audit', () => {
  test('a tool ruled acceptable for a chained task is listed as an alternative, never added to its acceptable set', () => {
    const t = sets.T[0]!;
    const labels = new Map([[t.id, new Map<string, unknown>([['opus', { no_tool_needed: false, acceptable: ['x/lookup'] }], ['astra', { no_tool_needed: false, acceptable: [] }]])]]);
    const adj = new Map([[t.id + '\u0000x/lookup', new Map<string, unknown>([['carbon', { verdict: 'acceptable', required: null }]])]]);
    const a = applyAudit([t], labels, adj);
    expect(a.status[t.id]).toBe('replace');
    expect(a.t_alternatives[t.id]).toEqual(['x/lookup']);
    expect((a.audited[0] as TItem).acceptable).toEqual(t.acceptable);
  });
  test('an accepted no-tool answer drops a request that needs a tool instead of passing it', () => {
    for (const it of [sets.R.find((i) => i.kind === 'tool')!, sets.T[0]!]) {
      const labels = new Map([[it.id, new Map<string, unknown>([['opus', { no_tool_needed: true, acceptable: [] }], ['astra', { no_tool_needed: false, acceptable: [] }]])]]);
      const adj = new Map([[it.id + '\u0000' + NO_TOOL, new Map<string, unknown>([['carbon', { verdict: 'acceptable', required: null }]])]]);
      const a = applyAudit([it], labels, adj);
      expect(a.status[it.id]).toBe('dropped');
      expect(a.audited).toEqual([]);
      expect(Object.values(a.drops_by_stratum)).toEqual([1]);
    }
  });
});
