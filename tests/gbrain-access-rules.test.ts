// internal-task (the access-rules rerun): the member brain gated by gbrain folder rules and member-bound tokens. The build is run
// against a gbrain stand-in that records its argv (rules per source, members, bindings, no --sources on a member token), the
// cell validation refuses access "rules" off the member brain and member scope, the preflight verdict fails closed on each of
// its three checks, and the ladder pairs installer-acl with told-acl. The stand-in runs under buildBrain's keyless allowlist
// environment (keylessEnv), never a login shell.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildBrain, memberPageList, memberSources, tokenMembers, type CompanyBrainManifest } from '../gbrain/build-brain.ts';
import { loadPrereg, type Cell, type Prereg } from '../runner/run.ts';
import { accessPreflightProblem, accessRulesProblems, writeAccessPreflight, type AccessRulesEvidence, type AccessRulesExpected } from '../runner/trial/gbrain.ts';
import { ladderPairs, rungOf } from '../scripts/gbrain-ladder.ts';
import { world } from './world-helpers.ts';

const ROOT = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'he-gbrain-acl-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// ---- the build, against a stand-in --------------------------------------------------------------------------------------

/** A gbrain stand-in: appends each argv (and the names of any key-like variables it was given, never a value) to argvLog, and
 *  answers the way gbrain 0.60.554.0 does for the commands the scoped build runs. With refuse "gst363" it also refuses an
 *  auth create bound to nobody once a member exists, the way gbrain with internal-task does, unless it carries --reads-unscoped;
 *  with refuse "always" it refuses that create even then. */
function writeStandIn(dir: string, argvLog: string, refuse: 'none' | 'gst363' | 'always' = 'none'): string {
  const path = join(dir, 'gbrain-standin.ts');
  writeFileSync(path, `import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const argv = process.argv.slice(2);
const keyish = Object.keys(process.env).filter((k) => /KEY|SECRET|TOKEN/.test(k));
appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify({ argv, keyish }) + '\\n');
const count = (d) => existsSync(d) ? readdirSync(d).reduce((n, e) => { const p = join(d, e); return n + (statSync(p).isDirectory() ? count(p) : e.endsWith('.md') ? 1 : 0); }, 0) : 0;
const flag = (n) => argv[argv.indexOf(n) + 1];
const [a, b] = argv;
const refuse = ${JSON.stringify(refuse)};
const hasMembers = readFileSync(${JSON.stringify(argvLog)}, 'utf8').includes('"access","member","add"');
if (refuse !== 'none' && a === 'auth' && b === 'create' && hasMembers && !argv.includes('--member') && (refuse === 'always' || !argv.includes('--reads-unscoped'))) {
  console.error('Error [credential_scope_required]: This brain serves several people, so the token ' + argv[2] + ' was not created bound to nobody; nothing was created.');
  process.exit(1);
}
if (a === '--version') console.log('gbrain 0.60.554.0');
else if (a === 'import') console.log(JSON.stringify({ status: 'success', imported: count(argv[1]), errors: 0, source_id: flag('--source') }));
else if (a === 'auth' && b === 'create') console.log('Token: gbrain_' + Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''));
else if (a === 'access' && b === 'rule') console.log(JSON.stringify({ source_id: flag('--source'), applied: true, state: 'applied', revision: 1, changes: [{ kind: 'added', rule: 'dev', prefix: flag('--prefix'), narrowing: true }], pages_restamped: count(join(process.env.GBRAIN_HOME, 'sources', flag('--source'))) }, null, 2));
else if (a === 'access' && b === 'member') console.log(JSON.stringify({ member: { id: argv[3], status: 'enabled', groups: [] }, groups_created: [], bound: null }, null, 2));
`);
  return path;
}

function corpusFor(dir: string): string {
  for (const p of memberPageList(world, 'dev')) {
    mkdirSync(join(dir, 'dev', ...p.slug.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, 'dev', `${p.slug}.md`), `# ${p.slug}\n`);
  }
  return dir;
}

