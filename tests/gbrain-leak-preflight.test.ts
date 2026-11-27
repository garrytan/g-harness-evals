// internal-task (the gbrain access-leak eval): the open arm's opt-in (gbrain.scope "open"), the byte-identical brain layout of the open
// and member-sources arms, the preregistered surface tool counts (gbrain_surface_tools), and the leak preflight's fail-closed verdicts
// (runner/trial/gbrain-leak-preflight.ts). Keyless: the verdicts run on synthetic observations; the docker-gated block at the end
// runs the real preflight for both arms when HE_GBRAIN_IMAGE names a gbrain image built from this checkout.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { conversationSources, tokenMembers } from '../gbrain/build-brain.ts';
import { leakCellLayoutProblem, loadPrereg, buildManifest, resolveGbrain, type Cell, type Prereg } from '../runner/run.ts';
import { containerScope, sidecarLayout } from '../runner/trial/gbrain.ts';
import { LEAK_CODES, LEAK_PREFLIGHT_SIDECAR, LEAK_RECOVERY, channelCarryProblems, layoutProblem, leakLayout, leakMessage, leakProblems, leakRecordName, leakRecordProblem, leakScript, pageRows, runLeakPreflight, writeCarryProblems, writeLeakRecord, type AskerObservation, type ChannelCarry, type LeakPreflightRecord, type WriteCarry } from '../runner/trial/gbrain-leak-preflight.ts';
import { gbrainUpstream } from '../runner/trial/trial.ts';
import { grantFor } from '../world/services/gbrain-tap.ts';
import { world } from './world-helpers.ts';

const ROOT = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'he-gbrain-leak-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const cell = (gbrain: Cell['gbrain'], id = 'fake-leak'): Cell => ({ id, harness: '_fake', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, gbrain });
function writePrereg(cells: Cell[], runId: string, extra: Partial<Prereg> = {}): string {
  const dir = join(tmp, runId);
  mkdirSync(dir, { recursive: true });
  const p: Prereg = { schema_version: 1, run_id: runId, question: 'leak fixture', tasks: {}, cells, wall_clock_s: { multiuser: 120 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [], ...extra };
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify(p));
  return join(dir, 'prereg.json');
}
const OPEN = { surface: 'starter', brain: 'member', scope: 'open', ingest: 'live' } as const;
const RULES = { surface: 'starter', brain: 'member', scope: 'member-sources', ingest: 'live' } as const;

