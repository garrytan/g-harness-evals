import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asPublished, compareJson, compareText, describe as describeDiff, MISSING } from '../scripts/verify/compare.ts';
import { loadRecipes, publishedRuns, validateRecipe, type Recipe } from '../scripts/verify/recipes.ts';
import { checkReceiptsManifest, main, verifyRun } from '../scripts/verify/verify.ts';

const repo = join(import.meta.dir, '..');

// A tiny run: trials.jsonl is the receipt, summary.json and summary.md are what the run published, gen.ts rebuilds them.
const GEN = String.raw`import { readFileSync, writeFileSync } from 'node:fs';
const run = process.argv[2]!;
const rows = readFileSync(run + '/results/trials.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const passes = rows.filter((r) => r.passed).length;
writeFileSync(run + '/results/summary.json', JSON.stringify({ cells: [{ id: 'a', passes, scored: rows.length, pass_rate: passes / rows.length }], commit: 'c' + Date.now() }, null, 1) + '\n');
writeFileSync(run + '/results/summary.md', '| cell | passes |\n| a | ' + passes + ' / ' + rows.length + ' |\n');
if (process.argv.includes('--table')) console.log('| a | ' + passes + ' / ' + rows.length + ' |');
if (process.argv.includes('--scribble')) writeFileSync(run + '/results/trials.jsonl', '');
if (process.argv.includes('--scribble-trial')) writeFileSync(run + '/results/trials/t0/record.json', '{}');
if (process.argv.includes('--env')) console.log(Object.keys(process.env).sort().join(','));
if (process.argv.includes('--check')) process.exit(passes === Number(process.argv[3]) ? 0 : 1);
if (process.argv.includes('--fail')) { console.error('no trials.jsonl here'); process.exit(3); }
if (process.argv.includes('--hang')) { Bun.spawn(['sleep', '60'], { stdout: 'inherit', stderr: 'inherit' }); await Bun.sleep(60000); }
`;

const RUN = '2026-01-01-fixture';