function build(name: string, access?: 'rules', refuse: 'none' | 'gst363' | 'always' = 'none'): { manifest: CompanyBrainManifest; calls: Array<{ argv: string[]; keyish: string[] }>; out: string } {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  const argvLog = join(dir, 'argv.jsonl');
  const standIn = writeStandIn(dir, argvLog, refuse);
  const out = join(dir, 'brain');
  const manifest = buildBrain({ split: 'dev', brain: 'member', ...(access ? { access } : {}), corpus: corpusFor(join(dir, 'corpus')), worldPath: join(ROOT, 'world', 'seed', 'world.json'), out, staging: join(dir, 'staging'), gbrain: ['bun', standIn], commit: 'test', corpusCommit: 'test', corpusRepo: 'test', log: () => undefined }) as CompanyBrainManifest;
  const calls = readFileSync(argvLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { argv: string[]; keyish: string[] });
  return { manifest, calls, out };
}

describe('build-brain --access rules (gbrain stand-in)', () => {
  const pages = memberPageList(world, 'dev');
  const sources = memberSources(world, 'dev', pages);
  const members = tokenMembers(world, 'dev').map((m) => m.id);
  const acl = build('acl', 'rules');
  const at = (pred: (argv: string[]) => boolean) => acl.calls.findIndex((c) => pred(c.argv));

  test('one folder rule per source with a reader set at <split>/ with that source\'s readers, none on the public source', () => {
    const rules = acl.calls.filter((c) => c.argv[0] === 'access' && c.argv[1] === 'rule').map((c) => c.argv);
    expect(rules).toEqual(sources.filter((s) => s.id !== 'public').map((s) => ['access', 'rule', 'add', '--prefix', 'dev/', '--readers', s.readers.join(','), '--source', s.id, '--yes', '--json']));
    expect(rules.some((r) => r.includes('public'))).toBe(false);
    // a channel with a guest names the guest too; the guest is no gbrain member, so it reads nothing remotely
    expect(rules.find((r) => r.includes('channel-inc-qfl-sev1'))).toContain('dana-okafor,ilse-varga,marcus-lindqvist,samir-patel');
  });

  test('every token member is added as a member and its token bound with --member and no --sources; public-only stays unbound', () => {
    expect(acl.calls.filter((c) => c.argv[0] === 'access' && c.argv[1] === 'member').map((c) => c.argv)).toEqual(members.map((m) => ['access', 'member', 'add', m, '--json']));
    const rescopes = acl.calls.filter((c) => c.argv[0] === 'auth' && c.argv[1] === 'rescope').map((c) => c.argv);
    const memberRescopes = rescopes.filter((r) => r[3]!.startsWith('member-'));
    expect(memberRescopes).toEqual(members.map((m) => ['auth', 'rescope', '--token', `member-${m}`, '--member', m]));
    expect(memberRescopes.some((r) => r.includes('--sources'))).toBe(false);
    expect(rescopes.some((r) => r.includes('public-only'))).toBe(false);
    expect(acl.calls.some((c) => c.argv.join(' ') === 'auth create public-only')).toBe(true);
    const creates = acl.calls.filter((c) => c.argv[0] === 'auth' && c.argv[1] === 'create').map((c) => c.argv);
    expect(creates.filter((a) => a[2]!.startsWith('member-'))).toEqual(members.map((m) => ['auth', 'create', `member-${m}`, '--member', m]));
    expect(creates.filter((a) => !a[2]!.startsWith('member-')).every((a) => a.length === 3)).toBe(true);
    // the per-source ingest tokens keep their one write source
    expect(rescopes.filter((r) => r[3]!.startsWith('ingest-')).every((r) => r[4] === '--sources')).toBe(true);
  });

  test('rules and members come after the imports and before any token is minted', () => {
    const lastImport = acl.calls.map((c) => c.argv[0]).lastIndexOf('import');
    const firstRule = at((a) => a[0] === 'access' && a[1] === 'rule');
    const lastMember = acl.calls.map((c) => c.argv.slice(0, 2).join(' ')).lastIndexOf('access member');
    const firstCreate = at((a) => a[0] === 'auth' && a[1] === 'create');
    expect(lastImport).toBeLessThan(firstRule);
    expect(firstRule).toBeLessThan(lastMember);
    expect(lastMember).toBeLessThan(firstCreate);
  });

  test('the manifest records access rules, the rules and the bindings; tokens only in tokens.json (0600); no key reached the stand-in', () => {
    expect(acl.manifest.access).toBe('rules');
    expect(acl.manifest.rules!.map((r) => r.source)).toEqual(sources.filter((s) => s.id !== 'public').map((s) => s.id));
    expect(acl.manifest.rules!.find((r) => r.source === 'team-central-members')).toMatchObject({ prefix: 'dev/', rule_id: 'dev', pages_restamped: 4 });
    expect(acl.manifest.bindings).toEqual([...members.map((m) => ({ token_name: `member-${m}`, member: m })), { token_name: 'public-only', member: null }]);
    expect(acl.manifest.gbrain_version).toBe('0.60.554.0');
    expect(JSON.stringify(acl.manifest)).not.toMatch(/gbrain_[0-9a-f]{20}/);
    expect(statSync(join(acl.out, 'tokens.json')).mode & 0o777).toBe(0o600);
    expect(Object.keys(JSON.parse(readFileSync(join(acl.out, 'tokens.json'), 'utf8')).members)).toEqual(members);
    expect(acl.calls.flatMap((c) => c.keyish)).toEqual([]);
  });

  test('without --access the member brain is built as before: no access command, member tokens granted with --sources', () => {
    const plain = build('plain');
    expect(plain.calls.some((c) => c.argv[0] === 'access')).toBe(false);
    expect(plain.manifest.access).toBeUndefined();
    const memberRescopes = plain.calls.filter((c) => c.argv[0] === 'auth' && c.argv[1] === 'rescope' && c.argv[3]!.startsWith('member-'));
    expect(memberRescopes.length).toBe(members.length);
    expect(memberRescopes.every((c) => c.argv[4] === '--sources' && !c.argv.includes('--member'))).toBe(true);
    expect(plain.calls.filter((c) => c.argv[0] === 'auth' && c.argv[1] === 'create').every((c) => c.argv.length === 3)).toBe(true);
  });

  test('against a gbrain that refuses unbound tokens (internal-task), public-only and the ingest tokens are created --reads-unscoped --yes; members stay bound', () => {
    const strict = build('acl-gst363', 'rules', 'gst363');
    const creates = strict.calls.filter((c) => c.argv[0] === 'auth' && c.argv[1] === 'create').map((c) => c.argv);
    expect(creates.filter((a) => a[2]!.startsWith('member-'))).toEqual(members.map((m) => ['auth', 'create', `member-${m}`, '--member', m]));
    expect(creates.filter((a) => a[2] === 'public-only')).toEqual([['auth', 'create', 'public-only'], ['auth', 'create', 'public-only', '--reads-unscoped', '--yes']]);
    const ingest = creates.filter((a) => a[2]!.startsWith('ingest-'));
    expect(ingest.length).toBeGreaterThan(0);
    expect(ingest.every((a) => a.length === 5 && a[3] === '--reads-unscoped' && a[4] === '--yes')).toBe(true);
    expect(new Set(ingest.map((a) => a[2])).size).toBe(ingest.length);
    const tokens = JSON.parse(readFileSync(join(strict.out, 'tokens.json'), 'utf8'));
    expect(Object.keys(tokens.members)).toEqual(members);
    expect(tokens.public_only).toMatch(/^gbrain_[0-9a-f]+$/);
    expect(Object.keys(JSON.parse(readFileSync(join(strict.out, 'ingest-tokens.json'), 'utf8')).sources).length).toBe(ingest.length);
    expect(strict.manifest.bindings).toEqual(acl.manifest.bindings);
  });

  test('a refusal of the --reads-unscoped retry stops the build instead of retrying again', () => {
    expect(() => build('acl-always', 'rules', 'always')).toThrow(/gbrain auth create public-only exited 1[\s\S]*credential_scope_required/);
    const calls = readFileSync(join(tmp, 'acl-always', 'argv.jsonl'), 'utf8').trim().split('\n').map((l) => (JSON.parse(l) as { argv: string[] }).argv);
    expect(calls.filter((a) => a[1] === 'create' && a[2] === 'public-only')).toEqual([['auth', 'create', 'public-only'], ['auth', 'create', 'public-only', '--reads-unscoped', '--yes']]);
    expect(calls.some((a) => a[1] === 'create' && a[2]!.startsWith('ingest-'))).toBe(false);
  });

  test('--access rules is refused on the bot-visible brain and with any value but rules', () => {
    const o = { split: 'dev' as const, corpus: tmp, worldPath: join(ROOT, 'world', 'seed', 'world.json'), out: join(tmp, 'never'), staging: join(tmp, 'never-staging'), gbrain: ['false'], commit: 't', corpusCommit: 't', corpusRepo: 't' };
    expect(() => buildBrain({ ...o, access: 'rules' })).toThrow(/--access rules needs --brain member or company/);
    expect(() => buildBrain({ ...o, brain: 'member', access: 'open' as 'rules' })).toThrow(/--access must be "rules"/);
  });
});

