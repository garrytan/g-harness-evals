// internal-task (gbrain v0.60.717.0, the shared-bot fixes): the serves-several gbrain cell. The cell validation takes exactly two shapes
// (the refused company arm and the installer's member-key arm on the bot-visible brain, optionally on the reader-labelled brain)
// and refuses the rest under HE-GBRAIN-003; the sidecar gets the labelling through its environment; the record and the plan carry
// serves and labels; build-brain --labels readers writes each page's token-member readers into its frontmatter. With the image
// harness-eval/gbrain:check-5dc712b93742 present, the docker cases start the sidecar with each arm and check the refusal, the
// member binding and the labelled brain's listings; without it they skip.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildBrain, labelledPageList, memberTokenName, pageList, tokenMembers, type BrainManifest } from '../gbrain/build-brain.ts';
import { buildManifest, loadPrereg, renderPlan, resolveGbrain, type Cell, type Prereg } from '../runner/run.ts';
import { callGbrain, checkCompanyTokens, gbrainImagePresent, listPagesToEnd, probeServesSeveral, servesEnv, startGbrainSidecar } from '../runner/trial/gbrain.ts';
import { gbrainSummary } from '../runner/trial/trial.ts';
import type { GbrainCellConfig } from '../runner/contracts.ts';
import { world } from './world-helpers.ts';

const ROOT = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'he-gbrain-serves-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const REFUSED: GbrainCellConfig = { surface: 'starter', brain: 'company', serves: 'several' };
const MEMBER_KEYS: GbrainCellConfig = { surface: 'starter', install: 'gbrain-installer', brain: 'bot-visible', scope: 'member', serves: 'several' };
const LABELLED: GbrainCellConfig = { ...MEMBER_KEYS, labels: 'readers' };

const cell = (gbrain: GbrainCellConfig, over: Partial<Cell> = {}): Cell => ({
  id: 'fake-serves', harness: 'openclaw', model: 'anthropic:claude-haiku-5-5', slice: 'multiuser', split: 'dev', repetitions: 1,
  ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, tasks: ['fx-leak'], gbrain, ...over,
});
const writePrereg = (cells: Cell[], runId: string): string => {
  const dir = join(tmp, runId);
  mkdirSync(dir, { recursive: true });
  const prereg: Prereg = { schema_version: 1, run_id: runId, question: 'serves fixture', tasks: {}, cells, wall_clock_s: { multiuser: 120 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] };
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify(prereg));
  return join(dir, 'prereg.json');
};
const refuses = (gbrain: GbrainCellConfig, pattern: RegExp, over: Partial<Cell> = {}) => expect(() => loadPrereg(writePrereg([cell(gbrain, over)], `serves-bad-${Math.random().toString(16).slice(2)}`))).toThrow(pattern);

test('the refused arm, the member-key arm and its labelled brain load; the plan line and the resolved config carry serves and labels', () => {
  const { prereg: p, sha256 } = loadPrereg(writePrereg([
    cell(REFUSED, { id: 'serves-refused', harness: '_fake' }),
    cell(MEMBER_KEYS, { id: 'serves-keys' }),
    cell(LABELLED, { id: 'serves-labelled' }),
    cell({ ...MEMBER_KEYS, brain: undefined, surface: 'verbs' }, { id: 'serves-keys-verbs' }),
  ], 'serves-ok'));
  const plan = renderPlan(buildManifest(p, sha256, '2026-11-14T00:00:00Z', { tasksRoot: join(ROOT, 'tests', 'fixtures', 'tasks') }));
  const line = (id: string) => plan.split('\n').find((l) => l.startsWith(`CELL: ${id} `))!;
  expect(line('serves-refused')).toContain('gbrain=starter/mcp/off brain=company serves=several');
  expect(line('serves-keys')).toContain('gbrain=starter/gbrain-installer/off brain=bot-visible scope=member serves=several');
  expect(line('serves-labelled')).toContain('scope=member serves=several labels=readers');
  expect(resolveGbrain(REFUSED)).toMatchObject({ brain: 'company', scope: 'none', serves: 'several' });
  expect(resolveGbrain(LABELLED)).toMatchObject({ brain: 'bot-visible', scope: 'member', serves: 'several', labels: 'readers' });
  expect(resolveGbrain({ surface: 'starter' })).not.toHaveProperty('serves');
  expect(resolveGbrain({ surface: 'starter' })).not.toHaveProperty('labels');
});