function fixture(published: { passes: number; scored: number }, recipe: Partial<Recipe> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'verify-test-'));
  const run = join(root, 'docs/benchmarks', RUN);
  mkdirSync(join(run, 'results'), { recursive: true });
  mkdirSync(join(run, 'results/trials/t0'), { recursive: true });
  writeFileSync(join(run, 'results/trials/t0/record.json'), '{"passed":true}\n');
  writeFileSync(join(run, 'results/trials.jsonl'), [true, true, false, true].map((p, i) => JSON.stringify({ trial_id: 't' + i, passed: p })).join('\n') + '\n');
  writeFileSync(join(run, 'results/summary.json'), JSON.stringify({ cells: [{ id: 'a', passes: published.passes, scored: published.scored, pass_rate: published.passes / published.scored }], commit: 'c1' }, null, 1) + '\n');
  writeFileSync(join(run, 'results/summary.md'), '| cell | passes |\n| a | ' + published.passes + ' / ' + published.scored + ' |\n');
  writeFileSync(join(run, 'report.md'), '# Fixture\n\n| a | 3 / 4 |\n');
  writeFileSync(join(root, 'gen.ts'), GEN);
  writeFileSync(join(root, '.gitignore'), '.verify-scratch/\n');
  const full: Recipe = {
    run: RUN,
    steps: [{ cmd: ['bun', 'gen.ts', '{run}'], outputs: ['results/summary.json', 'results/summary.md'] }],
    volatile: [{ file: 'results/summary.json', path: 'commit', reason: 'the generator stamps a fresh id' }],
    ...recipe,
  };
  mkdirSync(join(root, 'scripts/verify/runs'), { recursive: true });
  writeFileSync(join(root, 'scripts/verify/runs', RUN + '.json'), JSON.stringify(full, null, 2));
  const git = (...a: string[]) => spawnSync('git', a, { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root, GIT_CONFIG_NOSYSTEM: '1' } });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'fixture');
  return { root, recipe: full, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function runMain(root: string, args: string[]) {
  const lines: string[] = [];
  const code = await main(args, root, (s) => lines.push(s));
  return { code, text: lines.join('\n') };
}

describe('compare', () => {
  test('JSON values compare by value, ignore key order and name the path of each difference', () => {
    const diffs = compareJson({ cells: [{ id: 'a', rate: 0.75 }], n: 4 }, { n: 4, cells: [{ rate: 0.5, id: 'a' }] });
    expect(diffs).toEqual([{ path: 'cells[0].rate', committed: 0.75, rebuilt: 0.5 }]);
    expect(describeDiff('results/summary.json', diffs[0]!)).toBe('results/summary.json: the number at cells[0].rate is published as 0.75, but rebuilding from the receipts gives 0.5.');
  });

  test('a missing or extra value is a difference, and odd keys are quoted in the path', () => {
    const diffs = compareJson({ 'a b': 1, list: [1, 2] }, { list: [1], extra: true });
    expect(diffs).toEqual([
      { path: '["a b"]', committed: 1, rebuilt: MISSING },
      { path: 'list[1]', committed: 2, rebuilt: MISSING },
      { path: 'extra', committed: MISSING, rebuilt: true },
    ]);
  });

  test('0.235865 and 0.236 differ: a published number must match as written', () => {
    expect(compareJson({ x: 0.235865 }, { x: 0.236 })).toHaveLength(1);
  });

  test('the labels the public copy rewrites compare equal, and nothing else does', () => {
    expect(compareJson({ scope: 'install ladder (internal-task)', vm: '<vm name>' }, { scope: 'install ladder (internal-task)', vm: '<vm name>' })).toEqual([]);
    expect(compareJson({ model: 'GPT-5' }, { model: 'GPT-6' })).toHaveLength(1);
    expect(compareJson({ n: 'internal-task passed 12' }, { n: 'internal-task passed 13' })).toHaveLength(1);
    expect(asPublished('UTF-8, Opus 5.5')).toBe('UTF-8, Opus 5.5');
  });

  test('text compares line by line, lining up inserted lines', () => {
    expect(compareText('a\nb\nc\n', 'a\nB\nc\n')).toEqual({ differences: [{ line: 2, committed: 'b', rebuilt: 'B' }], added: [] });
    expect(compareText('a\nb\nc\n', 'a\nnew row\nb\nc\n')).toEqual({ differences: [], added: [{ before: 2, lines: ['new row'] }] });
    expect(compareText('a\nb\nc\n', 'a\nc\n')).toEqual({ differences: [{ line: 2, committed: 'b', rebuilt: null }], added: [] });
    expect(compareText('a\n', 'a\nb\nc\n')).toEqual({ differences: [], added: [{ before: 2, lines: ['b', 'c'] }] });
    expect(compareText('a\nb\nc\n', 'a\nB\nnew\nc\n')).toEqual({ differences: [{ line: 2, committed: 'b', rebuilt: 'B' }], added: [{ before: 3, lines: ['new'] }] });
  });
});

describe('verify on a fixture run', () => {
  test('a run whose receipts give the published numbers matches', async () => {
    const f = fixture({ passes: 3, scored: 4 });
    try {
      const r = await verifyRun(f.root, f.recipe);
      expect(r.failures).toEqual([]);
      expect(r.status).toBe('match');
      expect(r.files).toBe(2);
    } finally { f.cleanup(); }
  });

  test('a published number that the receipts do not give fails, and says which number, which file and what it should be', async () => {
    const f = fixture({ passes: 4, scored: 4 });
    try {
      const { code, text } = await runMain(f.root, ['--run', RUN]);
      expect(code).toBe(1);
      expect(text).toContain('DIFFERS ' + RUN);
      expect(text).toContain('results/summary.json: the number at cells[0].passes is published as 4, but rebuilding from the receipts gives 3.');
      expect(text).toContain('results/summary.md: line 2 is published as "| a | 4 / 4 |", but rebuilding from the receipts gives "| a | 3 / 4 |".');
      expect(text).toContain('verify: FAILED');
    } finally { f.cleanup(); }
  });

  test('a known difference is printed and passes; once it stops happening the stale entry fails', async () => {
    const known = { known: [{ file: 'results/summary.json', path: 'cells[0].passes', committed: 4, rebuilt: 3, reason: 'a fixture' }, { file: 'results/summary.json', path: 'cells[0].pass_rate', committed: 1, rebuilt: 0.75, reason: 'a fixture' }, { file: 'results/summary.md', line: 2, committed: '| a | 4 / 4 |', rebuilt: '| a | 3 / 4 |', reason: 'a fixture' }] };
    const f = fixture({ passes: 4, scored: 4 }, known);
    try {
      const r = await verifyRun(f.root, f.recipe);
      expect(r.failures).toEqual([]);
      expect(r.status).toBe('known');
      expect(r.known[0]).toContain('results/summary.json cells[0].passes: published 4, rebuilds to 3. a fixture');
    } finally { f.cleanup(); }
    const g = fixture({ passes: 3, scored: 4 }, known);
    try {
      const r = await verifyRun(g.root, g.recipe);
      expect(r.status).toBe('differs');
      expect(r.failures.join('\n')).toContain('listed as a known difference, but the rebuild no longer shows it');
    } finally { g.cleanup(); }
  });

  test('a volatile text pattern skips a commit id, but may not hide a number', async () => {
    const steps = [{ cmd: ['bun', 'gen.ts', '{run}'], outputs: ['results/summary.md'] }];
    const ok = fixture({ passes: 3, scored: 4 }, { steps, volatile: [{ file: 'results/summary.md', pattern: 'cell', reason: 'a word that changes' }] });
    try { expect((await verifyRun(ok.root, ok.recipe)).failures).toEqual([]); } finally { ok.cleanup(); }
    const bad = fixture({ passes: 3, scored: 4 }, { steps, volatile: [{ file: 'results/summary.md', pattern: '\\d+ / \\d+', reason: 'trying to hide numbers' }] });
    try { expect((await verifyRun(bad.root, bad.recipe)).failures.join('\n')).toContain('looks like a number'); } finally { bad.cleanup(); }
  });

  test('a volatile value may not hide a number', async () => {
    const f = fixture({ passes: 3, scored: 4 }, { volatile: [{ file: 'results/summary.json', path: 'cells', reason: 'trying to hide numbers' }] });
    try {
      const r = await verifyRun(f.root, f.recipe);
      expect(r.status).toBe('differs');
      expect(r.failures.join('\n')).toContain('is marked volatile, but it holds a number');
    } finally { f.cleanup(); }
  });

  test('printed tables can be checked against the report they were pasted into', async () => {
    const steps = [{ cmd: ['bun', 'gen.ts', '{run}', '--table'], outputs: ['results/summary.json'], stdout: { contained_in: 'report.md' } }];
    const f = fixture({ passes: 3, scored: 4 }, { steps });
    try {
      expect((await verifyRun(f.root, f.recipe)).status).toBe('match');
      writeFileSync(join(f.root, 'docs/benchmarks', RUN, 'report.md'), '# Fixture\n\n| a | 4 / 4 |\n');
      const r = await verifyRun(f.root, f.recipe);
      expect(r.failures).toEqual(['report.md: the line "| a | 3 / 4 |", printed by step 1 from the receipts, is not in the published file.']);
    } finally { f.cleanup(); }
  });

  test('a step that prints nothing fails the report check instead of passing it', async () => {
    const steps = [{ cmd: ['bun', 'gen.ts', '{run}'], outputs: ['results/summary.json'], stdout: { contained_in: 'report.md' } }];
    const f = fixture({ passes: 3, scored: 4 }, { steps });
    try {
      const r = await verifyRun(f.root, f.recipe);
      expect(r.status).toBe('differs');
      expect(r.failures).toEqual(['report.md: step 1 printed nothing, so there is nothing to find in the published file.']);
    } finally { f.cleanup(); }
  });

  test('a self-check step passes on exit 0 and reports a mismatch on exit 1', async () => {
    const ok = fixture({ passes: 3, scored: 4 }, { steps: [{ cmd: ['bun', 'gen.ts', '{src}', '3', '--check'], self_check: true }] });
    try { expect((await verifyRun(ok.root, ok.recipe)).status).toBe('match'); } finally { ok.cleanup(); }
    const bad = fixture({ passes: 3, scored: 4 }, { steps: [{ cmd: ['bun', 'gen.ts', '{src}', '4', '--check'], self_check: true }] });
    try { expect((await verifyRun(bad.root, bad.recipe)).failures[0]).toContain('says its published output no longer matches'); } finally { bad.cleanup(); }
  });

  test('a step that fails is reported with its exit code and error text', async () => {
    const f = fixture({ passes: 3, scored: 4 }, { steps: [{ cmd: ['bun', 'gen.ts', '{run}', '--fail'], outputs: ['results/summary.json'] }] });
    try {
      const r = await verifyRun(f.root, f.recipe);
      expect(r.failures[0]).toContain('stopped with exit code 3');
      expect(r.failures[0]).toContain('no trials.jsonl here');
    } finally { f.cleanup(); }
  });

  test('steps run with no keys in their environment', async () => {
    const f = fixture({ passes: 3, scored: 4 }, { steps: [{ cmd: ['bun', 'gen.ts', '{run}', '--env'], outputs: ['results/summary.json'], stdout: { file: 'results/summary.md' } }] });
    try {
      process.env.VERIFY_TEST_FAKE_KEY = 'not-a-real-key';
      writeFileSync(join(f.root, 'docs/benchmarks', RUN, 'results/summary.md'), 'HOME,LANG,NO_COLOR,PATH,TMPDIR,TZ\n');
      const r = await verifyRun(f.root, f.recipe);
      expect(r.failures).toEqual([]);
    } finally { delete process.env.VERIFY_TEST_FAKE_KEY; f.cleanup(); }
  });

  test('a step that writes a file its recipe does not list, or rewrites a trial file, only changes the scratch copy', async () => {
    const f = fixture({ passes: 3, scored: 4 });
    try {
      expect((await runMain(f.root, ['--run', RUN])).code).toBe(0);
      expect(readFileSync(join(f.root, 'docs/benchmarks', RUN, 'results/summary.json'), 'utf8')).toContain('"commit": "c1"');
      const small = fixture({ passes: 3, scored: 4 }, { steps: [{ cmd: ['bun', 'gen.ts', '{run}', '--scribble'], outputs: ['results/summary.json'] }] });
      try {
        expect((await runMain(small.root, ['--run', RUN])).code).toBe(0);
        expect(readFileSync(join(small.root, 'docs/benchmarks', RUN, 'results/trials.jsonl'), 'utf8')).toContain('"t0"');
      } finally { small.cleanup(); }
      const trial = fixture({ passes: 3, scored: 4 }, { steps: [{ cmd: ['bun', 'gen.ts', '{run}', '--scribble-trial'], outputs: ['results/summary.json'] }] });
      try {
        expect((await runMain(trial.root, ['--run', RUN])).code).toBe(0);
        expect(readFileSync(join(trial.root, 'docs/benchmarks', RUN, 'results/trials/t0/record.json'), 'utf8')).toBe('{"passed":true}\n');
      } finally { trial.cleanup(); }
    } finally { f.cleanup(); }
  });

  test('a rebuilt file the public copy leaves out is named, not compared, and only when its committed copy is missing', async () => {
    const f = fixture({ passes: 3, scored: 4 }, { public_copy_omits: [{ file: 'results/summary.md', reason: 'it carries a cost total' }] });
    try {
      expect((await verifyRun(f.root, f.recipe)).files).toBe(2);
      rmSync(join(f.root, 'docs/benchmarks', RUN, 'results/summary.md'));
      const r = await verifyRun(f.root, f.recipe);
      expect(r.status).toBe('match');
      expect(r.files).toBe(1);
      expect(r.gaps.join('\n')).toContain('results/summary.md: this copy of the repository leaves it out (it carries a cost total)');
      expect(validateRecipe(f.root, { ...f.recipe, public_copy_omits: [{ file: 'results/other.json', reason: 'x' }] }).join('\n')).toContain('public_copy_omits');
    } finally { f.cleanup(); }
  });

  test('in the full repository a file listed under public_copy_omits must still be published', async () => {
    const f = fixture({ passes: 3, scored: 4 }, { public_copy_omits: [{ file: 'results/summary.md', reason: 'it carries a cost total' }] });
    try {
      mkdirSync(join(f.root, 'publication'), { recursive: true });
      writeFileSync(join(f.root, 'publication/manifest.json'), '{}\n');
      rmSync(join(f.root, 'docs/benchmarks', RUN, 'results/summary.md'));
      const r = await verifyRun(f.root, f.recipe);
      expect(r.status).toBe('differs');
      expect(r.failures.join('\n')).toContain('results/summary.md: the published file is missing. It is listed under public_copy_omits, but only the public copy may leave it out');
    } finally { f.cleanup(); }
  });

  test('a published file that lost values or lines fails: emptied JSON, cut-off rows', async () => {
    const f = fixture({ passes: 3, scored: 4 });
    try {
      const results = join(f.root, 'docs/benchmarks', RUN, 'results');
      writeFileSync(join(results, 'summary.json'), JSON.stringify({ commit: 'c1' }) + '\n');
      writeFileSync(join(results, 'summary.md'), '| cell | passes |\n');
      const { code, text } = await runMain(f.root, ['--run', RUN]);
      expect(code).toBe(1);
      expect(text).toContain('results/summary.json: cells is not in the published file, but rebuilding from the receipts gives');
      expect(text).toContain('otherwise the published file has lost it.');
      expect(text).toContain('results/summary.md: rebuilding from the receipts adds 1 line before published line 2 that the published file does not have, starting "| a | 3 / 4 |".');
      writeFileSync(join(results, 'summary.json'), JSON.stringify({ cells: [], commit: 'c1' }) + '\n');
      expect((await verifyRun(f.root, f.recipe)).failures.join('\n')).toContain('cells[0] is not in the published file');
    } finally { f.cleanup(); }
  });

  test('values and lines a script gained later pass when listed under rebuild_only; a stale entry fails', async () => {
    const rebuildOnly = { rebuild_only: [{ file: 'results/summary.json', paths: ['cells'], reason: 'a fixture' }, { file: 'results/summary.md', starts: '| a | 3 / 4 |', lines: 1, reason: 'a fixture' }] };
    const f = fixture({ passes: 3, scored: 4 }, rebuildOnly);
    try {
      const results = join(f.root, 'docs/benchmarks', RUN, 'results');
      const r0 = await verifyRun(f.root, f.recipe);
      expect(r0.status).toBe('differs');
      expect(r0.failures.join('\n')).toContain('results/summary.json cells: listed under rebuild_only, but the rebuild no longer adds it');
      expect(r0.failures.join('\n')).toContain('results/summary.md: the 1 lines starting "| a | 3 / 4 |" are listed under rebuild_only, but the rebuild no longer adds them');
      writeFileSync(join(results, 'summary.json'), JSON.stringify({ commit: 'c1' }) + '\n');
      writeFileSync(join(results, 'summary.md'), '| cell | passes |\n');
      const r = await verifyRun(f.root, f.recipe);
      expect(r.failures).toEqual([]);
      expect(r.status).toBe('match');
      expect(r.added).toBe(2);
      writeFileSync(join(results, 'summary.md'), '');
      expect((await verifyRun(f.root, f.recipe)).failures.join('\n')).toContain('adds 2 lines before published line 1');
      expect(validateRecipe(f.root, { ...f.recipe, rebuild_only: [{ file: 'results/summary.json', starts: 'x', lines: 1, reason: 'x' }] }).join('\n')).toContain('a rebuild_only entry for a JSON file needs "paths"');
      expect(validateRecipe(f.root, { ...f.recipe, rebuild_only: [{ file: 'results/other.md', starts: 'x', lines: 1, reason: 'x' }] }).join('\n')).toContain('which no step rebuilds');
    } finally { f.cleanup(); }
  });

  test('a run whose scripts are missing from this copy of the repository is reported unavailable, not passed', async () => {
    const f = fixture({ passes: 4, scored: 4 }, { requires: ['scripts/private-only'] });
    try {
      const { code, text } = await runMain(f.root, ['--run', RUN]);
      expect(code).toBe(0);
      expect(text).toContain('UNAVAILABLE ' + RUN);
      expect(text).toContain('this copy of the repository does not have scripts/private-only');
      expect(text).not.toContain('MATCH');
      mkdirSync(join(f.root, 'publication'), { recursive: true });
      writeFileSync(join(f.root, 'publication/manifest.json'), '{}\n');
      const full = await runMain(f.root, ['--run', RUN]);
      expect(full.code).toBe(1);
      expect(full.text).toContain('UNAVAILABLE in the full repository: ' + RUN + ' needs files that are missing here');
    } finally { f.cleanup(); }
  });

  test('a step past its time limit is stopped with everything it started', async () => {
    const f = fixture({ passes: 3, scored: 4 }, { steps: [{ cmd: ['bun', 'gen.ts', '{run}', '--hang'], outputs: ['results/summary.json'], timeout_s: 1 }] });
    try {
      const r = await verifyRun(f.root, f.recipe);
      expect(r.status).toBe('differs');
      expect(r.failures.join('\n')).toContain('ran past its 1 s limit');
    } finally { f.cleanup(); }
  }, 20000);

  test('a recipe that runs anything but bun or python3 is refused', async () => {
    const f = fixture({ passes: 3, scored: 4 }, { steps: [{ cmd: ['curl', 'https://example.com'], outputs: ['results/summary.json'] }] });
    try {
      const { code, text } = await runMain(f.root, ['--run', RUN]);
      expect(code).toBe(2);
      expect(text).toContain('a rebuild may only run bun or python3, not curl');
    } finally { f.cleanup(); }
  });
});

describe('receipts manifest and required runs on a fixture', () => {
  // receipts-manifest.ts stands in as a copy of the committed manifest, so only the commit-id handling differs.
  function manifestFixture(firstCommit: (head: string) => string, full: boolean) {
    const f = fixture({ passes: 3, scored: 4 });
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: f.root, encoding: 'utf8' }).stdout.trim();
    const manifest = { generated_at: 'x', runs: [{ directory: 'docs/benchmarks/' + RUN, preregistration: { path: 'docs/benchmarks/' + RUN + '/preregistration.md', first_commit: firstCommit(head), amendments: [] } }] };
    mkdirSync(join(f.root, 'scripts'), { recursive: true });
    writeFileSync(join(f.root, 'docs/receipts-manifest.json'), JSON.stringify(manifest, null, 1));
    writeFileSync(join(f.root, 'scripts/receipts-manifest.ts'), "import { copyFileSync } from 'node:fs';\ncopyFileSync('docs/receipts-manifest.json', process.argv[process.argv.indexOf('--out') + 1]);\n");
    if (full) { mkdirSync(join(f.root, 'publication'), { recursive: true }); writeFileSync(join(f.root, 'publication/manifest.json'), '{}'); }
    return f;
  }

  test('in the full repository a preregistration commit that is not in history is a mismatch', () => {
    const f = manifestFixture(() => 'deadbeef'.repeat(5), true);
    try {
      const { failures } = checkReceiptsManifest(f.root);
      expect(failures[0]).toContain('records preregistration commit ' + 'deadbeef'.repeat(5) + ", which is not in this clone's history");
    } finally { f.cleanup(); }
  });

  test('in the full repository a preregistration commit that is in history matches', () => {
    const f = manifestFixture((head) => head, true);
    try {
      expect(checkReceiptsManifest(f.root)).toEqual({ failures: [], note: '' });
    } finally { f.cleanup(); }
  });

  test('in the public copy an unknown preregistration commit is skipped and counted', () => {
    const f = manifestFixture(() => 'deadbeef'.repeat(5), false);
    try {
      const { failures, note } = checkReceiptsManifest(f.root);
      expect(failures).toEqual([]);
      expect(note).toContain('for 1 runs the commit that added the preregistration is not in this clone');
    } finally { f.cleanup(); }
  });

  test('a run folder with a report.md needs a recipe even when no index lists it', async () => {
    const f = fixture({ passes: 3, scored: 4 });
    try {
      mkdirSync(join(f.root, 'docs/scoreboard/entries'), { recursive: true });
      writeFileSync(join(f.root, 'docs/scoreboard/reports.json'), JSON.stringify({ reports: [] }));
      mkdirSync(join(f.root, 'docs/benchmarks/2026-01-02-unindexed'), { recursive: true });
      writeFileSync(join(f.root, 'docs/benchmarks/2026-01-02-unindexed/report.md'), '# Unindexed\n');
      expect(publishedRuns(f.root)).toEqual([RUN, '2026-01-02-unindexed']);
      const { code, text } = await runMain(f.root, []);
      expect(code).toBe(2);
      expect(text).toContain('docs/benchmarks/2026-01-02-unindexed has a published report or scoreboard row but no rebuild recipe');
    } finally { f.cleanup(); }
  });
});

describe('verify on this repository', () => {
  const recipes = loadRecipes(repo);

  test('every run with a published report or scoreboard row has a rebuild recipe', () => {
    const have = new Set(recipes.map((r) => r.run));
    expect(publishedRuns(repo).filter((run) => !have.has(run))).toEqual([]);
  });

  test('every recipe is well formed', () => {
    expect(recipes.flatMap((r) => validateRecipe(repo, r))).toEqual([]);
  });

  test('every run behind a README row is rebuilt, not only listed as a gap', () => {
    const byRun = new Map(recipes.map((r) => [r.run, r]));
    const dir = join(repo, 'docs/scoreboard/entries');
    const runs = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).report.split('/')[2]);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.filter((run) => !(byRun.get(run)?.steps.length))).toEqual([]);
  });
});
