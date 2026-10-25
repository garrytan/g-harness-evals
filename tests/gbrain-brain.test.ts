// The brain builder's page lists (gbrain/build-brain.ts). Bot-visible: exactly the slice of the world the bot can
// already read, so that brain changes retrieval and not information access (docs/gbrain-arm.md). Company (internal-task):
// every record of the split, one source per reader set, one token per member granted its sources.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildBrain, companyGrants, companyPageList, companySources, keylessEnv, memberReadsFile, pageList, SOURCE_ID_RE, sourceIdFor, tokenMembers, type CompanyBrainManifest } from '../gbrain/build-brain.ts';
import { canReadFile } from '../runner/grade/predicates.ts';
import { savedFactsOf } from '../world/services/gbrain-tap.ts';
import { world } from './world-helpers.ts';

test('held-out: the 7 channel pages and 18 public files, no DM page, no team or private file', () => {
  const pages = pageList(world, 'heldout');
  expect(pages.filter((p) => p.kind === 'channel').length).toBe(7);
  expect(pages.filter((p) => p.kind === 'file').length).toBe(18);
  for (const p of pages) expect(p.page_slug).toBe(`heldout/${p.slug}`);
  const dmSlugs = world.channels.filter((c) => c.kind === 'dm').flatMap((c) => c.source_slugs);
  for (const s of dmSlugs) expect(pages.some((p) => p.slug === s)).toBe(false);
  const nonPublic = world.files.filter((f) => f.visibility !== 'public').map((f) => f.slug);
  for (const s of nonPublic) expect(pages.some((p) => p.slug === s)).toBe(false);
  expect(pages.some((p) => p.slug === 'chats/coastal-team-banter')).toBe(true);
  expect(pages.some((p) => p.slug === 'agent-notes/strategic-cheatsheet')).toBe(true);
  expect(new Set(pages.map((p) => p.page_slug)).size).toBe(pages.length);
});

test('dev: 7 channel pages and 11 public files', () => {
  const pages = pageList(world, 'dev');
  expect(pages.filter((p) => p.kind === 'channel').length).toBe(7);
  expect(pages.filter((p) => p.kind === 'file').length).toBe(11);
  expect(pages.some((p) => p.slug === 'chats/2026-04-23-marrow-renewal-chat')).toBe(false);
});

test('the bot-visible page list is unchanged by the company brain (pinned digest)', () => {
  // The gbrain arm's image manifests were built from this list; a change here is a new pin for that arm too.
  expect(pageList(world, 'heldout').map((p) => p.page_slug).join('\n')).toMatchSnapshot();
  expect(pageList(world, 'dev').map((p) => p.page_slug).join('\n')).toMatchSnapshot();
});

test('the environment gbrain runs in carries no provider key', () => {
  const env = keylessEnv('/tmp/x');
  for (const k of Object.keys(env)) expect(k).not.toMatch(/API_KEY|_KEY$|TOKEN|SECRET/);
  expect(env.GBRAIN_HOME).toBe('/tmp/x');
  expect(env.HOME).toBe('/tmp/x');
});