test('every other serves or labels combination is HE-GBRAIN-003', () => {
  refuses({ ...REFUSED, serves: 'many' as 'several' }, /HE-GBRAIN-003 .*serves must be "several" or absent/);
  refuses({ surface: 'starter', serves: 'several' }, /HE-GBRAIN-003 .*serves "several" takes two shapes.*brain "bot-visible", install "mcp", scope "none"/);
  refuses({ ...REFUSED, scope: 'member' }, /HE-GBRAIN-003 .*two shapes.*brain "company", install "mcp", scope "member"/);
  refuses({ ...REFUSED, install: 'gbrain-installer' }, /HE-GBRAIN-003 .*two shapes/);
  refuses({ ...MEMBER_KEYS, install: undefined }, /HE-GBRAIN-003 .*two shapes.*install "mcp"/);
  refuses({ ...MEMBER_KEYS, brain: 'member' }, /HE-GBRAIN-003 .*two shapes/);
  refuses({ ...MEMBER_KEYS, scope: 'sources' }, /HE-GBRAIN-003 .*scope "sources" needs gbrain.brain "company" or "member"/);
  refuses({ ...MEMBER_KEYS, serves: undefined }, /HE-GBRAIN-003 .*scope "member" needs gbrain.brain "company" or "member"/);
  refuses({ ...MEMBER_KEYS, embeddings: 'openai:text-embedding-3-small' }, /HE-GBRAIN-003 .*serves "several" runs without live ingestion, access rules, channel_remember or embeddings/);
  refuses({ ...MEMBER_KEYS, channel_remember: 'member' }, /HE-GBRAIN-003 .*serves "several" runs without/);
  refuses({ ...REFUSED, ingest: 'live' }, /HE-GBRAIN-003 .*ingest "live" needs gbrain.brain "member"/);
  refuses({ ...REFUSED, access: 'rules' }, /HE-GBRAIN-003 .*access "rules" needs gbrain.brain "member"/);
  refuses({ ...MEMBER_KEYS, labels: 'all' as 'readers' }, /HE-GBRAIN-003 .*labels must be "readers" or absent/);
  refuses({ surface: 'starter', labels: 'readers' }, /HE-GBRAIN-003 .*labels needs gbrain.serves "several"/);
  refuses({ ...REFUSED, labels: 'readers' }, /HE-GBRAIN-003 .*labels "readers" needs the member-key shape/);
  refuses(LABELLED, /HE-GBRAIN-003 .*labels "readers" needs the member-key shape .*split heldout/, { split: 'heldout' });
});

test('servesEnv: nothing without serves; serves several names the members and, with labels, the labelled brain; bad input is HE-GBRAIN-002', () => {
  expect(servesEnv({})).toEqual([]);
  expect(servesEnv({ serves: 'several', servesMembers: ['dana-okafor', 'moss'] })).toEqual(['-e', 'HE_GBRAIN_SERVES=several', '-e', 'HE_GBRAIN_MEMBERS=dana-okafor,moss']);
  expect(servesEnv({ serves: 'several', servesMembers: ['dana-okafor'], labels: 'readers' })).toEqual(['-e', 'HE_GBRAIN_SERVES=several', '-e', 'HE_GBRAIN_MEMBERS=dana-okafor', '-e', 'HE_GBRAIN_LABELS=readers']);
  expect(() => servesEnv({ serves: 'several' })).toThrow(/HE-GBRAIN-002 .*token members/);
  expect(() => servesEnv({ serves: 'several', servesMembers: ['dana,okafor'] })).toThrow(/HE-GBRAIN-002/);
  expect(() => servesEnv({ labels: 'readers' })).toThrow(/HE-GBRAIN-002 .*needs serves "several"/);
});

test('the trial record carries serves and labels; tokens.json written for the bot-visible brain passes only when that brain is named', () => {
  const sidecar = { image: 'img', ready_ms: 1, brain: 'bot-visible' as const, scope: 'member' as const };
  expect(gbrainSummary(resolveGbrain(LABELLED), sidecar, [], [])).toMatchObject({ brain: 'bot-visible', scope: 'member', serves: 'several', labels: 'readers', install: 'gbrain-installer' });
  expect(gbrainSummary(resolveGbrain({ surface: 'starter' }), sidecar, [], [])).not.toHaveProperty('serves');
  const tokens = { schema_version: 1, brain: 'bot-visible', split: 'dev', members: { 'dana-okafor': 'gbrain_' + 'a'.repeat(64) }, public_only: 'gbrain_' + 'b'.repeat(64) };
  expect(checkCompanyTokens(tokens, 'dev', ['dana-okafor'], 'tokens.json', ['bot-visible'])).toBe(tokens as never);
  expect(() => checkCompanyTokens(tokens, 'dev', ['dana-okafor'], 'tokens.json')).toThrow(/HE-GBRAIN-004 .*brain "company" or "member"/);
});