// ---- the cell validation ------------------------------------------------------------------------------------------------

const cell = (gbrain: Cell['gbrain'], id = 'fake-acl'): Cell => ({ id, harness: '_fake', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, gbrain });
function writePrereg(cells: Cell[], runId: string): string {
  const dir = join(tmp, runId);
  mkdirSync(dir, { recursive: true });
  const p: Prereg = { schema_version: 1, run_id: runId, question: 'acl fixture', tasks: {}, cells, wall_clock_s: { multiuser: 120 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] };
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify(p));
  return join(dir, 'prereg.json');
}

test('gbrain.access "rules" loads with brain member and scope member; elsewhere, with live ingestion or another value it is HE-GBRAIN-003', () => {
  expect(loadPrereg(writePrereg([cell({ surface: 'starter', brain: 'member', scope: 'member', access: 'rules' })], 'acl-ok')).prereg.cells[0]!.gbrain!.access).toBe('rules');
  expect(() => loadPrereg(writePrereg([cell({ surface: 'starter', access: 'rules' })], 'acl-no-brain'))).toThrow(/HE-GBRAIN-003 .*access "rules" needs gbrain.brain "member" and gbrain.scope "member"/);
  expect(() => loadPrereg(writePrereg([cell({ surface: 'starter', brain: 'company', scope: 'member', access: 'rules' })], 'acl-company'))).toThrow(/HE-GBRAIN-003 .*access "rules" needs gbrain.brain "member"/);
  expect(() => loadPrereg(writePrereg([cell({ surface: 'starter', brain: 'member', access: 'rules' })], 'acl-no-scope'))).toThrow(/HE-GBRAIN-003 .*scope "none"/);
  expect(() => loadPrereg(writePrereg([cell({ surface: 'starter', brain: 'member', scope: 'sources', access: 'rules' })], 'acl-sources'))).toThrow(/HE-GBRAIN-003 .*access "rules" needs/);
  expect(() => loadPrereg(writePrereg([cell({ surface: 'starter', brain: 'member', scope: 'member', ingest: 'live', access: 'rules' })], 'acl-live'))).toThrow(/HE-GBRAIN-003 .*runs without live ingestion/);
  expect(() => loadPrereg(writePrereg([cell({ surface: 'starter', brain: 'member', scope: 'member', access: 'open' as 'rules' })], 'acl-bad'))).toThrow(/HE-GBRAIN-003 .*access must be "rules" or absent/);
});