describe('company brain page list', () => {
  const heldout = companyPageList(world, 'heldout');
  const dev = companyPageList(world, 'dev');
  const count = (pages: typeof heldout, kind: string) => pages.filter((p) => p.kind === kind).length;

  test('held-out: 108 pages of every kind, slugs <split>/<corpus slug>, no two alike', () => {
    expect(heldout.length).toBe(108);
    expect({ channel: count(heldout, 'channel'), dm: count(heldout, 'dm'), contract: count(heldout, 'contract'), ticket: count(heldout, 'ticket'), crm: count(heldout, 'crm'), profile: count(heldout, 'profile'), update: count(heldout, 'update'), digest: count(heldout, 'digest'), note: count(heldout, 'note'), email: count(heldout, 'email'), meeting: count(heldout, 'meeting') })
      .toEqual({ channel: 7, dm: 0, contract: 20, ticket: 4, crm: 8, profile: 8, update: 10, digest: 14, note: 6, email: 21, meeting: 10 });
    for (const p of heldout) expect(p.page_slug).toBe(`heldout/${p.slug}`);
    expect(new Set(heldout.map((p) => p.page_slug)).size).toBe(108);
    const botVisible = new Set(pageList(world, 'heldout').map((p) => p.page_slug));
    for (const s of botVisible) expect(heldout.some((p) => p.page_slug === s)).toBe(true);
  });

  test('dev: 118 pages including the two DM pages and the three private notes', () => {
    expect(dev.length).toBe(118);
    expect(count(dev, 'dm')).toBe(2);
    expect(dev.filter((p) => p.kind === 'note' && p.visibility === 'private').length).toBe(3);
    expect(count(dev, 'email')).toBe(21);
    expect(count(dev, 'meeting')).toBe(10);
  });

  test('readers follow the world rule for every record kind', () => {
    for (const p of [...heldout, ...dev]) {
      const split = p.page_slug.startsWith('dev/') ? 'dev' : 'heldout';
      const loadedMembers = world.members.filter((m) => m.split === 'both' || m.split === split);
      if (p.kind === 'channel' || p.kind === 'dm') {
        const c = world.channels.find((c) => c.id === p.world_id)!;
        expect(p.readers).toEqual([...new Set(c.members)].sort());
      } else if (p.kind === 'email') {
        const m = world.mail.find((m) => m.id === p.world_id)!;
        expect(p.readers).toEqual([...new Set(m.mailbox_members)].sort());
      } else if (p.kind === 'meeting') {
        const e = world.calendar.find((e) => e.id === p.world_id)!;
        expect(p.readers).toEqual([...new Set([e.organizer, ...e.attendees])].sort());
      } else {
        const f = world.files.find((f) => f.id === p.world_id)!;
        expect(p.readers).toEqual(loadedMembers.filter((m) => canReadFile(m, f)).map((m) => m.id).sort());
        for (const m of loadedMembers) expect(memberReadsFile(m, f)).toBe(canReadFile(m, f));
      }
      expect(p.readers.length).toBeGreaterThan(0);
    }
  });

  test('source ids: public, private-<member>, team-<short>, team-<short>-members, channel-<name>, readers-<hash>; all within gbrain\'s rule', () => {
    for (const p of [...heldout, ...dev]) expect(p.source).toMatch(SOURCE_ID_RE);
    const bySource = (pages: typeof heldout) => Object.fromEntries([...new Set(pages.map((p) => p.source))].map((s) => [s, pages.filter((p) => p.source === s).length]));
    const h = bySource(heldout);
    expect(h.public).toBe(18);
    expect(h['team-coastal']).toBe(33);
    expect(h['team-strategic']).toBe(17);
    expect(h['team-coastal-members']).toBe(6);
    expect(h['channel-inc-vtg-hartford']).toBe(1);
    expect(h['private-ruth-calloway']).toBe(3);
    expect(h['private-bettina-kroll']).toBe(1);
    expect(Object.keys(h).length).toBe(28);
    expect(Object.keys(bySource(dev)).length).toBe(28);
    const everyone = world.members.filter((m) => m.split !== 'dev').map((m) => m.id);
    expect(sourceIdFor(world, 'heldout', everyone)).toBe('public');
    expect(sourceIdFor(world, 'heldout', ['kwame-adjei'])).toBe('private-kwame-adjei');
    expect(sourceIdFor(world, 'heldout', ['kwame-adjei', 'ruth-calloway'])).toMatch(/^readers-[0-9a-f]{8}$/);
    const privateNote = heldout.find((p) => p.slug === 'notes/2025-08-08-ruth-private-orlavine')!;
    expect(privateNote.visibility).toBe('private');
    expect(privateNote.source).toBe('private-ruth-calloway');
    expect(privateNote.readers).toEqual(['ruth-calloway']);
  });

  test('sources and grants: every member token reads exactly the sources whose readers include it and writes to private-<member>', () => {
    const sources = companySources(world, 'heldout', heldout);
    expect(sources.length).toBe(39);
    expect(sources.filter((s) => s.pages === 0).map((s) => s.id).every((id) => id.startsWith('private-'))).toBe(true);
    const grants = companyGrants(world, 'heldout', sources);
    const members = tokenMembers(world, 'heldout');
    expect(members.length).toBe(15);
    expect(grants.length).toBe(16);
    for (const g of grants) {
      if (g.member === 'public-only') { expect(g.sources).toEqual(['public']); continue; }
      expect(g.write).toBe(`private-${g.member}`);
      expect(g.sources[0]).toBe(g.write);
      for (const s of sources) expect(g.sources.includes(s.id)).toBe(s.readers.includes(g.member));
      for (const p of heldout) expect(g.sources.includes(p.source)).toBe(p.readers.includes(g.member));
    }
    const kwame = grants.find((g) => g.member === 'kwame-adjei')!;
    expect(kwame.sources).toContain('team-coastal');
    expect(kwame.sources).not.toContain('team-strategic');
    expect(kwame.sources).not.toContain('private-ruth-calloway');
    const ruth = grants.find((g) => g.member === 'ruth-calloway')!;
    expect(ruth.sources).toContain('team-coastal');
    expect(ruth.sources).toContain('team-strategic');
    expect(ruth.sources).not.toContain('private-bettina-kroll');
  });
});

