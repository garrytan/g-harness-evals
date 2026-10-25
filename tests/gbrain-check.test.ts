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
  DEFAULT_BASELINE, KNOWN_PAGE, RUNGS, TOLD_PREAMBLE, checkDir, fingerprintOf, fingerprintSha, gitExpandSha, keylessAssertions, modelLabel, paidCells, parseArgs,
  readBaseline, renderSummary, resolveFromRefs, resolveGbrainRef, scratchPrereg, validateBaseline, viewDigestFromBundle, writeBaseline, writeKeylessTasks,
  type Baseline, type KeylessEvidence, type PinSurfaces, type SummaryJson, type ViewEvidence,
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
    expect(() => paidCells(['openclaw'], ['plugin'])).toThrow(/HE-RUN-002 --rungs names "plugin"; the rungs are mcp, told, docs, verbs-told, semantic-told, docs-semantic/);
    expect(Object.keys(RUNGS)).toEqual(['mcp', 'told', 'docs', 'verbs-told', 'semantic-told', 'docs-semantic']);
    expect(RUNGS['semantic-told']!.gbrain).toEqual({ surface: 'starter', embeddings: 'openai:text-embedding-3-small' });
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
    expect(verbs).toContain(`[fake:gbrain recall {"query":"${KNOWN_PAGE.query}","limit":3}]`);
    expect(KNOWN_PAGE.slug.startsWith('dev/')).toBe(true);
    // The known page is a dev channel's source page in the world data, so the bot-visible brain holds it.
    const world = JSON.parse(readFileSync(join(ROOT, 'world', 'seed', 'world.json'), 'utf8')) as { channels: Array<{ split: string; kind: string; source_slugs: string[] }> };
    expect(world.channels.some((c) => c.split === 'dev' && c.kind !== 'dm' && c.source_slugs.includes(KNOWN_PAGE.slug.slice(4)))).toBe(true);
  });

  test('parseArgs: defaults, the paid mode, and refusals', () => {
    expect(parseArgs(['--gbrain', 'master'])).toMatchObject({ gbrain: 'master', harnesses: ['fake'], rungs: ['told'], reps: 2, model: 'anthropic:claude-haiku-5-5', spendCap: 2, baseline: DEFAULT_BASELINE, dryRun: false, strictPins: false });
    expect(parseArgs(['--gbrain', 'x', '--harness', 'openclaw,hermes', '--rungs', 'told,docs', '--reps', '1', '--spend-cap', '0.5', '--write-baseline', '--force', '--dry-run'])).toMatchObject({ harnesses: ['openclaw', 'hermes'], rungs: ['told', 'docs'], reps: 1, spendCap: 0.5, writeBaseline: true, force: true, dryRun: true });
    expect(() => parseArgs([])).toThrow(/HE-GBRAIN-009 missing --gbrain/);
    expect(() => parseArgs(['--gbrain', 'x', '--harness', 'qm'])).toThrow(/HE-RUN-002 --harness names "qm"/);
    expect(() => parseArgs(['--gbrain', 'x', '--parallel', '3'])).toThrow(/HE-RUN-002 unknown argument --parallel/);
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
