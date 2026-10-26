// scripts/gbrain-check.ts, keyless (internal-task; docs/gbrain-arm.md, "Checking a gbrain commit"): --gbrain resolution against
// a local bare repository (never the network), the scratch preregistration through loadPrereg and buildManifest, the
// keyless assertions over a healthy fixture and one whose catalog is fine but whose retrieval is broken (it must fail
// under HE-GBRAIN-008), the paid summary from fixture summary.json, trials.jsonl and baseline files (complete, INCOMPLETE,
// NOT_COMPARABLE, no baseline), the docs/benchmarks refusal and the baseline overwrite refusal (HE-GBRAIN-010), the
// committed baseline's shape, and --dry-run through the command line. No docker, no key, no network.

import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import { buildManifest, loadPrereg, type Manifest } from '../runner/run.ts';
import {
  DEFAULT_BASELINE, INGEST_CODE_WORD, KNOWN_PAGE, RUNGS, SCOPED_ACTORS, TOLD_PREAMBLE, checkDir, fingerprintOf, fingerprintSha, gitExpandSha, keylessAssertions, modelLabel, paidCells, parseArgs,
  readBaseline, renderSummary, resolveFromRefs, resolveGbrainRef, scratchPrereg, validateBaseline, viewDigestFromBundle, writeBaseline, writeKeylessTasks,
  type Baseline, type IngestEvidence, type InstallerEvidence, type KeylessEvidence, type PinSurfaces, type SummaryJson, type ViewEvidence,
} from '../scripts/gbrain-check.ts';