describe('gbrain.scope "open": the explicit opt-in for live ingestion under the unscoped bot token', () => {
  test('loads only with brain member and ingest live; the record keeps "open"', () => {
    expect(loadPrereg(writePrereg([cell(OPEN)], 'open-ok')).prereg.cells[0]!.gbrain!.scope).toBe('open');
    expect(resolveGbrain(OPEN).scope).toBe('open');
    expect(() => loadPrereg(writePrereg([cell({ surface: 'starter', brain: 'member', scope: 'open' })], 'open-no-ingest'))).toThrow(/HE-GBRAIN-003 .*scope "open" is the opt-in .*needs gbrain.brain "member" and gbrain.ingest "live"/);
    expect(() => loadPrereg(writePrereg([cell({ surface: 'starter', brain: 'company', scope: 'open', ingest: 'live' })], 'open-company'))).toThrow(/HE-GBRAIN-003/);
    expect(() => loadPrereg(writePrereg([cell({ surface: 'starter', scope: 'open' })], 'open-bot-visible'))).toThrow(/HE-GBRAIN-003/);
  });

  test('bot scope with live ingestion and no opt-in still exits HE-GBRAIN-003, naming the opt-in', () => {
    for (const [id, gbrain] of [['live-no-scope', { surface: 'starter', brain: 'member', ingest: 'live' }], ['live-sources', { surface: 'starter', brain: 'member', scope: 'sources', ingest: 'live' }]] as const) {
      expect(() => loadPrereg(writePrereg([cell(gbrain as Cell['gbrain'])], id))).toThrow(/HE-GBRAIN-003 .*ingest "live" needs gbrain.scope "member" or "member-sources".*opts in with gbrain.scope "open"/);
    }
    const r = spawnSync('bun', ['runner/run.ts', 'plan', '--prereg', writePrereg([cell({ surface: 'starter', brain: 'member', ingest: 'live' })], 'live-no-scope-cli')], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^HE-GBRAIN-003 /m);
  });

  test('the open and member-sources cells start the same sidecar apart from the scope, and the container sees scope none', () => {
    const plan = (g: Cell['gbrain']) => sidecarLayout({ split: 'dev', ...resolveGbrain(g!) });
    expect(plan(OPEN)).toEqual(plan(RULES));
    expect(JSON.stringify(plan(OPEN))).toBe(JSON.stringify(plan(RULES)));
    expect(containerScope('open')).toBe('none');
    expect(containerScope('member-sources')).toBe('member-sources');
  });

  test('the world ingest config is the same for both arms; only the token and the grants the tap presents differ', () => {
    const ingest = { tokens: { schema_version: 1, brain: 'member', split: 'dev', sources: { 'private-dana-okafor': 'tok-ingest-a', 'channel-general': 'tok-ingest-b' } }, map: { channels: { C1: 'channel-general' }, dm_source_prefix: 'private-', token_names: ['ingest-private-dana-okafor', 'ingest-channel-general'] } } as never;
    const open = gbrainUpstream({ url: 'http://127.0.0.1:1', token: 'tok-trial', tokens: null, grants: null, ingest });
    const rules = gbrainUpstream({ url: 'http://127.0.0.1:1', token: 'tok-trial', tokens: { members: { 'dana-okafor': 'tok-dana' }, public_only: 'tok-public' } as never, grants: { members: { 'dana-okafor': ['private-dana-okafor', 'channel-general'] }, public: ['channel-general'] }, ingest });
    expect(JSON.stringify(open.ingest)).toBe(JSON.stringify(rules.ingest));
    expect(grantFor(open, 'dana-okafor')).toEqual({ grant: 'bot', token: 'tok-trial' });
    expect(grantFor(open, null)).toEqual({ grant: 'bot', token: 'tok-trial' });
    expect(grantFor(rules, 'dana-okafor')).toEqual({ grant: 'dana-okafor', token: 'tok-dana', sources: ['private-dana-okafor', 'channel-general'] });
  });

  test('leakCellLayoutProblem: matching arms pass, a surface that differs is refused with the recovery line', async () => {
    expect(await leakCellLayoutProblem([cell(OPEN, 'a'), cell(RULES, 'b')])).toBeNull();
    const msg = await leakCellLayoutProblem([cell(OPEN, 'a'), cell({ ...RULES, surface: 'verbs' }, 'b')]);
    expect(msg).toMatch(/open and member-sources cells of split dev would start different gbrain sidecars/);
    expect(msg).toContain(LEAK_RECOVERY);
  });
  test('leakCellLayoutProblem: an install route or channel remember that differs between the arms is refused', async () => {
    expect(await leakCellLayoutProblem([cell({ ...OPEN, install: 'mcp' }, 'a'), cell({ ...RULES, channel_remember: 'member' }, 'b')])).toBeNull();
    expect(await leakCellLayoutProblem([cell(OPEN, 'a'), cell({ ...RULES, install: 'gbrain-installer' }, 'b')])).toMatch(/open and member-sources cells of split dev would start different gbrain sidecars.*"install":"gbrain-installer"/);
  });

  test('leakCellLayoutProblem: arms that match each other but not the sidecar the preflight checks are refused', async () => {
    const msg = await leakCellLayoutProblem([cell({ ...OPEN, surface: 'verbs' }, 'a'), cell({ ...RULES, surface: 'verbs' }, 'b')]);
    expect(msg).toMatch(/^cell a \(scope open\) would start gbrain sidecar .*"HE_GBRAIN_SURFACE":"verbs".*the leak preflight checks only .*"HE_GBRAIN_SURFACE":"starter"/);
    expect(msg).toContain(LEAK_RECOVERY);
    expect(await leakCellLayoutProblem([cell({ ...RULES, embeddings: 'openai:text-embedding-3-small' }, 'b')])).toMatch(/^cell b .*"HE_GBRAIN_EMBEDDINGS":"openai:text-embedding-3-small"/);
  });

  test('the live ingestion writes remember facts over /mcp under the source token, never POST /ingest (which scopes to nobody)', () => {
    const src = readFileSync(join(ROOT, 'world', 'services', 'gbrain-ingest.ts'), 'utf8');
    expect(src).toContain("`${this.o.url}/mcp`");
    expect(src).toContain("name: 'remember'");
    expect(src).toContain('source_id: where.source');
    expect(src).not.toMatch(/\/ingest['`"]/);
  });
});

describe('gbrain_surface_tools: the leak run states the 34-tool starter surface of its gbrain_commit', () => {
  test('accepted beside gbrain_commit and copied into the manifest', () => {
    const loaded = loadPrereg(writePrereg([cell(RULES)], 'tools-ok', { gbrain_commit: '98dda48fb9fd339609d6d4eef009811280ff648d', gbrain_surface_tools: { starter: 34 } }));
    expect(buildManifest(loaded.prereg, loaded.sha256).gbrain_surface_tools).toEqual({ starter: 34 });
  });
});

describe('the leak preflight verdicts', () => {
  const members = tokenMembers(world, 'dev').map((m) => m.id).sort();
  const facts = leakScript(world, conversationSources(world, 'dev'), members, 'abc');
  const [alice, bob] = [members[0]!, members[1]!];
  const grants: Record<string, string[]> = { [alice]: [`private-${alice}`, 'public'], [bob]: [`private-${bob}`, 'public'], 'public-only': ['public'] };
  const pages = Object.fromEntries(facts.map((f) => [f.id, f.kind === 'channel' ? null : { slug: 'memory/unattributed', source_id: f.source }]));
  const tools = (ids: string[]) => ({ search: ids, query: ids, recall: ids, get_page: ids, list_pages: ids, hot_memory: ids });
  const own = (m: string) => facts.filter((f) => f.source === `private-${m}`).map((f) => f.id);
  const obs = (asker: string | null, ids: string[], o: Partial<AskerObservation> = {}): AskerObservation => ({ asker, token: asker ? `member-${asker}` : 'public-only', write_source: asker ? `private-${asker}` : 'public', returned: tools(ids), rows_outside: [], ...o });

  test('the scripted set: one DM per token member, one channel message per reader-set source, a corrected value, unique words', () => {
    expect(facts.filter((f) => f.kind === 'dm').map((f) => f.poster)).toEqual(members);
    const channelSources = new Set(Object.values(conversationSources(world, 'dev')));
    expect(new Set(facts.filter((f) => f.kind === 'channel').map((f) => f.source)).size).toBe(facts.filter((f) => f.kind === 'channel').length);
    for (const f of facts.filter((x) => x.kind === 'channel')) { expect(channelSources.has(f.source)).toBe(true); expect(f.readers).toContain(f.poster); }
    expect(facts.filter((f) => f.kind.startsWith('correction')).map((f) => f.kind)).toEqual(['correction-old', 'correction-new']);
    expect(new Set(facts.map((f) => f.secret)).size).toBe(facts.length);
    for (const f of facts) { expect(f.text).toContain(f.secret); expect(f.query).not.toContain(f.secret.toLowerCase()); }
  });

  test('rules arm: everyone gets exactly their own facts, page-backed ones on get_page and list_pages, write-source ones in hot memory', () => {
    const exact = (m: string) => obs(m, own(m));
    expect(leakProblems('member-sources', facts, pages, grants, [exact(alice), exact(bob), obs(null, [])])).toEqual([]);
  });

  test('rules arm fails closed: another member\'s fact, a missing own fact, a list row outside the grant', () => {
    const leaked = obs(bob, [...own(bob), `dm-${alice}`]);
    const missing = obs(alice, own(alice).filter((id) => id !== `dm-${alice}`));
    const rows = obs(null, [], { rows_outside: [{ slug: 'memory/unattributed', source_id: `private-${alice}` }] });
    const p = leakProblems('member-sources', facts, pages, grants, [leaked, missing, rows]);
    expect(p.filter((x) => x.check === 'other-absent' && x.member === bob && x.fact === `dm-${alice}`).map((x) => x.tool).sort()).toEqual(['get_page', 'hot_memory', 'list_pages', 'query', 'recall', 'search']);
    expect(p.some((x) => x.check === 'own-returned' && x.member === alice && x.fact === `dm-${alice}` && x.tool === 'search')).toBe(true);
    expect(p.some((x) => x.check === 'other-absent' && x.member === 'public-only' && x.tool === 'list_pages' && x.source === `private-${alice}`)).toBe(true);
  });

  test('rules arm: the old half of a correction is not required back, and a database-only fact needs no page read', () => {
    const owner = facts.find((f) => f.kind === 'correction-old')!.poster;
    const ids = own(owner).filter((id) => !id.startsWith('correction-old'));
    expect(leakProblems('member-sources', facts, pages, grants, [obs(owner, ids)]).filter((x) => x.member === owner)).toEqual([]);
    const dbOnly = { ...pages, [`dm-${owner}`]: null };
    const noPage = obs(owner, ids, { returned: { ...tools(ids), get_page: ids.filter((i) => i !== `dm-${owner}`), list_pages: ids.filter((i) => i !== `dm-${owner}`) } });
    expect(leakProblems('member-sources', facts, dbOnly, grants, [noPage]).filter((x) => x.member === owner)).toEqual([]);
  });

  test('open arm: every asker served every fact passes; a fact one asker did not get is a refusal; hot memory is recorded only', () => {
    const all = facts.map((f) => f.id);
    const served = (asker: string | null) => obs(asker, all, { write_source: null, returned: { ...tools(all), hot_memory: [] } });
    expect(leakProblems('open', facts, pages, grants, [served(alice), served(null)])).toEqual([]);
    const thin = obs(bob, all.filter((id) => id !== `dm-${alice}`), { write_source: null });
    const p = leakProblems('open', facts, pages, grants, [thin]);
    expect(p.length).toBeGreaterThan(0);
    expect(p.every((x) => x.check === 'served' && x.fact === `dm-${alice}`)).toBe(true);
  });

  test('write carry (T8): a write that crosses or never lands fails; the writer reading its own writes passes', () => {
    const base: WriteCarry = { writer: alice, writer_token: `member-${alice}`, writes: [{ id: 't8-page', tool: 'put_page', landed: true, slug: 'notes/x', source_id: `private-${alice}`, error: null }, { id: 't8-fact', tool: 'remember', landed: true, slug: null, source_id: null, error: null }], reads: [{ reader: alice, token: `member-${alice}`, write: 't8-page', tools: ['search', 'get_page'] }, { reader: alice, token: `member-${alice}`, write: 't8-fact', tools: ['search'] }, { reader: bob, token: `member-${bob}`, write: 't8-page', tools: [] }, { reader: 'public-only', token: 'public-only', write: 't8-fact', tools: [] }] };
    expect(writeCarryProblems(base)).toEqual([]);
    const crossed = { ...base, reads: base.reads.map((r) => (r.reader === bob ? { ...r, tools: ['get_page' as const, 'list_pages' as const] } : r)) };
    expect(writeCarryProblems(crossed).map((p) => `${p.member}:${p.tool}:${p.fact}`)).toEqual([`${bob}:get_page:notes/x`, `${bob}:list_pages:notes/x`]);
    const lost = { ...base, writes: base.writes.map((w) => (w.id === 't8-fact' ? { ...w, landed: false, error: 'storage_error' } : w)) };
    expect(writeCarryProblems(lost)[0]!.what).toMatch(/did not land \(storage_error\)/);
  });

  test('the refusal names token, member, tool, fact, source, commit, image, fix and the recovery line, and never a token value', () => {
    const p = leakProblems('member-sources', facts, pages, grants, [obs(bob, [...own(bob), `dm-${alice}`])]);
    const msg = leakMessage(LEAK_CODES['member-sources'], { arm: 'member-sources', split: 'dev', image: 'harness-eval/gbrain:x', image_id: 'sha256:abc', commit: '98dda48fb9fd339609d6d4eef009811280ff648d', record: '/r/leak.json', fix: 'scripts/build-gbrain-image.sh --gbrain 98dda48fb9fd339609d6d4eef009811280ff648d --tag harness-eval/gbrain:x' }, p);
    for (const s of ['HE-GBRAIN-017', `token member-${bob}`, `member ${bob}`, 'tool search', `fact dm-${alice}`, `source private-${alice}`, 'gbrain 98dda48fb9fd', 'sha256:abc', 'fix: scripts/build-gbrain-image.sh', LEAK_RECOVERY]) expect(msg).toContain(s);
    expect(msg).not.toMatch(/gbrain_[0-9a-f]{8}/);
  });

  test('the record is refused with a token value in it; run\'s gate wants a passing record on the same image id', () => {
    const rec = { schema_version: 1, arm: 'open', split: 'dev', image: 'img', image_id: 'sha256:1', gbrain_commit: null, ok: true, layout: { sidecar: {}, manifest_sha256: 'm', ingest_tokens_sha256: 'i' }, facts: [], asked: [], write_carry: null, informational: {}, problems: [], summary: { askers: 0, facts: 0, database_only: 0, calls: 0 } } as LeakPreflightRecord;
    const path = join(tmp, 'leak-preflight-open-dev.json');
    expect(() => writeLeakRecord(path, { ...rec, informational: { note: 'gbrain_0123456789abcdef0123' } }, [])).toThrow(/HE-GBRAIN-020 .*would carry a token value/);
    expect(() => writeLeakRecord(path, { ...rec, informational: { note: 'tok-secret-value' } }, ['tok-secret-value'])).toThrow(/would carry a token value/);
    expect(leakRecordProblem(path, 'open', 'dev', 'img', 'sha256:1')).toMatch(/no leak preflight record/);
    writeLeakRecord(path, rec, ['tok-secret-value']);
    expect(leakRecordProblem(path, 'open', 'dev', 'img', 'sha256:1')).toBeNull();
    expect(leakRecordProblem(path, 'open', 'dev', 'img', 'sha256:2')).toMatch(/passed on image id sha256:1, the run uses img sha256:2.*no trial ran, no side effects, rerun the preflight/);
    expect(leakRecordProblem(path, 'member-sources', 'dev', 'img', 'sha256:1')).toMatch(/is for scope open/);
    writeLeakRecord(path, { ...rec, ok: false }, []);
    expect(leakRecordProblem(path, 'open', 'dev', 'img', 'sha256:1')).toMatch(/did not pass/);
  });

  test('layoutProblem: the two arms must have served the same manifest and ingest tokens', () => {
    const a = { split: 'dev' as const, image: 'img', image_id: 'sha256:1', gbrain_commit: 'c', layout: { sidecar: { HE_GBRAIN_BRAIN: 'member' }, manifest_sha256: 'm', ingest_tokens_sha256: 'i' } };
    expect(layoutProblem(a, { layout: { ...a.layout } })).toBeNull();
    expect(layoutProblem(a, { layout: { ...a.layout, ingest_tokens_sha256: 'j' } })).toMatch(/ingest_tokens_sha256 differ.*rerun the preflight/);
  });
});

describe('always-on-week Amendment 1: the leak preflight under channel_remember "conversation"; the default is unchanged', () => {
  test('the default record layout and file name are byte-identical to what the preflight wrote before the option existed', () => {
    const before = { sidecar: sidecarLayout({ split: 'dev', ...LEAK_PREFLIGHT_SIDECAR }), manifest_sha256: 'm', ingest_tokens_sha256: 'i' };
    expect(JSON.stringify(leakLayout('dev', 'm', 'i'))).toBe(JSON.stringify(before));
    expect(JSON.stringify(leakLayout('dev', 'm', 'i', 'member'))).toBe(JSON.stringify(before));
    expect(JSON.stringify(leakLayout('dev', 'm', 'i', 'conversation'))).toBe(JSON.stringify({ ...before, channel_remember: 'conversation' }));
    for (const arm of ['open', 'member-sources'] as const) expect(leakRecordName(arm, 'dev')).toBe(`leak-preflight-${arm}-dev.json`);
    expect(leakRecordName('member-sources', 'dev', 'member')).toBe('leak-preflight-member-sources-dev.json');
    expect(leakRecordName('member-sources', 'dev', 'conversation')).toBe('leak-preflight-member-sources-dev-conversation.json');
  });

  test('leakCellLayoutProblem: a conversation rules cell is now checked, not refused; any other difference still is', async () => {
    expect(await leakCellLayoutProblem([cell(RULES, 'b')])).toBeNull();
    expect(await leakCellLayoutProblem([cell({ ...RULES, channel_remember: 'conversation' }, 'b')])).toBeNull();
    expect(await leakCellLayoutProblem([cell({ ...RULES, channel_remember: 'conversation', surface: 'verbs' }, 'b')])).toMatch(/^cell b .*"HE_GBRAIN_SURFACE":"verbs".*"channel_remember":"conversation".*checks only .*"HE_GBRAIN_SURFACE":"starter".*"channel_remember":"conversation"/);
    expect(await leakCellLayoutProblem([cell(OPEN, 'a'), cell({ ...RULES, channel_remember: 'conversation' }, 'b')])).toMatch(/open and member-sources cells of split dev would start different gbrain sidecars/);
  });

  test('run\'s gate wants the record of the cell\'s own channel remember', () => {
    const rec = { schema_version: 1, arm: 'member-sources', split: 'dev', image: 'img', image_id: 'sha256:1', gbrain_commit: null, ok: true, layout: leakLayout('dev', 'm', 'i'), facts: [], asked: [], write_carry: null, informational: {}, problems: [], summary: { askers: 0, facts: 0, database_only: 0, calls: 0 } } as LeakPreflightRecord;
    const member = join(tmp, leakRecordName('member-sources', 'dev'));
    const conv = join(tmp, leakRecordName('member-sources', 'dev', 'conversation'));
    writeLeakRecord(member, rec, []);
    writeLeakRecord(conv, { ...rec, layout: leakLayout('dev', 'm', 'i', 'conversation') }, []);
    expect(leakRecordProblem(member, 'member-sources', 'dev', 'img', 'sha256:1')).toBeNull();
    expect(leakRecordProblem(conv, 'member-sources', 'dev', 'img', 'sha256:1', 'conversation')).toBeNull();
    expect(leakRecordProblem(member, 'member-sources', 'dev', 'img', 'sha256:1', 'conversation')).toMatch(/checked channel remember member, the cell runs conversation.*rerun the preflight/);
    expect(leakRecordProblem(conv, 'member-sources', 'dev', 'img', 'sha256:1')).toMatch(/checked channel remember conversation, the cell runs member/);
  });

  test('channelCarryProblems: the channel write reaches exactly its source\'s readers', () => {
    const base: ChannelCarry = { writer: 'ana', writer_token: 'member-ana', channel: 'C1', source: 'channel-ops', readers: ['ana', 'ben'], write: { landed: true, landed_in: ['channel-ops'], pages: [{ slug: 'notes/ops', source_id: 'channel-ops' }], error: null, inconclusive: [] }, reads: [
      { reader: 'ana', token: 'member-ana', tools: ['search', 'recall', 'get_page'], inconclusive: [] }, { reader: 'ben', token: 'member-ben', tools: ['search'], inconclusive: [] }, { reader: 'cal', token: 'member-cal', tools: [], inconclusive: [] }, { reader: 'public-only', token: 'public-only', tools: [], inconclusive: [] },
    ] };
    expect(channelCarryProblems(base)).toEqual([]);
    const leak = channelCarryProblems({ ...base, reads: base.reads.map((r) => r.reader === 'cal' ? { ...r, tools: ['search', 'hot_memory'] } : r) });
    expect(leak.map((p) => [p.check, p.member, p.tool])).toEqual([['write-carry', 'cal', 'search'], ['write-carry', 'cal', 'hot_memory']]);
    expect(channelCarryProblems({ ...base, reads: base.reads.map((r) => r.reader === 'ben' ? { ...r, tools: [] } : r) }).map((p) => [p.check, p.member])).toEqual([['own-returned', 'ben']]);
    const onlyPage = channelCarryProblems({ ...base, reads: base.reads.map((r) => r.reader === 'public-only' ? { ...r, tools: ['get_page'] } : r) });
    expect(onlyPage.map((p) => [p.check, p.member, p.tool])).toEqual([['write-carry', 'public-only', 'get_page']]);
    expect(channelCarryProblems({ ...base, write: { ...base.write, landed_in: ['private-ana'] } }).map((p) => p.what)).toEqual([expect.stringMatching(/landed in private-ana, not only in the channel's source channel-ops/)]);
    expect(channelCarryProblems({ ...base, write: { ...base.write, landed_in: ['channel-ops', 'channel-ops-leads'] } }).map((p) => p.what)).toEqual([expect.stringMatching(/landed in channel-ops-leads/)]);
    expect(channelCarryProblems({ ...base, write: { ...base.write, landed_in: [] } }).map((p) => p.what)).toEqual([expect.stringMatching(/in no source the unscoped token reads/)]);
    expect(channelCarryProblems({ ...base, reads: base.reads.map((r) => r.reader === 'cal' ? { ...r, inconclusive: ['get_page'] } : r) }).map((p) => [p.check, p.member, p.tool])).toEqual([['probe', 'cal', 'get_page']]);
    expect(channelCarryProblems({ ...base, write: { landed: false, landed_in: [], pages: [], error: 'permission_denied', inconclusive: [] } })).toHaveLength(1);
    expect(channelCarryProblems({ ...base, write: { ...base.write, inconclusive: ['list_pages offset 0'] } }).map((p) => [p.check, p.token, p.what])).toEqual([['probe', 'unscoped', expect.stringMatching(/unscoped list_pages offset 0 call .* not fully known/)]]);
  });
});

// ---- docker-gated: the real preflight on an image built from this checkout -------------------------------------------------
const IMAGE = process.env.HE_GBRAIN_IMAGE;
const haveImage = !!IMAGE && spawnSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' }).status === 0;
describe.skipIf(!haveImage)(`the leak preflight on ${IMAGE ?? '(HE_GBRAIN_IMAGE unset)'}`, () => {
  test('both arms pass on dev, serve the same brain layout, and record the informational probes', async () => {
    const records: LeakPreflightRecord[] = [];
    for (const arm of ['open', 'member-sources'] as const) {
      const path = join(tmp, `real-${arm}.json`);
      const { record, secrets } = await runLeakPreflight({ image: IMAGE!, split: 'dev', arm, worldPath: join(ROOT, 'world', 'seed', 'world.json'), record: path });
      writeLeakRecord(path, record, secrets);
      expect(record.problems).toEqual([]);
      expect(record.summary.askers).toBe(tokenMembers(world, 'dev').length + 1);
      expect(Object.keys(record.informational)).toEqual(expect.arrayContaining(['write_carry_member_only', 'write_carry_attested_actor']));
      records.push(record);
    }
    expect(layoutProblem(records[0]!, records[1]!)).toBeNull();
    // open: every member asker got every scripted fact back through search; rules: nobody got another member's DM.
    expect(records[0]!.asked.every((a) => a.returned.search.length >= records[0]!.facts.length - 1)).toBe(true);
    expect(records[1]!.write_carry!.reads.filter((r) => r.reader !== records[1]!.write_carry!.writer).every((r) => r.tools.length === 0)).toBe(true);
    for (const r of records) { expect('channel_carry' in r).toBe(false); expect('channel_remember' in r.layout).toBe(false); }
  }, 1_800_000);

  test('the rules arm passes under channel_remember "conversation", with the channel write reaching only its readers', async () => {
    const path = join(tmp, 'real-member-sources-conversation.json');
    const { record, secrets } = await runLeakPreflight({ image: IMAGE!, split: 'dev', arm: 'member-sources', worldPath: join(ROOT, 'world', 'seed', 'world.json'), record: path, channelRemember: 'conversation' });
    writeLeakRecord(path, record, secrets);
    expect(record.problems).toEqual([]);
    expect(record.layout.channel_remember).toBe('conversation');
    const c = record.channel_carry!;
    expect(c.write.landed_in).toEqual([c.source]);
    expect(c.reads.filter((r) => c.readers.includes(r.reader)).every((r) => r.tools.includes('search'))).toBe(true);
    expect(c.reads.filter((r) => !c.readers.includes(r.reader)).every((r) => r.tools.length === 0)).toBe(true);
  }, 1_800_000);
});


describe('Amendment 1 (2026-11-22): an unverified page listing fails the preflight', () => {
  test('a missing reply, an error reply or a reply with no JSON array throws; an empty array is a real empty listing', () => {
    const fail = (what: string) => new Error(what);
    expect(() => pageRows(null, fail)).toThrow(/gave no list_pages reply/);
    expect(() => pageRows({ isError: true, content: [{ type: 'text', text: '[]' }] }, fail)).toThrow(/answered list_pages with an error/);
    expect(() => pageRows({ content: [{ type: 'text', text: 'no pages for you' }] }, fail)).toThrow(/no page listing/);
    expect(() => pageRows({ content: [{ type: 'text', text: '[not json' }] }, fail)).toThrow(/no page listing/);
    expect(pageRows({ content: [{ type: 'text', text: '[]' }] }, fail)).toEqual([]);
    const denied = { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'permission_denied', code: 'permission_denied', message: 'Requested source is outside your granted sources' }) }] };
    let refusals = 0;
    expect(pageRows(denied, fail, () => { refusals++; })).toEqual([]);
    expect(refusals).toBe(1);
    expect(() => pageRows(denied, fail)).toThrow(/answered list_pages with an error \(.*permission_denied/);
    expect(() => pageRows({ isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'internal_error' }) }] }, fail, () => { refusals++; })).toThrow(/answered list_pages with an error/);
    expect(refusals).toBe(1);
    expect(pageRows({ content: [{ type: 'text', text: JSON.stringify([{ slug: 'notes/a', source_id: 'private-dana' }]) }] }, fail)).toEqual([{ slug: 'notes/a', source_id: 'private-dana' }]);
  });

  test('a failed list_pages check names only the error code, never the upstream error text', () => {
    const fail = (what: string) => new Error(what);
    const upstream = ['connect to postgres://brain', ':hunter2', '@10.0.0.7/gbrain failed; Authorization: Bear', 'er gbrain', '_0123456789abcdef0123'].join('');
    const message = (result: Record<string, unknown>) => { try { pageRows(result, fail); } catch (e) { return (e as Error).message; } return 'no refusal'; };
    const coded = message({ isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'internal_error', message: upstream }) }] });
    expect(coded).toContain('answered list_pages with an error (code internal_error; the reply text is withheld');
    const bare = message({ isError: true, content: [{ type: 'text', text: upstream }] });
    expect(bare).toContain('(code none stated;');
    for (const m of [coded, bare]) for (const part of ['hunter2', 'postgres://', 'Bearer', 'gbrain_0123', '10.0.0.7']) expect(m).not.toContain(part);
  });
});