test('member token names carry a prefix gbrain\'s own member keys (member-<id>) never use', () => {
  expect(memberTokenName('dana-okafor')).toBe('he-member-dana-okafor');
});

test('labelledPageList: a channel page is read by its channel\'s token members (guests dropped), a public file by every token member', () => {
  const members = tokenMembers(world, 'dev').map((m) => m.id);
  const pages = labelledPageList(world, 'dev');
  expect(pages.map((p) => p.page_slug)).toEqual(pageList(world, 'dev').map((p) => p.page_slug));
  for (const p of pages) {
    if (p.kind === 'file') expect(p.readers).toEqual([...members].sort());
    else expect(p.readers).toEqual(world.channels.find((c) => c.id === p.world_id)!.members.filter((id) => members.includes(id)).sort());
  }
  const guests = new Set(world.members.filter((m) => m.kind === 'guest').map((m) => m.id));
  const withGuest = pages.find((p) => p.kind === 'channel' && world.channels.find((c) => c.id === p.world_id)!.members.some((id) => guests.has(id)));
  if (withGuest) expect(withGuest.readers.some((id) => guests.has(id))).toBe(false);
});

test('build-brain --labels readers writes readable_by into each staged page\'s frontmatter and records labels and readers; other brains refuse it', () => {
  const dir = join(tmp, 'labels-build');
  const corpus = join(dir, 'corpus');
  for (const p of pageList(world, 'dev')) {
    mkdirSync(join(corpus, 'dev', ...p.slug.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(corpus, 'dev', `${p.slug}.md`), `---\ntitle: "${p.slug}"\n---\n# ${p.slug}\n`);
  }
  const standIn = join(dir, 'gbrain-standin.ts');
  writeFileSync(standIn, [
    "import { existsSync, readdirSync, statSync } from 'node:fs';",
    "import { join } from 'node:path';",
    'const argv = process.argv.slice(2);',
    "const count = (d) => existsSync(d) ? readdirSync(d).reduce((n, e) => { const p = join(d, e); return n + (statSync(p).isDirectory() ? count(p) : e.endsWith('.md') ? 1 : 0); }, 0) : 0;",
    "if (argv[0] === '--version') console.log('gbrain 0.60.717.0');",
    "else if (argv[0] === 'import') console.log(JSON.stringify({ status: 'success', imported: count(argv[1]), errors: 0, duration_s: 0 }));",
  ].join('\n'));
  const opts = { split: 'dev' as const, corpus, worldPath: join(ROOT, 'world', 'seed', 'world.json'), out: join(dir, 'brain'), staging: join(dir, 'staging'), gbrain: ['bun', standIn], commit: 'test', corpusCommit: 'test', corpusRepo: 'test', log: () => undefined };
  const m = buildBrain({ ...opts, labels: 'readers' }) as BrainManifest;
  expect(m.labels).toBe('readers');
  const expected = labelledPageList(world, 'dev');
  expect(m.pages.map((p) => [p.page_slug, p.readers])).toEqual(expected.map((p) => [p.page_slug, p.readers]));
  for (const p of expected) expect(readFileSync(join(dir, 'staging', 'dev', `${p.slug}.md`), 'utf8')).toBe(`---\nreadable_by: [${p.readers.join(', ')}]\ntitle: "${p.slug}"\n---\n# ${p.slug}\n`);
  expect((buildBrain(opts) as BrainManifest).labels).toBeUndefined();
  expect(() => buildBrain({ ...opts, brain: 'company', labels: 'readers' })).toThrow(/--labels must be "readers" on the keyword bot-visible brain/);
});

const IMAGE = 'harness-eval/gbrain:check-5dc712b93742';
const haveImage = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0 && gbrainImagePresent(IMAGE);

describe.skipIf(!haveImage)(`a serves-several sidecar from ${IMAGE}`, () => {
  const members = tokenMembers(world, 'dev').map((m) => m.id);
  const labelled = labelledPageList(world, 'dev');
  const readers = Object.fromEntries(labelled.map((p) => [p.page_slug, p.readers]));

  test('refused arm: the company brain labelled several refuses the unbound trial token (requester_scope_required, no page); the receipt names key paths, not keys', async () => {
    const dir = join(tmp, 'docker-refused');
    const { evidence, problems } = await probeServesSeveral(IMAGE, 'dev', dir, { arm: 'refused', members });
    expect(problems).toEqual([]);
    expect(evidence).toMatchObject({ arm: 'refused', labels: 'none', labelled: { members: members.length, rules: members.length, keys: members.length }, unbound: { code: 'requester_scope_required', rows: 0 }, members: [] });
    const receipt = readFileSync(join(dir, 'serves.json'), 'utf8');
    expect(receipt).not.toMatch(/gbrain_[0-9a-f]{20}/);
    expect(JSON.parse(receipt).keys.map((k: { token_name: string }) => k.token_name)).toEqual(members.map((m) => `member-${m}`));
    expect(existsSync(join(dir, 'tokens.json'))).toBe(false);
  }, 180_000);

  test('member-key arm: the unbound token is refused and each member key reads as its member; unlabelled, the keys still list pages outside their readers', async () => {
    const dir = join(tmp, 'docker-keys');
    const { evidence, problems } = await probeServesSeveral(IMAGE, 'dev', dir, { arm: 'member-keys', members });
    expect(problems).toEqual([]);
    expect(evidence.unbound).toEqual({ code: 'requester_scope_required', rows: 0 });
    expect(evidence.members.map((r) => r.reads_as)).toEqual([...members].sort());
    expect(statSync(join(dir, 'tokens.json')).mode & 0o777).toBe(0o600);
    const sidecar = await startGbrainSidecar({ trialId: 'serves-open', trialSlug: `serves-open-${process.pid}`, split: 'dev', outDir: join(tmp, 'docker-keys-list'), image: IMAGE, brain: 'bot-visible', scope: 'member', serves: 'several', servesMembers: members });
    try {
      let returned = 0; let outside = 0;
      for (const m of members) {
        const rows = await listPagesToEnd(async (offset) => await callGbrain(sidecar.url, sidecar.tokens!.members[m]!, 'list_pages', { limit: 100, offset, sort: 'slug' }) as Array<Record<string, unknown>>, (w) => new Error(w));
        returned += rows.length;
        outside += rows.filter((r) => !readers[String(r.slug)]!.includes(m)).length;
      }
      expect([returned, outside]).toEqual([270, 83]);
    } finally { await sidecar.stop(5_000); }
  }, 240_000);

  test('labelled brain: each member key lists exactly the pages its member may read (187 over the dev keys, 0 outside)', async () => {
    const { evidence, problems } = await probeServesSeveral(IMAGE, 'dev', join(tmp, 'docker-labelled'), { arm: 'member-keys', members, readers });
    expect(problems).toEqual([]);
    expect(evidence.labels).toBe('readers');
    expect(evidence.members.reduce((a, r) => a + (r.listed ?? 0), 0)).toBe(187);
    expect(evidence.members.flatMap((r) => [...(r.outside ?? []), ...(r.missing ?? [])])).toEqual([]);
    const wrong = { ...readers, [labelled[0]!.page_slug]: [] };
    const miss = await probeServesSeveral(IMAGE, 'dev', join(tmp, 'docker-labelled-wrong'), { arm: 'member-keys', members, readers: wrong });
    expect(miss.problems.length).toBeGreaterThan(0);
    expect(miss.problems[0]).toContain(labelled[0]!.page_slug);
  }, 240_000);
});

describe('keyless scope probe (scripts/gbrain-scope-fix-probe.sh)', () => {
  const PROBE = join(ROOT, 'scripts/gbrain-scope-fix-probe.sh');
  const PREFLIGHT = join(ROOT, 'docs/benchmarks/2026-11-14-shared-bot-scope/preflight');
  const CONFIGS = ['open', 'refused', 'members', 'members-labelled', 'owner', 'owner-restricted', 'one-pinned'];

  test('parses as bash and documents every config it takes', () => {
    expect(spawnSync('bash', ['-n', PROBE]).status).toBe(0);
    const header = readFileSync(PROBE, 'utf8').split('\nset -u\n')[0]!;
    for (const config of CONFIGS) expect(header).toMatch(new RegExp(`^#\\s+(config\\s+)?${config}\\s`, 'm'));
  });

  test('each preflight receipt holds one TOTAL line for the brain and config its name gives', () => {
    const receipts = readdirSync(PREFLIGHT).filter((f) => f.startsWith('probe-dev'));
    expect(receipts.length).toBe(19);
    for (const f of receipts) {
      const config = CONFIGS.filter((c) => f.endsWith(`-${c}.txt`)).sort((a, b) => b.length - a.length)[0];
      expect(config).toBeDefined();
      const brain = f.slice('probe-'.length, -`-${config}.txt`.length);
      const totals = readFileSync(join(PREFLIGHT, f), 'utf8').split('\n').filter((l) => l.startsWith('TOTAL '));
      expect(totals).toHaveLength(1);
      expect(totals[0]).toStartWith(`TOTAL ${config} ${brain}: returned `);
    }
  });
});

