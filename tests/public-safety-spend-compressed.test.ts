// Every spend rule also refuses compressed copies: the range check's PS-SPEND-PATH (scripts/public-safety/rules.json
// spend_paths), the public export's spend exclude rule (publication/manifest.json) and the adapter trial bundles' spend
// list (scripts/bundle-adapters.ts SPEND_GLOBS).
//
// Value: protects=a spend file (lease ledger, proxy usage log, spend reconciliation, lease log, VM record, fan-out
// manifest or spend tally), plain or compressed as .gz, .zst, .xz or .bz2, never reaches the public copy or a trial
// bundle; fails_when=any glob in the three lists stops matching one compressed suffix, the range check stops refusing a
// seeded file, the range check stops covering a name the export's spend rule leaves out, or a release log or fixture outside
// docs/benchmarks/ is refused;
// why_new=push 8 of the public export nearly published 52 gzipped ledgers and proxy usage logs (#628), and the range
// check covered only uncompressed ledgers, proxy usage logs and reconciliations; seam=bun check.ts on a synthetic
// repository seeded with one file per glob and suffix, plus Bun.Glob on the manifest's exclude rules (with their except
// lists, as the export's classifier reads them) and on SPEND_GLOBS;
// no_claim=spend files the public copy already holds (only new objects count).
import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, GATE, gitleaksReady, repo, ROOT } from './public-safety-fixture.ts';
import { SPEND_GLOBS } from '../scripts/bundle-adapters.ts';

const tmp = mkdtempSync(join(tmpdir(), 'he-public-safety-spend-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const READY = gitleaksReady();
const SUFFIXES = ['.gz', '.zst', '.xz', '.bz2'];
const RULES = (await Bun.file(join(GATE, 'rules.json')).json()) as { spend_paths: string[] };
const MANIFEST_FILE = join(ROOT, 'publication', 'manifest.json');
const HAS_MANIFEST = existsSync(MANIFEST_FILE);
type Exclude = { globs: string[]; except?: string[] };
const EXCLUDES: Exclude[] = HAS_MANIFEST ? (JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) as { exclude: Exclude[] }).exclude : [];
const SPEND_RULE: Exclude = EXCLUDES.find((e) => e.globs.some((g) => g.startsWith('docs/benchmarks/**/*ledger*.sqlite'))) ?? { globs: [] };
const excludedBy = (path: string) => EXCLUDES.find((e) => e.globs.some((g) => new Bun.Glob(g).match(path)) && !(e.except ?? []).some((g) => new Bun.Glob(g).match(path)));
const sample = (glob: string, dir: string, suffix: string) =>
  glob.replace(/^\*\*\//, dir + '/').replace(/^docs\/benchmarks\/\*\*\//, dir + '/').replace(/\{,[^}]*\}$/, '').replace(/\*/g, 'seed') + suffix;

test('the range check covers lease logs, VM records, fan-out manifests and spend tallies, and every spend glob in the three lists has a compressed form', () => {
  for (const name of ['r1.smoke-lease.log', 'leases.jsonl', 's1.shard-vm.json', 'fanout.json', 'spend.json', 'ledger.sqlite', 'oc.ledger.sqlite', 'proxy-usage.ndjson', 'spend-reconciliation.json']) {
    expect(RULES.spend_paths.some((g) => new Bun.Glob(g).match('docs/benchmarks/r1/results/' + name)), name).toBe(true);
  }
  for (const p of ['docs/release.log', 'release-notes.log', 'tests/fixtures/ubicloud/fanout.json']) expect(RULES.spend_paths.some((g) => new Bun.Glob(g).match(p)), p).toBe(false);
  for (const [list, globs, dir] of [['rules.json', RULES.spend_paths, 'docs/benchmarks/r1/results'], ['SPEND_GLOBS', SPEND_GLOBS, 'docs/benchmarks/zz-seed/results']] as const) {
    for (const g of globs) for (const s of SUFFIXES) {
      const p = sample(g, dir, s);
      expect(new Bun.Glob(g).match(p), list + ' ' + g + ' ' + p).toBe(true);
    }
  }
});

test.skipIf(!HAS_MANIFEST)('the public export leaves out one seeded compressed file per spend glob, and adapter bundles leave out the same', () => {
  const spend = SPEND_GLOBS.map((g) => new Bun.Glob(g));
  expect(SPEND_RULE.globs.length).toBeGreaterThan(0);
  for (const g of SPEND_RULE.globs) for (const s of SUFFIXES) {
    const p = sample(g, 'docs/benchmarks/zz-seed/results', s);
    expect(new Bun.Glob(g).match(p), 'manifest ' + g + ' ' + p).toBe(true);
    expect(excludedBy(p), p).toBe(SPEND_RULE);
    expect(spend.some((x) => x.match(p.replace(/^docs\/benchmarks\//, ''))), p).toBe(true);
    for (const q of [p, p.slice(0, -s.length)]) expect(RULES.spend_paths.some((x) => new Bun.Glob(x).match(q)), 'range check ' + q).toBe(true);
  }
  for (const s of ['', ...SUFFIXES]) {
    const note = 'docs/benchmarks/zz-seed/spend-internal.md' + s;
    expect(excludedBy(note)?.globs.some((g) => g.startsWith('docs/benchmarks/**/spend-internal.md')), note).toBe(true);
    expect(RULES.spend_paths.some((x) => new Bun.Glob(x).match(note)), 'range check ' + note).toBe(true);
  }
});

test.skipIf(!READY)('the range check refuses one seeded compressed file per spend glob with PS-SPEND-PATH', () => {
  const r = repo(join(tmp, 'r1'));
  r.commit({ 'docs/methods.md': '# Methods\n' }, 'base');
  r.g('checkout', '-q', '-b', 'feature');
  const seeded = [...new Set(RULES.spend_paths.flatMap((g) => SUFFIXES.map((s) => sample(g, 'docs/benchmarks/r1/results', s))))];
  r.commit(Object.fromEntries(seeded.map((p) => [p, Buffer.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0])])), 'seed compressed spend files');
  const out = check(['--base', 'main', '--head', 'feature', '--no-cache'], { cwd: r.dir });
  expect(out.status).toBe(1);
  for (const p of seeded) expect(out.stdout).toContain('PS-SPEND-PATH ' + p + ':0');
}, 300_000);