// A real keyless build and serve against a local gbrain checkout at the pinned commit and the corpus checkout
// (skipped when either is absent; the Dockerfile runs the same build). Proves what the company-brain run rests on:
// a token with no source grant reads every source, a member token reads only its granted sources, a page outside
// the grant is not found, and visibility: private pages are served under GBRAIN_REMOTE_PRIVATE_PAGES=1.
const gbrainCli = process.env.GBRAIN_CLI ?? join(homedir(), '.capy/work/harness-eval/gbrain-431/src/cli.ts');
const corpus = process.env.MESSY_COMPANY_V1 ?? join(homedir(), '.capy/work/harness-eval/gbrain-evals/eval/data/messy-company-v1');
const live = existsSync(gbrainCli) && existsSync(join(corpus, 'corpus', 'heldout')) && process.env.HE_GBRAIN_BUILD_TEST === '1';

describe.skipIf(!live)('company brain built and served keyless at the pin (HE_GBRAIN_BUILD_TEST=1)', () => {
  const out = join('/tmp', `he-company-brain-${process.pid}`);
  let manifest: CompanyBrainManifest;
  let tokens: { members: Record<string, string>; public_only: string };
  let server: ReturnType<typeof Bun.spawn>;
  let bot: string;
  const port = 3100 + (process.pid % 800);
  const env = (extra: Record<string, string> = {}) => ({ ...keylessEnv(out), ...extra });
  const call = async (token: string, name: string, args: Record<string, unknown>) => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    const text = await res.text();
    const data = text.split('\n').find((l) => l.startsWith('data:'))?.slice(5) ?? text;
    const msg = JSON.parse(data) as { result?: { content?: Array<{ text?: string }>; isError?: boolean } };
    const body = msg.result?.content?.[0]?.text ?? '';
    const slugs = [...body.matchAll(/"slug":"([^"]+)"/g)].map((m) => m[1]!);
    return { isError: msg.result?.isError === true, body, slugs: [...new Set(slugs)], result: (msg.result ?? {}) as Record<string, unknown> };
  };
  // What the tap records for a reply: the JSON payloads and the saved facts read the way world/services/gbrain-tap.ts reads them (internal-task).
  const factsOf = (result: Record<string, unknown>) => {
    const payloads = (Array.isArray(result.content) ? result.content as Array<{ text?: string }> : []).flatMap((c) => { const t = (c.text ?? '').trim(); if (!t.startsWith('{') && !t.startsWith('[')) return []; try { return [JSON.parse(t)]; } catch { return []; } });
    return savedFactsOf(result, payloads);
  };

  test('build: 108 pages, 39 sources, 16 tokens, tokens.json mode 0600', () => {
    manifest = buildBrain({ split: 'heldout', brain: 'company', corpus: join(corpus, 'corpus'), worldPath: join(import.meta.dir, '..', 'world', 'seed', 'world.json'), out, staging: `${out}-staging`, gbrain: ['bun', gbrainCli], commit: 'test', corpusCommit: 'test', corpusRepo: 'test', log: () => undefined }) as CompanyBrainManifest;
    expect(manifest.schema_version).toBe(2);
    expect(manifest.counts.total).toBe(108);
    expect(manifest.sources.length).toBe(39);
    expect(manifest.grants.length).toBe(16);
    expect(JSON.stringify(manifest)).not.toMatch(/gbrain_[0-9a-f]{20}/);
    tokens = JSON.parse(readFileSync(join(out, 'tokens.json'), 'utf8'));
    expect(statSync(join(out, 'tokens.json')).mode & 0o777).toBe(0o600);
    expect(Object.keys(tokens.members).length).toBe(15);
    spawnSync('rm', ['-rf', `${out}-staging`]);
  }, 300_000);

  test('serve: unscoped token reads every source, member tokens read only their grants, private pages served', async () => {
    const created = spawnSync('bun', [gbrainCli, 'auth', 'create', 'trial-test'], { env: env(), encoding: 'utf8' });
    bot = /gbrain_[0-9a-f]+/.exec(created.stdout + created.stderr)![0];
    server = Bun.spawn(['bun', gbrainCli, 'serve', '--http', '--port', String(port), '--bind', '127.0.0.1', '--surface', 'starter', '--suppress-bootstrap-token'], { env: env({ GBRAIN_ADMIN_BOOTSTRAP_TOKEN: 'a'.repeat(64), GBRAIN_HTTP_RATE_LIMIT_IP: '1000000', GBRAIN_HTTP_RATE_LIMIT_TOKEN: '1000000', GBRAIN_REMOTE_PRIVATE_PAGES: '1' }), stdout: 'ignore', stderr: 'ignore' });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* starting */ } await Bun.sleep(250); }
    const kwame = tokens.members['kwame-adjei']!, ruth = tokens.members['ruth-calloway']!;
    const ruthNote = 'heldout/notes/2025-08-08-ruth-private-orlavine';
    const botSearch = await call(bot, 'search', { query: 'saltmarsh', limit: 20 });
    expect(botSearch.slugs.length).toBeGreaterThan(5);
    for (const s of botSearch.slugs) expect(s).toMatch(/^heldout\//);
    const kinds = new Set(botSearch.slugs.map((s) => manifest.pages.find((p) => p.page_slug === s)?.kind));
    expect(kinds.has('contract') || kinds.has('crm')).toBe(true);
    expect(kinds.has('email')).toBe(true);
    expect((await call(bot, 'get_page', { slug: ruthNote })).slugs).toContain(ruthNote);
    expect((await call(ruth, 'get_page', { slug: ruthNote })).slugs).toContain(ruthNote);
    const denied = await call(kwame, 'get_page', { slug: ruthNote });
    expect(denied.isError).toBe(true);
    expect(denied.body).toContain('page_not_found');
    const deniedNamed = await call(kwame, 'get_page', { slug: ruthNote, source_id: 'private-ruth-calloway' });
    expect(deniedNamed.body).toContain('permission_denied');
    const kwameSearch = await call(kwame, 'search', { query: 'saltmarsh', limit: 20 });
    for (const s of kwameSearch.slugs) expect(manifest.pages.find((p) => p.page_slug === s)!.readers).toContain('kwame-adjei');
    const pub = await call(tokens.public_only, 'search', { query: 'saltmarsh', limit: 20 });
    expect(pub.slugs.length).toBeGreaterThan(0);
    for (const s of pub.slugs) expect(manifest.pages.find((p) => p.page_slug === s)!.source).toBe('public');
    const ruthSearch = await call(ruth, 'search', { query: 'comp conversation Nadia', limit: 10 });
    expect(ruthSearch.slugs).toContain(ruthNote);
    const kwameSearch2 = await call(kwame, 'search', { query: 'comp conversation Nadia', limit: 10 });
    expect(kwameSearch2.slugs).not.toContain(ruthNote);
    for (const p of manifest.pages) expect(p.page_slug).toMatch(/^heldout\/[a-z0-9-]+\/[a-z0-9-]+$/);
  }, 120_000);

  // internal-task: a member's remember lands in private-<member>; recall under the same token returns it in facts, search carries it in
  // the saved-facts block and _meta.retrieval.saved_facts (which the tap now reads), another member's token never sees it, and the
  // unscoped bot token does. The fresh brain carries no fact before the write.
  test('serve: remember under a member token persists to that member\'s source and no other member sees it', async () => {
    const kwame = tokens.members['kwame-adjei']!, ruth = tokens.members['ruth-calloway']!;
    const fact = 'Test fact: Driftmoor berth slot moved to Thursday';
    const before = await call(bot, 'recall', { query: 'Driftmoor berth slot', limit: 5 });
    expect(factsOf(before.result)).toEqual([]);
    expect(factsOf((await call(bot, 'search', { query: 'Driftmoor', limit: 5 })).result)).toEqual([]);
    const written = await call(kwame, 'remember', { fact, entity: 'Driftmoor Marine Freight', provenance: 'test' });
    expect(written.isError).toBe(false);
    expect(JSON.parse(written.body).status).toBe('inserted');
    const mine = factsOf((await call(kwame, 'recall', { query: 'Driftmoor berth slot', limit: 5 })).result);
    expect(mine.map((f) => f.fact)).toContain(fact);
    expect(mine.find((f) => f.fact === fact)!.source_id).toBe('private-kwame-adjei');
    const searched = await call(kwame, 'search', { query: 'Driftmoor berth slot', limit: 5 });
    expect(factsOf(searched.result).map((f) => f.fact)).toContain(fact);
    expect(searched.slugs).not.toContain(fact);
    expect(factsOf((await call(ruth, 'recall', { query: 'Driftmoor berth slot', limit: 5 })).result)).toEqual([]);
    expect(factsOf((await call(ruth, 'search', { query: 'Driftmoor berth slot', limit: 5 })).result)).toEqual([]);
    expect(factsOf((await call(tokens.public_only, 'search', { query: 'Driftmoor berth slot', limit: 5 })).result)).toEqual([]);
    expect(factsOf((await call(bot, 'recall', { query: 'Driftmoor berth slot', limit: 5 })).result).map((f) => f.fact)).toContain(fact);
  }, 120_000);

  test('teardown', () => {
    server?.kill();
    spawnSync('rm', ['-rf', out]);
  });
});