test('gbrain.access "rules" with scope "member-sources" stays HE-GBRAIN-003, with or without live ingestion (qm train merge, internal-task)', () => {
  expect(() => loadPrereg(writePrereg([cell({ surface: 'starter', brain: 'member', scope: 'member-sources', access: 'rules' })], 'acl-member-sources'))).toThrow(/HE-GBRAIN-003 .*access "rules" needs gbrain.brain "member" and gbrain.scope "member"/);
  expect(() => loadPrereg(writePrereg([cell({ surface: 'starter', brain: 'member', scope: 'member-sources', ingest: 'live', access: 'rules' })], 'acl-member-sources-live'))).toThrow(/HE-GBRAIN-003 .*access "rules" needs gbrain.brain "member" and gbrain.scope "member"/);
});

// ---- the preflight verdict ----------------------------------------------------------------------------------------------

describe('access-rules preflight: fails closed on (a), (b) and (c)', () => {
  const pages = memberPageList(world, 'dev');
  const expected: AccessRulesExpected = { pages: pages.map((p) => ({ page_slug: p.page_slug, source: p.source, readers: p.readers })), sources: memberSources(world, 'dev', pages).map((s) => ({ id: s.id, readers: s.readers })), token_members: tokenMembers(world, 'dev').map((m) => m.id) };
  const everyone = expected.sources.find((s) => s.id === 'public')!.readers;
  const readable = (grant: string) => expected.pages.filter((p) => (grant === 'public-only' ? p.readers.length === everyone.length : p.readers.includes(grant)));
  /** What a correct brain answers at gbrain 0.60.554.0: who-can-read blind to folder rules, the rules and remote reads right. */
  const good = (): AccessRulesEvidence => ({
    image_id: 'sha256:fixture', ready_ms: 1,
    checks: [...expected.token_members.map((m) => ({ token: `member-${m}`, member: m, status: 'enabled', verdict: 'reads_as_member' })), { token: 'public-only', member: null, status: null, verdict: 'unbound' }],
    rules: expected.sources.map((s) => ({ source: s.id, rules: s.id === 'public' ? [] : [{ id: 'dev', prefix: 'dev/', readers: s.readers }], held: 0, pending: 0, invalid: 0 })),
    who: expected.pages.map((p) => ({ slug: p.page_slug, source_id: p.source, readers: null, members: 'every_source_reader' as const })),
    tap: ['public-only', ...expected.token_members].flatMap((grant) => [
      ...['search', 'query', 'recall'].map((tool) => ({ grant, tool, query: 'incident', rows: readable(grant).slice(0, 1).map((p) => ({ slug: p.page_slug, source_id: p.source })) })),
      { grant, tool: 'list_pages', query: '', rows: readable(grant).map((p) => ({ slug: p.page_slug, source_id: p.source })) },
    ]),
    slug_reads: expected.token_members.flatMap((m) => [
      ...expected.pages.filter((p) => !p.readers.includes(m)).map((p) => ({ grant: m, slug: p.page_slug, source_id: p.source, inside: false, outcome: 'refused' as const, code: 'permission_denied' })),
      ...readable(m).slice(0, 1).map((p) => ({ grant: m, slug: p.page_slug, source_id: p.source, inside: true, outcome: 'ok' as const, code: null })),
    ]),
  });
  const checks = (e: AccessRulesEvidence) => [...new Set(accessRulesProblems(e, expected).problems.map((p) => p.check))];

  test('a brain that gates every page to the world\'s reader set passes; who-can-read\'s rule-blind answers are counted, not trusted', () => {
    const { problems, summary } = accessRulesProblems(good(), expected);
    expect(problems).toEqual([]);
    expect(summary.rule_blind).toBe(expected.pages.filter((p) => p.source !== 'public').length);
    expect(summary.rules).toBe(expected.sources.length - 1);
  });

  test('(a) a member token bound to another member, or a bound public-only token, fails', () => {
    const e = good();
    e.checks[0] = { ...e.checks[0]!, member: expected.token_members[1]! };
    expect(checks(e)).toEqual(['a']);
    const p = good();
    p.checks[p.checks.length - 1] = { token: 'public-only', member: 'moss', status: 'enabled', verdict: 'reads_as_member' };
    expect(checks(p)).toEqual(['a']);
    const u = good();
    u.checks[2] = { ...u.checks[2]!, member: null, status: null, verdict: 'unbound' };
    expect(accessRulesProblems(u, expected).problems[0]!.what).toMatch(/unbound as nobody/);
  });

  test('(b) a rule wider than the world\'s reader set, a rule on the public source, a held change or an unreadable page fails', () => {
    const wide = good();
    const r = wide.rules.find((x) => x.source === 'channel-north-random')!;
    r.rules[0] = { ...r.rules[0]!, readers: [...r.rules[0]!.readers, 'hollis-mbeki'].sort() };
    expect(checks(wide)).toEqual(['b']);
    expect(accessRulesProblems(wide, expected).problems.map((p) => p.what).join(' ')).toMatch(/north-team-random is readable by \[.*hollis-mbeki.*\], the world says/);
    const pub = good();
    pub.rules.find((x) => x.source === 'public')!.rules = [{ id: 'dev', prefix: 'dev/', readers: ['moss'] }];
    expect(checks(pub)).toEqual(['b']);
    const held = good();
    held.rules[0]!.held = 1;
    expect(checks(held)).toEqual(['b']);
    const missing = good();
    missing.who[0] = { ...missing.who[0]!, error: 'not_found' };
    expect(checks(missing)).toEqual(['b']);
  });

  test('(c) a row outside the grant\'s reader set, or a list that hides pages the member may read, fails', () => {
    const leak = good();
    const north = expected.pages.find((p) => p.source === 'channel-north-random')!;
    leak.tap.find((t) => t.grant === 'hollis-mbeki' && t.tool === 'search')!.rows.push({ slug: north.page_slug, source_id: north.source });
    expect(checks(leak)).toEqual(['c']);
    const pub = good();
    pub.tap.find((t) => t.grant === 'public-only' && t.tool === 'query')!.rows.push({ slug: north.page_slug, source_id: north.source });
    expect(checks(pub)).toEqual(['c']);
    const unknown = good();
    unknown.tap.find((t) => t.grant === 'moss' && t.tool === 'recall')!.rows.push({ slug: 'dev/not-in-the-world', source_id: 'public' });
    expect(checks(unknown)).toEqual(['c']);
    const closed = good();
    closed.tap.find((t) => t.grant === 'ilse-varga' && t.tool === 'list_pages')!.rows = [];
    expect(accessRulesProblems(closed, expected).problems.map((p) => p.what).join(' ')).toMatch(/ilse-varga's list_pages misses/);
    const empty = good();
    for (const t of empty.tap) if (t.tool === 'recall') t.rows = [];
    expect(accessRulesProblems(empty, expected).problems.map((p) => p.what)).toEqual(['recall returned 0 rows under every grant; the probe cannot show the rules hold on it']);
  });

  test('(c) a row is its source and slug: a private-source row under a public page\'s slug fails, and a list holding that slug only under another source misses the page', () => {
    const pub = expected.pages.find((p) => p.source === 'public')!;
    const collide = good();
    collide.tap.find((t) => t.grant === 'public-only' && t.tool === 'search')!.rows.push({ slug: pub.page_slug, source_id: 'channel-north-random' });
    expect(checks(collide)).toEqual(['c']);
    expect(accessRulesProblems(collide, expected).problems.map((p) => p.what).join(' ')).toContain(`public-only search "incident" -> ${pub.page_slug} in channel-north-random, outside its reader set`);
    const moved = good();
    const list = moved.tap.find((t) => t.grant === 'public-only' && t.tool === 'list_pages')!;
    list.rows = list.rows.map((r) => (r.slug === pub.page_slug ? { ...r, source_id: 'channel-north-random' } : r));
    expect(accessRulesProblems(moved, expected).problems.map((p) => p.what).join(' ')).toMatch(/public-only's list_pages misses 1 page\(s\)/);
  });

  test('(c) get_page: a page outside the member\'s reader set that comes back, a refused page inside it, or a page never tried fails', () => {
    const north = expected.pages.find((p) => p.source === 'channel-north-random')!;
    const outsider = expected.token_members.find((m) => !north.readers.includes(m))!;
    const served = good();
    Object.assign(served.slug_reads.find((r) => r.grant === outsider && r.slug === north.page_slug)!, { outcome: 'ok', code: null });
    expect(checks(served)).toEqual(['c']);
    expect(accessRulesProblems(served, expected).problems.map((p) => p.what)).toEqual([`${outsider} get_page -> ${north.page_slug} in ${north.source}: served, outside its reader set`]);
    const other = good();
    Object.assign(other.slug_reads.find((r) => r.grant === outsider && r.slug === north.page_slug)!, { outcome: 'other', code: 'another page (dev/x)' });
    expect(checks(other)).toEqual(['c']);
    const refused = good();
    Object.assign(refused.slug_reads.find((r) => r.inside)!, { outcome: 'refused', code: 'permission_denied' });
    expect(accessRulesProblems(refused, expected).problems.map((p) => p.what).join(' ')).toMatch(/inside its reader set: permission_denied/);
    const untried = good();
    untried.slug_reads = untried.slug_reads.filter((r) => !(r.grant === outsider && r.slug === north.page_slug));
    expect(accessRulesProblems(untried, expected).problems.map((p) => p.what)).toEqual([`${outsider}: get_page was not tried on 1 page(s) outside its reader set (${north.page_slug}); the probe cannot show the rules hold on slug reads`]);
  });
});

// ---- the preflight record -----------------------------------------------------------------------------------------------

describe('access-rules preflight record', () => {
  const dir = join(tmp, 'record');
  const side = join(dir, 'preflight-gbrain-acl-dev');
  mkdirSync(side, { recursive: true });
  writeFileSync(join(side, 'tokens.json'), JSON.stringify({ schema_version: 1, brain: 'member', split: 'dev', public_only: 'fixture-public-only-value', members: { moss: 'fixture-member-moss-value' } }));
  writeFileSync(join(side, 'token'), 'fixture-trial-token-value\n');

  test('goes where no token is kept and never carries a token value', () => {
    const record = join(dir, 'access-preflight-dev.json');
    writeAccessPreflight(record, { split: 'dev', ok: true, evidence: { image_id: 'sha256:a' } }, side);
    expect(readFileSync(record, 'utf8')).not.toContain('fixture-');
    expect(() => writeAccessPreflight(join(side, 'access-preflight.json'), { ok: true }, side)).toThrow(/^HE-GBRAIN-002 .*beside a gbrain token/);
    expect(existsSync(join(side, 'access-preflight.json'))).toBe(false);
    for (const value of ['fixture-public-only-value', 'fixture-member-moss-value', 'fixture-trial-token-value']) {
      const leak = join(dir, 'leak.json');
      expect(() => writeAccessPreflight(leak, { evidence: { note: value } }, side)).toThrow(/^HE-GBRAIN-002 .*would carry a gbrain token value/);
      expect(existsSync(leak)).toBe(false);
    }
  });

  test('run takes an access-ruled cell only on the image id its passing access preflight recorded', () => {
    const record = join(dir, 'access-preflight-run.json');
    expect(accessPreflightProblem(record, 'dev', 'img', 'sha256:a')).toMatch(/^access=rules: no access preflight record for dev/);
    writeFileSync(record, JSON.stringify({ ok: false, evidence: { image_id: 'sha256:a' } }));
    expect(accessPreflightProblem(record, 'dev', 'img', 'sha256:a')).toMatch(/did not pass/);
    writeFileSync(record, JSON.stringify({ ok: true, evidence: { image_id: 'sha256:a' } }));
    expect(accessPreflightProblem(record, 'dev', 'img', 'sha256:b')).toMatch(/ran on image id sha256:a, img is now sha256:b/);
    expect(accessPreflightProblem(record, 'dev', 'img', '')).toMatch(/img is now unreadable/);
    expect(accessPreflightProblem(record, 'dev', 'img', 'sha256:a')).toBeNull();
  });
});

// ---- the ladder ---------------------------------------------------------------------------------------------------------

test('ladder: told-acl and installer-acl on the access-ruled member brain; installer-acl pairs against told-acl', () => {
  const TOLD = 'tasks/multiuser/_shared/preamble.gbrain-ladder.md';
  const acl = { surface: 'starter' as const, brain: 'member' as const, scope: 'member' as const, access: 'rules' as const };
  expect(rungOf({ id: 'x', harness: 'h', model: 'm', gbrain: acl, preamble: TOLD })).toEqual({ rung: 'told-acl', label: `starter/mcp/off, preamble ${TOLD}, brain member, scope member, access rules` });
  expect(rungOf({ id: 'x', harness: 'h', model: 'm', gbrain: { ...acl, install: 'gbrain-installer' } }).rung).toBe('installer-acl');
  expect(rungOf({ id: 'x', harness: 'h', model: 'm', gbrain: { surface: 'starter', brain: 'member', scope: 'member' }, preamble: TOLD }).rung).toBeNull();
  const run = ladderPairs([
    { id: 'cc-told-acl', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', gbrain: acl, preamble: TOLD },
    { id: 'cc-installer-acl', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', gbrain: { ...acl, install: 'gbrain-installer' } },
    { id: 'cx-told-acl', harness: 'codex', model: 'openai:gpt-6.1-sol', gbrain: acl, preamble: TOLD },
    { id: 'cx-installer-acl', harness: 'codex', model: 'openai:gpt-6.1-sol', gbrain: { ...acl, install: 'gbrain-installer' } },
    { id: 'cc-none', harness: 'claude-code', model: 'anthropic:claude-opus-5-5' },
  ]);
  expect(run.problems).toEqual([]);
  expect(run.pairs.map((p) => `${p.cell}>${p.base_cell}`)).toEqual(['cc-installer-acl>cc-told-acl', 'cx-installer-acl>cx-told-acl']);
  expect(run.unpaired).toEqual(['claude-code on anthropic:claude-opus-5-5: none cell cc-none has no mcp cell above it', 'claude-code on anthropic:claude-opus-5-5: rung told-acl (cc-told-acl) has no told cell below it and serves as a base only', 'codex on openai:gpt-6.1-sol: rung told-acl (cx-told-acl) has no told cell below it and serves as a base only']);
});