const ROOT = resolve(import.meta.dir, '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'gbrain-check');
const tmp = mkdtempSync(join(tmpdir(), 'he-gbrain-check-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const pin = JSON.parse(readFileSync(join(ROOT, 'gbrain', 'pin.json'), 'utf8')) as PinSurfaces;

describe('--gbrain resolution', () => {
  // A throwaway repository with two commits on main, a feature branch, a lightweight tag and an annotated tag, pushed to a
  // bare remote; the resolver is pointed at the bare remote instead of github.com/garrytan/gbrain.
  const work = join(tmp, 'gbrain-work');
  const remote = join(tmp, 'gbrain-remote.git');
  mkdirSync(work, { recursive: true });
  const g = (...args: string[]) => execFileSync('git', args, { cwd: work, encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 't');
  g('config', 'commit.gpgsign', 'false');
  writeFileSync(join(work, 'VERSION'), '0.1.0\n');
  g('add', 'VERSION'); g('commit', '-q', '-m', 'first');
  const first = g('rev-parse', 'HEAD');
  writeFileSync(join(work, 'VERSION'), '0.2.0\n');
  g('commit', '-q', '-am', 'second');
  const second = g('rev-parse', 'HEAD');
  g('tag', 'lw');
  g('checkout', '-q', '-b', 'feature');
  writeFileSync(join(work, 'VERSION'), '0.3.0\n');
  g('commit', '-q', '-am', 'third');
  const third = g('rev-parse', 'HEAD');
  g('tag', '-a', 'ann', '-m', 'annotated');
  const tagObject = g('rev-parse', 'refs/tags/ann');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  g('push', '-q', remote, 'main', 'feature', 'lw', 'ann');
  const never = () => { throw new Error('ls-remote must not be called for a full sha or a path'); };

  test('a full sha is taken as is without touching the remote', () => {
    expect(resolveGbrainRef(first, { remote, lsRemote: never })).toEqual({ input: first, sha: first, kind: 'sha', ref: null });
  });

  test('an abbreviated sha expands through a ref that starts with it, else through a treeless clone of the remote', () => {
    expect(resolveGbrainRef(second.slice(0, 10), { remote })).toMatchObject({ sha: second, kind: 'abbreviated-sha' });
    // The first commit is no ref's tip: only the clone can expand it.
    const scratch = join(tmp, 'refs-scratch');
    expect(resolveGbrainRef(first.slice(0, 9), { remote, scratch })).toMatchObject({ sha: first, kind: 'abbreviated-sha' });
    expect(existsSync(join(scratch, 'gbrain-refs.git'))).toBe(true);
    expect(gitExpandSha(remote, 'fffffff', scratch)).toBeNull();
    expect(() => resolveGbrainRef('fffffffff', { remote, scratch })).toThrow(/HE-GBRAIN-009 .*names no commit .*refs\/heads\/main/s);
  });

  test('a branch, a lightweight tag and an annotated tag (peeled to its commit) resolve through ls-remote; an unknown name is HE-GBRAIN-009 with the listing', () => {
    expect(resolveGbrainRef('feature', { remote })).toEqual({ input: 'feature', sha: third, kind: 'branch', ref: 'refs/heads/feature' });
    expect(resolveGbrainRef('main', { remote })).toMatchObject({ sha: second, kind: 'branch' });
    expect(resolveGbrainRef('lw', { remote })).toEqual({ input: 'lw', sha: second, kind: 'tag', ref: 'refs/tags/lw' });
    const ann = resolveGbrainRef('ann', { remote });
    expect(ann).toEqual({ input: 'ann', sha: third, kind: 'tag', ref: 'refs/tags/ann' });
    expect(ann.sha).not.toBe(tagObject);
    expect(resolveGbrainRef('refs/tags/ann', { remote })).toMatchObject({ sha: third, kind: 'tag' });
    expect(() => resolveGbrainRef('nope', { remote })).toThrow(/HE-GBRAIN-009 --gbrain "nope" is not a sha, a branch, a tag or a local checkout.*refs\/heads\/feature/s);
    expect(() => resolveGbrainRef('', { remote })).toThrow(/HE-GBRAIN-009 missing --gbrain/);
    // The pure resolver, on a listing with a peeled tag line, prefers the commit over the tag object.
    const refs = [{ sha: 'a'.repeat(40), ref: 'refs/tags/v1' }, { sha: 'b'.repeat(40), ref: 'refs/tags/v1^{}' }, { sha: 'c'.repeat(40), ref: 'refs/heads/v1' }];
    expect(resolveFromRefs('v1', refs)).toEqual({ sha: 'c'.repeat(40), kind: 'branch', ref: 'refs/heads/v1' });
    expect(resolveFromRefs('v1', refs.slice(0, 2))).toEqual({ sha: 'b'.repeat(40), kind: 'tag', ref: 'refs/tags/v1' });
    expect(resolveFromRefs('v2', refs)).toBeNull();
  });

  test('a local checkout path resolves to its clean HEAD; a dirty tree is refused', () => {
    expect(resolveGbrainRef(work, { remote, lsRemote: never })).toEqual({ input: work, sha: third, kind: 'path', ref: null });
    writeFileSync(join(work, 'scratch.txt'), 'dirty');
    expect(() => resolveGbrainRef(work, { remote, lsRemote: never })).toThrow(/HE-GBRAIN-009 .*uncommitted changes \(1 path\(s\)\)/);
    rmSync(join(work, 'scratch.txt'));
    const notRepo = join(tmp, 'not-a-repo');
    mkdirSync(notRepo);
    expect(() => resolveGbrainRef(notRepo, { remote, lsRemote: never })).toThrow(/HE-GBRAIN-009 .*not a git checkout/);
  });
});

describe('the scratch preregistration and the check directory', () => {
  test('one cell per harness and rung on the dev split, the told preamble on told rungs, and a prereg that passes loadPrereg and buildManifest', () => {
    const { cells, skipped } = paidCells(['openclaw', 'hermes'], ['told', 'docs', 'verbs-told'], { toldPreamble: 'tests/fixtures/preamble.md', reps: 2 });
    expect(skipped).toEqual([]);
    expect(cells.map((c) => c.id)).toEqual(['openclaw-haiku-gbrain-told', 'hermes-haiku-gbrain-told', 'openclaw-haiku-gbrain-docs', 'hermes-haiku-gbrain-docs', 'openclaw-haiku-gbrain-verbs-told', 'hermes-haiku-gbrain-verbs-told']);
    expect(cells[0]).toMatchObject({ harness: 'openclaw', split: 'dev', repetitions: 2, gbrain: { surface: 'starter' }, preamble: 'tests/fixtures/preamble.md' });
    expect(cells[2]!.preamble).toBeUndefined();
    expect(cells[2]!.gbrain).toEqual({ surface: 'starter', install: 'gbrain-docs' });
    expect(cells[4]!.gbrain).toEqual({ surface: 'verbs' });
    const dir = join(tmp, 'paid');
    mkdirSync(dir, { recursive: true });
    const prereg = scratchPrereg({ runId: 'gbrain-check-20261024T000000Z', cells, spendCapUsd: 2, gbrainSha: 'a'.repeat(40), rungs: ['told', 'docs', 'verbs-told'], harnesses: ['openclaw', 'hermes'] });
    expect(prereg.question).toMatch(/^UNCOUNTED gbrain-check of gbrain a{40} on the dev split/);
    expect(prereg.question).toContain('not a benchmark result');
    writeFileSync(join(dir, 'prereg.json'), JSON.stringify(prereg));
    const { prereg: loaded, sha256 } = loadPrereg(join(dir, 'prereg.json'));
    const m = buildManifest(loaded, sha256, '2026-10-24T00:00:00Z');
    expect(m.run_id).toBe('gbrain-check-20261024T000000Z');
    expect(m.trials).toHaveLength(6 * 10 * 2);
    expect(new Set(m.trials.map((t) => t.task)).size).toBe(10);
    expect(m.spend_cap_usd).toBe(2);
  });

  test('a told rung is skipped with a message while the ladder preamble is absent, an unknown rung is HE-RUN-002, every rung of the table is known', () => {
    const { cells, skipped } = paidCells(['openclaw'], ['told', 'mcp']);
    const present = existsSync(join(ROOT, TOLD_PREAMBLE));
    expect(skipped).toEqual(present ? [] : [expect.stringContaining(`rung told skipped: the told preamble ${TOLD_PREAMBLE} is not in this checkout`)]);
    expect(cells.map((c) => c.id)).toEqual(present ? ['openclaw-haiku-gbrain-told', 'openclaw-haiku-gbrain-mcp'] : ['openclaw-haiku-gbrain-mcp']);
    expect(() => paidCells(['openclaw'], ['plugin'])).toThrow(/HE-RUN-002 --rungs names "plugin"; the rungs are mcp, told, docs, installer, verbs-told, semantic-told, docs-semantic, told-company, told-scoped/);
    expect(Object.keys(RUNGS)).toEqual(['mcp', 'told', 'docs', 'installer', 'verbs-told', 'semantic-told', 'docs-semantic', 'told-company', 'told-scoped']);
    // gbrain#7481: the two company rungs take internal-task's company told clause, not the ladder's, and the scoped one adds scope sources.
    expect(RUNGS['told-scoped']).toEqual({ gbrain: { surface: 'starter', brain: 'company', scope: 'sources' }, told: true, preamble: 'tasks/multiuser/_shared/preamble.gbrain-company.md' });
    expect(paidCells(['hermes'], ['told-company', 'told-scoped'], { reps: 1 }).cells.map((c) => [c.id, c.gbrain, c.preamble])).toEqual([
      ['hermes-haiku-gbrain-told-company', { surface: 'starter', brain: 'company' }, 'tasks/multiuser/_shared/preamble.gbrain-company.md'],
      ['hermes-haiku-gbrain-told-scoped', { surface: 'starter', brain: 'company', scope: 'sources' }, 'tasks/multiuser/_shared/preamble.gbrain-company.md'],
    ]);
    expect(RUNGS['semantic-told']!.gbrain).toEqual({ surface: 'starter', embeddings: 'openai:text-embedding-3-small' });
    // internal-task: the installer rung is gbrain's own installer with the arm's preamble, so a check of it needs no told preamble.
    expect(RUNGS.installer).toEqual({ gbrain: { surface: 'starter', install: 'gbrain-installer' }, told: false });
    expect(paidCells(['openclaw', 'hermes'], ['installer'], { reps: 1 }).cells.map((c) => [c.id, c.gbrain])).toEqual([
      ['openclaw-haiku-gbrain-installer', { surface: 'starter', install: 'gbrain-installer' }], ['hermes-haiku-gbrain-installer', { surface: 'starter', install: 'gbrain-installer' }]]);
    expect(modelLabel('anthropic:claude-haiku-5-5')).toBe('haiku');
    expect(modelLabel('openai:gpt-5.5')).toBe('gpt');
  });

  test('the check directory defaults under results/gbrain-check/<ts>; anything under docs/benchmarks/ is HE-GBRAIN-010', () => {
    expect(checkDir(undefined, '20261024T000000Z')).toBe(join(ROOT, 'results', 'gbrain-check', '20261024T000000Z'));
    expect(checkDir('/tmp/elsewhere/x', 'ts')).toBe('/tmp/elsewhere/x');
    expect(() => checkDir('docs/benchmarks/2026-10-24-gbrain-arm/results', 'ts')).toThrow(/HE-GBRAIN-010 .*under docs\/benchmarks\//);
    expect(() => checkDir(join(ROOT, 'docs', 'benchmarks'), 'ts')).toThrow(/HE-GBRAIN-010/);
    expect(() => checkDir('results/../docs/benchmarks/x', 'ts')).toThrow(/HE-GBRAIN-010/);
  });

  test('the keyless tasks carry the fake adapter markers for the surface\'s search tool and the known page query', () => {
    const root = join(tmp, 'tasks');
    const ids = writeKeylessTasks(root);
    const starter = readFileSync(join(root, 'multiuser', 'dev', ids.starter, 'task.toml'), 'utf8');
    const verbs = readFileSync(join(root, 'multiuser', 'dev', ids.verbs, 'task.toml'), 'utf8');
    expect(starter).toContain('[fake:gbrain tools/list {}]');
    expect(starter).toContain(`[fake:gbrain search {"query":"${KNOWN_PAGE.query}","limit":3}]`);
    const ingest = readFileSync(join(root, 'multiuser', 'dev', ids.ingest, 'task.toml'), 'utf8');
    for (const verb of ['search', 'query', 'recall']) expect(ingest).toContain(`[fake:gbrain ${verb} {"query":"${INGEST_CODE_WORD}","limit":10}]`);
    expect(verbs).toContain(`[fake:gbrain recall {"query":"${KNOWN_PAGE.query}","limit":3}]`);
    expect(KNOWN_PAGE.slug.startsWith('dev/')).toBe(true);
    // The known page is a dev channel's source page in the world data, so the bot-visible brain holds it.
    const world = JSON.parse(readFileSync(join(ROOT, 'world', 'seed', 'world.json'), 'utf8')) as { channels: Array<{ split: string; kind: string; source_slugs: string[] }> };
    expect(world.channels.some((c) => c.split === 'dev' && c.kind !== 'dm' && c.source_slugs.includes(KNOWN_PAGE.slug.slice(4)))).toBe(true);
  });

  test('parseArgs: defaults, the paid mode, and refusals', () => {
    expect(parseArgs(['--gbrain', 'master'])).toMatchObject({ gbrain: 'master', harnesses: ['fake'], rungs: ['told'], reps: 2, model: 'anthropic:claude-haiku-5-5', spendCap: 2, baseline: DEFAULT_BASELINE, dryRun: false, strictPins: false, expectHook: false });
    expect(parseArgs(['--gbrain', 'x', '--expect-hook'])).toMatchObject({ expectHook: true });
    expect(parseArgs(['--gbrain', 'x', '--harness', 'openclaw,hermes', '--rungs', 'told,docs', '--reps', '1', '--spend-cap', '0.5', '--write-baseline', '--force', '--dry-run'])).toMatchObject({ harnesses: ['openclaw', 'hermes'], rungs: ['told', 'docs'], reps: 1, spendCap: 0.5, writeBaseline: true, force: true, dryRun: true });
    expect(() => parseArgs([])).toThrow(/HE-GBRAIN-009 missing --gbrain/);
    expect(() => parseArgs(['--gbrain', 'x', '--harness', 'qm'])).toThrow(/HE-RUN-002 --harness names "qm"/);
    expect(() => parseArgs(['--gbrain', 'x', '--parallel', '3'])).toThrow(/HE-RUN-002 unknown argument --parallel.*\[--expect-hook\]/);
    expect(() => parseArgs(['--gbrain', 'x', '--reps', '0'])).toThrow(/HE-RUN-002 --reps/);
  });
});

// A compact evidence fixture: a three-file bundle, the four views derived from it the way export-install.sh derives them,
// both surfaces listing what the pin says, a retrieval that returns the known page, and the docs trial's mount.
function healthyEvidence(): KeylessEvidence {
  const files = [
    { path: 'hermes/dev/.hermes.md', sha256: 'c'.repeat(64), bytes: 2790 },
    { path: 'hermes/heldout/.hermes.md', sha256: 'd'.repeat(64), bytes: 3749 },
    { path: 'hermes/workspace/skills/brain-ops/SKILL.md', sha256: 'b'.repeat(64), bytes: 100 },
    { path: 'openclaw/workspace/skills/brain-ops/SKILL.md', sha256: 'a'.repeat(64), bytes: 100 },
  ];
  const bundle = { digest: 'e'.repeat(64), files };
  const view = (harness: 'openclaw' | 'hermes', split: 'dev' | 'heldout'): ViewEvidence => {
    const mine = files.filter((f) => f.path.startsWith(`${harness}/workspace/`) || (harness === 'hermes' && f.path === `hermes/${split}/.hermes.md`));
    return {
      harness, split, dir: `/scratch/${harness}/${split}`, error: null, context_bytes: harness === 'hermes' ? (split === 'dev' ? 2790 : 3749) : null,
      manifest: { harness, split, gbrain_commit: '0'.repeat(40), gbrain_version: '0.60.431.0', bundle_digest: bundle.digest, view_digest: viewDigestFromBundle(files, harness, split), workspace_entries: ['skills'], skills: 1,
        context: harness === 'hermes' ? { path: '.hermes.md', bytes: split === 'dev' ? 2790 : 3749, tokens: 700, kept_slugs: ['dev/chats/north-team-random'] } : null,
        files: mine.map((f) => ({ ...f, source_path: f.path, path: f.path.endsWith('.hermes.md') ? '.hermes.md' : f.path.replace(`${harness}/`, '') })) },
    };
  };
  const starterTools = ['get_page', 'put_page', 'list_pages', 'search', 'query', 'get_backlinks', 'traverse_graph', 'resolve_slugs', 'capture', 'edit_page', 'add_timeline_entry', ...pin.surfaces.verbs!.names!];
  while (starterTools.length < pin.surfaces.starter!.tools) starterTools.push(`tool_${starterTools.length}`);
  const surface = (s: 'starter' | 'verbs', tools: string[]): KeylessEvidence['surfaces'][number] => ({
    surface: s, healthy: true, ready_ms: 2400, version: '0.60.431.0', tools,
    trial: { termination: 'completed', exits: [0], sidecar_ready_ms: 2300, events_file: `/scratch/${s}/events.jsonl`, list_count: tools.length, retrieval: { tool: `gbrain.${pin.surfaces[s]!.search_tool}`, outcome: 'ok', error: null, pages: [KNOWN_PAGE.slug] } },
  });
  const openclawDev = view('openclaw', 'dev');
  return {
    image: 'harness-eval/gbrain:check-fixture', pin, known: KNOWN_PAGE,
    surfaces: [surface('starter', starterTools), surface('verbs', [...pin.surfaces.verbs!.names!])],
    bundle, views: [openclawDev, view('openclaw', 'heldout'), view('hermes', 'dev'), view('hermes', 'heldout')],
    docs: { termination: 'completed', install_bundle: { harness: 'openclaw', split: 'dev', files: 1, view_digest: openclawDev.manifest!.view_digest }, ready_install: { dir: '/he-gbrain-install', split: 'dev', files: 2, writable: false }, expected_view_digest: openclawDev.manifest!.view_digest, expected_files: 1 },
  };
}

describe('keyless assertions', () => {
  test('a healthy fixture passes every assertion with no pin diff', () => {
    const v = keylessAssertions(healthyEvidence());
    expect(v.failures).toEqual([]);
    expect(v.pin_diffs).toEqual([]);
    expect(v.passed.length).toBeGreaterThanOrEqual(20);
    expect(v.passed).toContain(`ok surface=starter gbrain.search for "ticket 4092" returned ${KNOWN_PAGE.slug} (1 page(s))`);
    expect(v.passed).toContain('ok view=hermes/heldout .hermes.md 3749 bytes, 1 kept slugs');
  });

  // internal-task: the live-ingestion proof. Every message is a committed fact, the turn-1 DM lands in the member's private source, and the
  // search on turn 3 returns that fact (by id, not the searcher's own marker) to the member and never to another member.
  test('ingest evidence: the healthy trial passes; a leaked DM fact, a search that only finds its own marker, and a failed write each fail', () => {
    const dm = SCOPED_ACTORS.reader;
    const other = SCOPED_ACTORS.non_reader;
    const write = (seq: number, author: string, source: string, fact_id: string | null = String(seq)) =>
      ({ seq, channel: 'C1', author, source, outcome: fact_id === null ? 'error' : 'ok', error: fact_id === null ? 'recovery_required' : null, fact_id, latency_ms: 80, skipped: null });
    const writes = [
      write(1, dm, `private-${dm}`), write(2, 'assistant', `private-${dm}`),
      write(3, other, 'channel-general'), write(4, 'assistant', 'channel-general'),
      write(5, dm, 'channel-general'), write(6, 'assistant', 'channel-general'),
    ];
    const healthy = (): IngestEvidence => ({
      code_word: INGEST_CODE_WORD, dm_member: dm, other_member: other,
      grants: { [dm]: [`private-${dm}`, 'channel-general'], [other]: [`private-${other}`, 'channel-general'] },
      trial: {
        termination: 'completed', events_file: '/scratch/ingest/events.jsonl', writes,
        searches: [
          { seq: 10, grant: other, tool: 'gbrain.search', outcome: 'ok', error: null, facts: [{ id: '3', fact: `marker ${INGEST_CODE_WORD}`, source_id: null }], pages: [] },
          { seq: 11, grant: other, tool: 'gbrain.query', outcome: 'ok', error: null, facts: [{ id: '3', fact: `marker ${INGEST_CODE_WORD}`, source_id: 'channel-general' }], pages: [] },
          { seq: 12, grant: other, tool: 'gbrain.recall', outcome: 'ok', error: null, facts: [{ id: '3', fact: `marker ${INGEST_CODE_WORD}`, source_id: null }], pages: [] },
          { seq: 20, grant: dm, tool: 'gbrain.search', outcome: 'ok', error: null, facts: [{ id: '1', fact: `the instruction ${INGEST_CODE_WORD}`, source_id: null }, { id: '5', fact: `marker ${INGEST_CODE_WORD}`, source_id: null }], pages: [] },
          { seq: 21, grant: dm, tool: 'gbrain.query', outcome: 'ok', error: null, facts: [{ id: '1', fact: `the instruction ${INGEST_CODE_WORD}`, source_id: `private-${dm}` }, { id: '5', fact: `marker ${INGEST_CODE_WORD}`, source_id: 'channel-general' }], pages: [] },
          { seq: 22, grant: dm, tool: 'gbrain.recall', outcome: 'ok', error: null, facts: [{ id: '1', fact: `the instruction ${INGEST_CODE_WORD}`, source_id: null }, { id: '5', fact: `marker ${INGEST_CODE_WORD}`, source_id: null }], pages: [] },
        ],
      },
    });
    const run = (g: IngestEvidence) => { const e = healthyEvidence(); e.ingest = g; return keylessAssertions(e); };
    const good = run(healthy());
    expect(good.failures).toEqual([]);
    expect(good.passed).toContain('ok ingest=member/dev 6 messages ingested as facts into 2 sources, median 80 ms per write, slowest 80 ms');
    expect(good.passed).toContain(`ok ingest=member/dev the turn-1 DM landed in private-${dm} as fact #1`);
    for (const verb of ['search', 'query', 'recall']) expect(good.passed).toContain(`ok ingest=member/dev ${verb}: the turn-1 DM (fact #1) came back to ${dm} on turn 3 (2 fact(s) from private-${dm}, channel-general) and not to ${other} on turn 2 (1 fact(s) from channel-general, their own fact #3 among them)`);
    // The other member's search returning nothing is not a pass: the positive control (their own turn-2 marker) is missing.
    const empty = healthy();
    empty.trial!.searches[0]!.facts = [];
    expect(run(empty).failures).toEqual([`HE-GBRAIN-008 ingest=member/dev ${other}'s turn-2 search (positive control): expected fact #3 (their own turn-2 message in channel-general), actual no facts (/scratch/ingest/events.jsonl)`]);
    // A query that leaks the DM fact fails on its own, and a missing query by either member is a failure of its own.
    const queryLeak = healthy();
    queryLeak.trial!.searches[1]!.facts.push({ id: '1', fact: `the instruction ${INGEST_CODE_WORD}`, source_id: `private-${dm}` });
    expect(run(queryLeak).failures).toEqual([
      `HE-GBRAIN-008 ingest=member/dev query for "${INGEST_CODE_WORD}" as ${other} fact sources: expected inside ${other}'s grant, actual #1 from private-${dm} (/scratch/ingest/events.jsonl)`,
      `HE-GBRAIN-008 ingest=member/dev ${other}'s turn-2 query: expected no fact from private-${dm}, actual 1 (#1) (/scratch/ingest/events.jsonl)`,
    ]);
    const noQuery = healthy();
    noQuery.trial!.searches = noQuery.trial!.searches.filter((s) => s.tool !== 'gbrain.query' || s.grant !== dm);
    expect(run(noQuery).failures).toEqual(['HE-GBRAIN-008 ingest=member/dev a query by the member and by another member through the tap: expected one each, actual no member query, other (/scratch/ingest/events.jsonl)']);
    // A message the brain had no source for is a routing gap the check task must not have.
    const gap = healthy();
    gap.trial!.writes = [...writes, { ...write(7, 'assistant', 'private-odile-brandt'), fact_id: null, skipped: 'no ingest token for source private-odile-brandt' }];
    expect(run(gap).failures).toEqual(['HE-GBRAIN-008 ingest=member/dev ingest routing: expected a source for every conversation of the check task, actual 1 skipped (no ingest token for source private-odile-brandt) (/scratch/ingest/events.jsonl)']);
    // The other member's search returned the DM fact: a leak.
    const leak = healthy();
    leak.trial!.searches[0]!.facts.push({ id: '1', fact: `the instruction ${INGEST_CODE_WORD}`, source_id: null });
    expect(run(leak).failures).toEqual([
      `HE-GBRAIN-008 ingest=member/dev search for "${INGEST_CODE_WORD}" as ${other} fact sources: expected inside ${other}'s grant, actual #1 from private-${dm} (/scratch/ingest/events.jsonl)`,
      `HE-GBRAIN-008 ingest=member/dev ${other}'s turn-2 search: expected no fact from private-${dm}, actual 1 (#1) (/scratch/ingest/events.jsonl)`,
    ]);
    // The member's search found only its own turn-3 marker in the private source, not the turn-1 instruction.
    const marker = healthy();
    marker.trial!.searches.find((s) => s.tool === 'gbrain.search' && s.grant === dm)!.facts = [{ id: '5', fact: `marker ${INGEST_CODE_WORD}`, source_id: null }];
    expect(run(marker).failures).toEqual([`HE-GBRAIN-008 ingest=member/dev ${dm}'s turn-3 search: expected fact #1 (the turn-1 DM, holding the code word), actual 1 fact(s): #5 from channel-general (/scratch/ingest/events.jsonl)`]);
    // A refused write, and a fact id the trial never wrote.
    const refused = healthy();
    refused.trial!.writes = [...writes, write(7, other, 'channel-general', null)];
    refused.trial!.searches[0]!.facts = [{ id: '99', fact: 'stray', source_id: null }];
    expect(run(refused).failures).toEqual([
      'HE-GBRAIN-008 ingest=member/dev ingest writes: expected every write ok, actual 1 failed (channel-general: recovery_required) (/scratch/ingest/events.jsonl)',
      `HE-GBRAIN-008 ingest=member/dev search for "${INGEST_CODE_WORD}" as ${other} facts mapped to ingest events: expected every fact id written this trial, actual 1 unmapped (#99) (/scratch/ingest/events.jsonl)`,
      `HE-GBRAIN-008 ingest=member/dev ${other}'s turn-2 search (positive control): expected fact #3 (their own turn-2 message in channel-general), actual 1 fact(s): #99 from unmapped (/scratch/ingest/events.jsonl)`,
    ]);
    // No trial at all.
    expect(run({ ...healthy(), trial: null }).failures).toEqual(['HE-GBRAIN-008 ingest=member/dev fake trial under brain member, scope member, ingest live: expected a completed trial, actual none (trials.jsonl)']);
  });

  // internal-task: the installer view per harness is asserted when the image's gbrain has the setup target and reported, not failed, when it has not.
  test('installer evidence: an unavailable installer is a reported line; an available one is checked against the bundle, the block marker and the Hermes seed', () => {
    const e = healthyEvidence();
    e.bundle!.files.push({ path: 'openclaw/installer/workspace/AGENTS.md', sha256: '1'.repeat(64), bytes: 1002 }, { path: 'hermes/installer/home/SOUL.md', sha256: '2'.repeat(64), bytes: 1677 });
    const view = (harness: 'openclaw' | 'hermes', path: string, sha: string, seed: boolean): InstallerEvidence => ({
      harness, available: true, reason: null, dir: `/scratch/${harness}-installer/dev`, error: null, block_present: true,
      manifest: { harness, split: 'dev', install: 'gbrain-installer', gbrain_commit: '9'.repeat(40), gbrain_version: '0.60.437.0', bundle_digest: e.bundle!.digest, view_digest: viewDigestFromBundle(e.bundle!.files, harness, 'dev', 'gbrain-installer'),
        workspace_entries: harness === 'openclaw' ? ['AGENTS.md'] : [], skills: 0, context: null,
        installer: { argv: ['gbrain', 'setup', harness, '--instructions-only'], files: [`${harness}/installer/${path}`], block_version: 'v1', ...(seed ? { seed: { source: '/opt/sidecar/hermes/SOUL.md', hermes_commit: 'f'.repeat(40), sha256: '3'.repeat(64), bytes: 667 } } : {}) },
        files: [{ path, source_path: `${harness}/installer/${path}`, sha256: sha, bytes: 1002 }] },
    });
    e.installer = [view('openclaw', 'workspace/AGENTS.md', '1'.repeat(64), false), view('hermes', 'home/SOUL.md', '2'.repeat(64), true)];
    const v = keylessAssertions(e);
    expect(v.failures).toEqual([]);
    expect(v.passed).toContain(`ok installer=openclaw workspace/AGENTS.md (block v1), view digest ${e.installer[0]!.manifest!.view_digest.slice(0, 12)} matches the bundle manifest`);
    expect(v.passed).toContain(`ok installer=hermes home/SOUL.md (block v1), view digest ${e.installer[1]!.manifest!.view_digest.slice(0, 12)} matches the bundle manifest; home seeded with Hermes SOUL.md 333333333333 (667 bytes)`);
    expect(v.passed).toContain('ok installer=openclaw no per-turn hook in this gbrain commit (the block-only installer)');
    // For a pin that is meant to carry the hook, --expect-hook makes the block-only bundle a failure per harness instead of a pass line.
    expect(keylessAssertions(e, { expectHook: true }).failures).toEqual([
      'HE-GBRAIN-008 installer=openclaw per-turn hook (--expect-hook): expected installer.turn_hook in the bundle manifest, actual none (the block-only installer) (/scratch/openclaw-installer/dev/manifest.json)',
      'HE-GBRAIN-008 installer=hermes per-turn hook (--expect-hook): expected installer.turn_hook in the bundle manifest, actual none (the block-only installer) (/scratch/hermes-installer/dev/manifest.json)',
    ]);
    // gbrain#7489 at 10949a15: a bundle with the per-turn hook passes when every hook file holds the rule and OpenClaw's three commands are printed.
    const hooked = healthyEvidence();
    hooked.bundle!.files.push({ path: 'openclaw/installer/workspace/AGENTS.md', sha256: '1'.repeat(64), bytes: 1002 }, { path: 'hermes/installer/home/SOUL.md', sha256: '2'.repeat(64), bytes: 1677 });
    hooked.installer = [
      { ...view('openclaw', 'workspace/AGENTS.md', '1'.repeat(64), false), hook: { files: ['state/gbrain/gbrain-turn-rule/index.js', 'state/gbrain/gbrain-turn-rule/openclaw.plugin.json', 'state/gbrain/gbrain-turn-rule/package.json'], action: 'print', rule_files: ['state/gbrain/gbrain-turn-rule/index.js'], commands: 3 } },
      { ...view('hermes', 'home/SOUL.md', '2'.repeat(64), true), hook: { files: ['home/config.yaml', 'home/shell-hooks-allowlist.json'], action: 'write', rule_files: ['home/config.yaml', 'home/shell-hooks-allowlist.json'], commands: 0 } },
    ];
    const hv = keylessAssertions(hooked);
    expect(hv.failures).toEqual([]);
    expect(hv.passed).toContain('ok installer=openclaw per-turn hook print: 3 files, the rule in state/gbrain/gbrain-turn-rule/index.js, three install commands printed');
    expect(hv.passed).toContain('ok installer=hermes per-turn hook write: 2 files, the rule in home/config.yaml, home/shell-hooks-allowlist.json');
    hooked.installer[0]!.hook = { ...hooked.installer[0]!.hook!, commands: 1, rule_files: [] };
    expect(keylessAssertions(hooked).failures).toEqual([
      'HE-GBRAIN-008 installer=openclaw per-turn hook files: expected a hook file holding the rule text, actual none of state/gbrain/gbrain-turn-rule/index.js, state/gbrain/gbrain-turn-rule/openclaw.plugin.json, state/gbrain/gbrain-turn-rule/package.json (/scratch/openclaw-installer/dev)',
      'HE-GBRAIN-008 installer=openclaw per-turn hook install commands: expected the three openclaw commands, actual 1 (/scratch/openclaw-installer/dev/manifest.json)',
    ]);
    // Hermes's hook is written into config.yaml by setup itself, so no install command is expected of it: a hook without the rule is one failure, not two.
    const hermesOnly = healthyEvidence();
    hermesOnly.bundle!.files.push({ path: 'hermes/installer/home/SOUL.md', sha256: '2'.repeat(64), bytes: 1677 });
    hermesOnly.installer = [{ ...view('hermes', 'home/SOUL.md', '2'.repeat(64), true), hook: { files: ['home/config.yaml', 'home/shell-hooks-allowlist.json'], action: 'write', rule_files: [], commands: 0 } }];
    expect(keylessAssertions(hermesOnly).failures).toEqual(['HE-GBRAIN-008 installer=hermes per-turn hook files: expected a hook file holding the rule text, actual none of home/config.yaml, home/shell-hooks-allowlist.json (/scratch/hermes-installer/dev)']);
    const absent = healthyEvidence();
    absent.installer = [{ harness: 'openclaw', available: false, reason: 'gbrain setup openclaw --instructions-only exited 1: unknown harness openclaw', dir: '/scratch/openclaw-installer/dev', manifest: null, error: null, block_present: null }];
    const a = keylessAssertions(absent);
    expect(a.failures).toEqual([]);
    expect(a.passed).toContain('ok installer=openclaw not in this gbrain commit (gbrain setup openclaw --instructions-only exited 1: unknown harness openclaw); the installer rung needs gbrain#7489 or later');
    const broken = healthyEvidence();
    broken.bundle!.files.push({ path: 'hermes/installer/home/SOUL.md', sha256: '2'.repeat(64), bytes: 1677 });
    broken.installer = [{ ...view('hermes', 'home/SOUL.md', '4'.repeat(64), false), block_present: false }, { harness: 'openclaw', available: true, reason: null, dir: '/scratch/openclaw-installer/dev', manifest: null, error: 'HE-GBRAIN-006 export-install.sh openclaw dev gbrain-installer failed', block_present: null }];
    expect(keylessAssertions(broken).failures).toEqual([
      expect.stringContaining('HE-GBRAIN-008 installer=hermes file digests against the bundle manifest: expected every view file listed with the same sha256, actual 1 differ (home/SOUL.md)'),
      'HE-GBRAIN-008 installer=hermes brain-first block: expected every installer instruction file holds <!-- gbrain:brain-first:begin -->, actual a file without it (/scratch/hermes-installer/dev)',
      'HE-GBRAIN-008 installer=hermes Hermes SOUL.md seed: expected recorded (sha256, bytes, hermes commit), actual absent (/scratch/hermes-installer/dev/manifest.json)',
      'HE-GBRAIN-008 installer=openclaw export and verify: expected every file present with its sha256, actual HE-GBRAIN-006 export-install.sh openclaw dev gbrain-installer failed (/scratch/openclaw-installer/dev/manifest.json)',
    ]);
  });

  test('a healthy catalog with a broken retrieval fails under HE-GBRAIN-008 naming surface, expected, actual and file', () => {
    const e = healthyEvidence();
    e.surfaces[0]!.trial!.retrieval = { tool: 'gbrain.search', outcome: 'error', error: 'tool_error', pages: [] };
    e.surfaces[1]!.trial!.retrieval = { tool: 'gbrain.recall', outcome: 'ok', error: null, pages: [] };
    const v = keylessAssertions(e);
    expect(v.failures).toEqual([
      'HE-GBRAIN-008 surface=starter retrieval gbrain.search outcome: expected ok (no RPC error, no isError), actual error (tool_error) (/scratch/starter/events.jsonl)',
      `HE-GBRAIN-008 surface=verbs retrieval gbrain.recall effect.pages for "ticket 4092": expected contains ${KNOWN_PAGE.slug}, actual no pages (/scratch/verbs/events.jsonl)`,
    ]);
    // The catalog assertions still pass: the failure is the retrieval, not the tool list.
    expect(v.passed).toContain('ok surface=starter 33 tools (pin 33)');
    expect(v.passed).toContain('ok surface=verbs tools/list through the tap counts 7');
    const wrongPage = healthyEvidence();
    wrongPage.surfaces[0]!.trial!.retrieval!.pages = ['dev/chats/other-page'];
    expect(keylessAssertions(wrongPage).failures).toEqual([expect.stringMatching(/^HE-GBRAIN-008 surface=starter retrieval gbrain.search effect.pages .*actual dev\/chats\/other-page/)]);
    const rpc = healthyEvidence();
    rpc.surfaces[1]!.trial!.retrieval = { tool: 'gbrain.recall', outcome: 'error', error: 'rpc_-32602', pages: [] };
    expect(keylessAssertions(rpc).failures).toEqual([expect.stringContaining('surface=verbs retrieval gbrain.recall outcome: expected ok (no RPC error, no isError), actual error (rpc_-32602)')]);
    const noTrial = healthyEvidence();
    noTrial.surfaces[0]!.trial = null;
    expect(keylessAssertions(noTrial).failures).toEqual(['HE-GBRAIN-008 surface=starter fake trial through the runner: expected a recorded trial, actual none (probe of harness-eval/gbrain:check-fixture)']);
  });

  test('a tool count off the pin is a diff, a failure only under --strict-pins; a missing search tool or verb always fails', () => {
    const e = healthyEvidence();
    e.surfaces[0]!.tools = e.surfaces[0]!.tools.slice(0, 30);
    e.surfaces[0]!.trial!.list_count = 30;
    const lax = keylessAssertions(e);
    expect(lax.failures).toEqual([]);
    expect(lax.pin_diffs).toEqual(['surface=starter tool count 30 differs from gbrain/pin.json 33']);
    const strict = keylessAssertions(e, { strictPins: true });
    expect(strict.failures).toEqual(['HE-GBRAIN-008 surface=starter tool count (--strict-pins): expected 33, actual 30 (gbrain/pin.json)']);
    const noSearch = healthyEvidence();
    noSearch.surfaces[0]!.tools = noSearch.surfaces[0]!.tools.map((t) => (t === 'search' ? 'find' : t));
    expect(keylessAssertions(noSearch).failures).toEqual(['HE-GBRAIN-008 surface=starter search tool search present: expected present, actual absent from 33 tools (gbrain/pin.json)']);
    const noRecall = healthyEvidence();
    noRecall.surfaces[1]!.tools = noRecall.surfaces[1]!.tools.filter((t) => t !== 'recall');
    noRecall.surfaces[1]!.trial!.list_count = 6;
    const v = keylessAssertions(noRecall);
    expect(v.pin_diffs).toEqual(['surface=verbs tool count 6 differs from gbrain/pin.json 7; missing recall, extra none']);
    expect(v.failures).toEqual(['HE-GBRAIN-008 surface=verbs search tool recall present: expected present, actual absent from 6 tools (gbrain/pin.json)', 'HE-GBRAIN-008 surface=verbs tool recall present: expected present, actual absent (gbrain/pin.json)']);
    const down = healthyEvidence();
    down.surfaces[1] = { surface: 'verbs', healthy: false, ready_ms: null, version: null, tools: [], trial: null };
    expect(keylessAssertions(down).failures).toEqual(['HE-GBRAIN-008 surface=verbs sidecar health: expected /health ok with a tool list, actual no healthy sidecar (probe of harness-eval/gbrain:check-fixture)']);
  });

  test('bundle views: a digest off the image manifest, a failed export, an empty Hermes context and a bad mount each fail', () => {
    const e = healthyEvidence();
    e.views[2]!.manifest!.view_digest = 'f'.repeat(64);
    e.views[3]!.context_bytes = 0;
    e.views[1] = { ...e.views[1]!, manifest: null, error: 'HE-GBRAIN-006 export-install.sh openclaw heldout failed' };
    e.docs!.ready_install = { dir: '/he-gbrain-install', split: 'dev', files: 2, writable: true };
    const v = keylessAssertions(e);
    expect(v.failures).toEqual([
      'HE-GBRAIN-008 view=openclaw/heldout export and verify: expected every file present with its sha256, actual HE-GBRAIN-006 export-install.sh openclaw heldout failed (/scratch/openclaw/heldout/manifest.json)',
      expect.stringMatching(/^HE-GBRAIN-008 view=hermes\/dev view digest against the bundle manifest: expected [0-9a-f]{12}, actual ffffffffffff /),
      'HE-GBRAIN-008 view=hermes/heldout .hermes.md: expected a non-empty compiled context, actual 0 bytes (/scratch/hermes/heldout/.hermes.md)',
      'HE-GBRAIN-008 docs=fake/dev adapter ready gbrain_install: expected {dir: /he-gbrain-install, split: dev, files: 2 (the view plus manifest.json), writable: false}, actual {"dir":"/he-gbrain-install","split":"dev","files":2,"writable":true} (logs/ready)',
    ]);
    const stale = healthyEvidence();
    stale.bundle!.files[3]!.sha256 = '9'.repeat(64);
    expect(keylessAssertions(stale).failures.filter((l) => l.includes('view=openclaw/dev'))).toEqual([
      expect.stringContaining('view=openclaw/dev view digest against the bundle manifest'),
      'HE-GBRAIN-008 view=openclaw/dev file digests against the bundle manifest: expected every view file listed with the same sha256, actual 1 differ (workspace/skills/brain-ops/SKILL.md) (/scratch/openclaw/dev/manifest.json)',
    ]);
    const noBundle = healthyEvidence();
    noBundle.bundle = null;
    expect(keylessAssertions(noBundle).failures).toEqual(['HE-GBRAIN-008 bundle image /install/manifest.json: expected a bundle manifest with a digest, actual none (harness-eval/gbrain:check-fixture)']);
    const noRecord = healthyEvidence();
    noRecord.docs = { termination: 'infra_error', error: 'HE-GBRAIN-006 the view does not match', install_bundle: undefined, ready_install: null, expected_view_digest: null, expected_files: null };
    expect(keylessAssertions(noRecord).failures).toEqual([
      'HE-GBRAIN-008 docs=fake/dev gbrain-docs trial termination: expected completed, actual infra_error (HE-GBRAIN-006 the view does not match) (trials.jsonl)',
      'HE-GBRAIN-008 docs=fake/dev record gbrain.install_bundle: expected present, actual absent (trials.jsonl)',
      'HE-GBRAIN-008 docs=fake/dev adapter ready gbrain_install: expected {dir: /he-gbrain-install, writable: false}, actual absent (logs/ready)',
    ]);
  });
});

const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
const records = (name: string): TrialRecord[] => readFileSync(join(FIXTURES, name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
const manifest = fixture<Manifest>('manifest.json');
const rungOf = { 'openclaw-haiku-gbrain-told': 'told', 'hermes-haiku-gbrain-told': 'told' };
const images = { openclaw: 'sha256:' + '1'.repeat(64), hermes: 'sha256:' + '2'.repeat(64) };
const fingerprint = () => fingerprintOf(manifest, rungOf, { harnessEvalsCommit: 'fixture-commit', harnessImages: images });
const input = (over: Partial<Parameters<typeof renderSummary>[0]> = {}) => ({
  gbrain: { sha: 'ab'.repeat(20), version: '0.60.431.0' }, harnessImages: images, rungs: ['told'], manifest, records: records('trials.jsonl'), summary: fixture<SummaryJson>('summary.json'),
  rungOf, fingerprint: fingerprint(), baseline: readBaseline(join(FIXTURES, 'baseline.json')), baselinePath: 'tests/fixtures/gbrain-check/baseline.json', receipts: 'results/gbrain-check/fixture', ...over,
});

describe('the paid summary against a baseline', () => {
  test('the fixture baseline validates, its fingerprint equals the one computed from the fixture manifest, and the fingerprint is order-independent', () => {
    const b = readBaseline(join(FIXTURES, 'baseline.json'))!;
    expect(b.run_id).toBe('gbrain-check-20261024T000000Z');
    expect(b.fingerprint.sha256).toBe(fingerprint().sha256);
    expect(b.fingerprint.fields).toMatchObject({ model: 'anthropic:claude-haiku-5-5', repetitions: 2, sharding: 'sequential', tasks: ['sc-01-north-two-asks'], harness_images: images });
    expect(b.fingerprint.fields.cells['openclaw-haiku-gbrain-told']).toEqual({ harness: 'openclaw', rung: 'told', surface: 'starter', install: 'mcp', embeddings: 'off', preamble: 'tests/fixtures/preamble.md' });
    expect(Object.keys(b.fingerprint.fields.preambles)).toEqual(['tests/fixtures/preamble.md']);
    const shuffled = JSON.parse(JSON.stringify({ sharding: b.fingerprint.fields.sharding, tasks: b.fingerprint.fields.tasks, model: b.fingerprint.fields.model, cells: b.fingerprint.fields.cells, preambles: b.fingerprint.fields.preambles, repetitions: b.fingerprint.fields.repetitions, harness_evals_commit: b.fingerprint.fields.harness_evals_commit, harness_images: b.fingerprint.fields.harness_images })) as typeof b.fingerprint.fields;
    expect(fingerprintSha(shuffled)).toBe(b.fingerprint.sha256);
  });

  test('a complete comparable run: header, gating rows with the baseline beside them, pass with both intervals, the UNCOUNTED footer, exit 0 semantics', () => {
    const out = renderSummary(input());
    const lines = out.text.split('\n');
    expect(out.incomplete).toBe(false);
    expect(out.comparable).toBe(true);
    expect(lines[0]).toBe('gbrain-check  gbrain abababababab (0.60.431.0)  harness images openclaw 11111111 hermes 22222222  rungs told  dev split, 1 tasks x 2 reps  UNCOUNTED');
    expect(lines[1]).toMatch(/^cell\s+discovered\s+used\s+calls\/trial\s+cross-scope\(gbrain\)\s+pass \(dev, 2 reps; informational\)\s+usd\/trial$/);
    const openclaw = lines.find((l) => l.startsWith('openclaw-haiku-gbrain-told'))!;
    expect(openclaw).toContain('2 (baseline 2)/2');
    expect(openclaw).toContain('1/2 [50%, 50%] (baseline 1/2 [50%, 50%], delta +0 passes; intervals overlap at n=2)');
    const hermes = lines.find((l) => l.startsWith('hermes-haiku-gbrain-told'))!;
    expect(hermes).toContain('2/2 [100%, 100%] (baseline 1/2 [50%, 50%], delta +1 passes; intervals do not overlap at n=2)');
    expect(lines.at(-1)).toBe('UNCOUNTED: scratch preregistration gbrain-check-fixture; not a benchmark result. receipts: results/gbrain-check/fixture');
    expect(out.text).not.toContain('INCOMPLETE');
    expect(out.text).not.toContain('NOT_COMPARABLE');
    expect(out.cells['hermes-haiku-gbrain-told']).toMatchObject({ harness: 'hermes', rung: 'told', n: 2, excluded: 0, pass: { passes: 2, n: 2, by_task: { 'sc-01-north-two-asks': '2/2' } }, use: { discovered: 2, used: 2 } });
  });

  test('an incomplete run prints INCOMPLETE first, no pass figure for the cell that lost a trial, and the other cell keeps its figure', () => {
    const out = renderSummary(input({ records: records('trials.incomplete.jsonl'), summary: fixture<SummaryJson>('summary.incomplete.json') }));
    expect(out.incomplete).toBe(true);
    expect(out.reasons).toEqual(['1 infra_error']);
    const lines = out.text.split('\n');
    expect(lines[0]).toMatch(/^INCOMPLETE: 1 infra_error; no pass figure for a cell that lost trials, no baseline written, exit 3/);
    expect(lines.find((l) => l.startsWith('hermes-haiku-gbrain-told'))).toContain('not reported (lost 1 of 2 trials)');
    expect(lines.find((l) => l.startsWith('openclaw-haiku-gbrain-told'))).toContain('1/2 [50%, 50%] (baseline 1/2');
    expect(out.cells['hermes-haiku-gbrain-told']!.excluded).toBe(1);
    const capped = records('trials.jsonl').map((r, i) => (i === 0 ? { ...r, termination: 'model_error' as const, cap_stop: true } : r));
    const stopped = renderSummary(input({ records: capped }));
    expect(stopped.reasons).toEqual(['1 model_error', 'cap stop on 1 trial(s)']);
    const missing = renderSummary(input({ records: records('trials.jsonl').slice(0, 3) }));
    expect(missing.reasons).toEqual(['1 of 4 trials not recorded']);
    const noEvents = fixture<SummaryJson>('summary.json');
    noEvents.cells['openclaw-haiku-gbrain-told']!.gbrain.events_read = 1;
    expect(renderSummary(input({ summary: noEvents })).reasons).toEqual(['openclaw-haiku-gbrain-told: 1 trial(s) without an event log']);
  });

  test('a baseline with another fingerprint prints NOT_COMPARABLE naming the fields and suppresses every delta; no baseline or an empty one prints the pass column alone', () => {
    const other = fingerprintOf(manifest, rungOf, { harnessEvalsCommit: 'another-commit', harnessImages: { ...images, hermes: 'sha256:' + '3'.repeat(64) } });
    const out = renderSummary(input({ fingerprint: other }));
    expect(out.comparable).toBe(false);
    const lines = out.text.split('\n');
    expect(lines[0]).toBe('NOT_COMPARABLE: the baseline tests/fixtures/gbrain-check/baseline.json (gbrain cdcdcdcdcdcd, run gbrain-check-20261024T000000Z) has a different fingerprint: harness_evals_commit, harness_images; the delta is suppressed');
    expect(out.text).not.toContain('(baseline 1/2');
    expect(out.text).not.toContain('delta +');
    expect(lines.find((l) => l.startsWith('openclaw-haiku-gbrain-told'))).toContain('1/2 [50%, 50%] (not compared: fingerprint differs)');
    const none = renderSummary(input({ baseline: null }));
    expect(none.comparable).toBeNull();
    expect(none.text).toContain('1/2 [50%, 50%] (no baseline)');
    expect(none.text).toContain('no baseline: the pass column stands alone');
    const emptyPath = join(tmp, 'empty-baseline.json');
    writeFileSync(emptyPath, JSON.stringify({ schema_version: 1, empty: true, note: 'none yet' }));
    expect(readBaseline(emptyPath)).toBeNull();
  });

  test('--write-baseline refuses to overwrite without --force (HE-GBRAIN-010) and keeps the old file as .prev with it; a malformed baseline is refused', () => {
    const path = join(tmp, 'baseline', 'gbrain-check.baseline.json');
    const b = readBaseline(join(FIXTURES, 'baseline.json'))!;
    writeBaseline(path, b, false);
    expect(readBaseline(path)!.run_id).toBe(b.run_id);
    const next: Baseline = { ...b, run_id: 'gbrain-check-20261025T000000Z', written_at: '2026-10-25T00:00:00Z' };
    expect(() => writeBaseline(path, next, false)).toThrow(/HE-GBRAIN-010 .*already holds the baseline from gbrain-check-20261024T000000Z .*pass --force/);
    expect(readBaseline(path)!.run_id).toBe(b.run_id);
    writeBaseline(path, next, true);
    expect(readBaseline(path)!.run_id).toBe(next.run_id);
    expect(readBaseline(`${path}.prev`)!.run_id).toBe(b.run_id);
    writeBaseline(join(tmp, 'baseline', 'over-empty.json'), b, false);
    const overEmpty = join(tmp, 'baseline', 'empty.json');
    writeFileSync(overEmpty, JSON.stringify({ schema_version: 1, empty: true, note: '' }));
    writeBaseline(overEmpty, b, false);
    expect(readBaseline(overEmpty)!.run_id).toBe(b.run_id);
    expect(() => validateBaseline({ schema_version: 2 }, 'x.json')).toThrow(/HE-GBRAIN-010 x.json: schema_version must be 1/);
    expect(() => validateBaseline({ ...b, fingerprint: { ...b.fingerprint, sha256: '0'.repeat(64) } }, 'x.json')).toThrow(/fingerprint.sha256 does not match/);
    const lost = JSON.parse(JSON.stringify(b)) as Baseline;
    lost.cells['hermes-haiku-gbrain-told']!.excluded = 1;
    expect(() => validateBaseline(lost, 'x.json')).toThrow(/written only from a complete run/);
    expect(() => validateBaseline({ ...b, cells: {} }, 'x.json')).toThrow(/cells must name at least one cell/);
  });

  test('the committed scripts/gbrain-check.baseline.json is an explicit empty baseline or a valid one; no placeholder numbers', () => {
    const raw = JSON.parse(readFileSync(join(ROOT, DEFAULT_BASELINE), 'utf8')) as { schema_version: number; empty?: boolean; note?: string };
    expect(raw.schema_version).toBe(1);
    const b = validateBaseline(raw, DEFAULT_BASELINE);
    if (!b) expect(raw.note).toContain('--write-baseline');
    else expect(b.cells && Object.keys(b.cells).length).toBeGreaterThan(0);
  });
});

describe('the command line', () => {
  // Each case spawns bun on the script one to four times (a cold start and the plan each time); the GitHub runner took
  // more than bun's default 5 s for these on 2026-10-25 (run 40171750104) while a faster machine takes about 2 s.
  const CLI_TIMEOUT_MS = 30_000;
  const run = (args: string[], env: Record<string, string> = {}) => spawnSync('bun', [join(ROOT, 'scripts', 'gbrain-check.ts'), ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GBRAIN_CHECK_DIR: join(tmp, 'cli'), ...env } });
  const sha = 'a'.repeat(40);

  test('--dry-run in the paid mode prints the plan from the scratch preregistration and the prerequisites, keyless, with no key value', () => {
    const r = run(['--gbrain', sha, '--harness', 'openclaw,hermes', '--rungs', 'docs,told', '--reps', '1', '--spend-cap', '1', '--dry-run'], { ANTHROPIC_API_KEY: 'fake-anthropic-value-never-printed', OPENAI_API_KEY: 'fake-openai-value-never-printed' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`GBRAIN: ${sha} -> ${sha} (sha); image harness-eval/gbrain:check-aaaaaaaaaaaa`);
    expect(r.stdout).toContain('mode:       paid (openclaw, hermes; rungs docs, told; 1 reps; model anthropic:claude-haiku-5-5; spend cap $1; baseline scripts/gbrain-check.baseline.json)');
    expect(r.stdout).toContain('plan:       CELL: openclaw-haiku-gbrain-docs harness=openclaw mode=docker model=anthropic:claude-haiku-5-5 slice=multiuser split=dev task_set=v0.1 reps=1 trials=10');
    expect(r.stdout).toContain('plan:       CELL: hermes-haiku-gbrain-docs');
    expect(r.stdout).toContain('--max-output-tokens 128000 --stop-on-cap');
    expect(r.stdout).toContain('prerequisites:');
    expect(r.stdout).toContain('ANTHROPIC_API_KEY: set in this shell (read by the metering proxy only)');
    expect(r.stdout).not.toContain('never-printed');
    expect(r.stdout).toContain(`told preamble ${TOLD_PREAMBLE}: ${existsSync(join(ROOT, TOLD_PREAMBLE)) ? 'present' : 'absent'}`);
    expect(r.stdout).toContain('baseline scripts/gbrain-check.baseline.json:');
    expect(existsSync(join(tmp, 'cli', 'trials.jsonl'))).toBe(false);
  }, CLI_TIMEOUT_MS);

  test('--dry-run in the keyless mode, and the refusals: a bad rung, a docs/benchmarks check directory, an unknown flag', () => {
    const r = run(['--gbrain', sha, '--dry-run'], { ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('mode:       keyless (fake harness, one dev task per surface plus the gbrain-docs mount; no key read)');
    expect(r.stdout).toContain('harness-eval/fake:dev:');
    const rung = run(['--gbrain', sha, '--harness', 'openclaw,hermes', '--rungs', 'plugin', '--dry-run']);
    expect(rung.status).toBe(2);
    expect(rung.stderr).toContain('HE-RUN-002 --rungs names "plugin"');
    const docs = run(['--gbrain', sha, '--dry-run'], { GBRAIN_CHECK_DIR: 'docs/benchmarks/gbrain-check' });
    expect(docs.status).toBe(2);
    expect(docs.stderr).toMatch(/^HE-GBRAIN-010 .*docs\/benchmarks/);
    const flag = run(['--gbrain', sha, '--parallel', '3', '--dry-run']);
    expect(flag.status).toBe(2);
    expect(flag.stderr).toContain('HE-RUN-002 unknown argument --parallel');
  }, CLI_TIMEOUT_MS);
});
