// The eval-loop practices check (runner/prereg/practices.ts): a new preregistration states the decision (R97), a pilot
// per arm (R111), the judge check per arm (R78) and the half-way look above $500 paid (R113); a declared quick look
// (R112) is exempt; a new run's report names the call it settled and its spend-internal.md the paid and meter spend.
//
// Value: protects=a new plan that skips one of the four practices, or a new results page without its Settled or spend
// lines, fails CI; fails_when=the check passes a plan missing a section, flags a quick look or a grandfathered run, or
// accepts an edited grandfather list; why_new=the org's eval-loop audit (2026-11-19) found nearly a quarter of eval spend
// settled nothing, the largest loss a judge that failed its check after the whole grid ran; seam=fixture preregistrations
// under tests/fixtures/prereg-practices/ read as text; no_claim=that a plan's pilot or judge check was actually run.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ATTESTATION_MAP_PATH, ATTESTED, LEDGER_PATH, MAPPED, type ManifestEntry } from '../runner/prereg/prereg.ts';
import { checkPractices, GRANDFATHERED_PATH, planProblems, readGrandfathered } from '../runner/prereg/practices.ts';

const ROOT = join(import.meta.dir, 'fixtures/prereg-practices');
const plan = (name: string) => readFileSync(join(ROOT, name, 'PREREGISTRATION.md'), 'utf8');
const entry = (folder: string, file = 'PREREGISTRATION.md', id = folder): ManifestEntry => ({ id, preregistration: `${folder}/${file}`, results: [`${folder}/results/**`] });
const check = (entries: ManifestEntry[], opts: { spend?: boolean; old?: string[] } = {}) =>
  checkPractices(entries, ROOT, { spend: opts.spend ?? true, grandfathered: new Set(opts.old ?? []) });

describe('a new preregistration states the eval-loop practices', () => {
  test('the passing fixture states all four, and its report and spend lines pass', () => {
    expect(planProblems(plan('pass'))).toEqual([]);
    expect(check([entry('pass')])).toEqual({ grandfathered: 0, checked: 1, problems: [] });
  });

  test('a declared quick look needs only its three-line plan, within $100', () => {
    expect(planProblems(plan('quick-look'))).toEqual([]);
    expect(planProblems(plan('quick-look').replace('$60\n', '$150\n'))).toEqual(['a quick look is at most $100 paid (R112); this one plans $150, so it is a counted run']);
    expect(planProblems(plan('quick-look').replace(/- Stop rule:.*\n/, ''))).toEqual(['a quick look\'s three-line plan has no "Stop rule:" field in "## Eval loop" (R112)']);
  });

  test('missing the decision fails (R97)', () => {
    expect(planProblems(plan('missing-decision'))).toEqual(['no "## What the result changes" section with a bullet for each way the result could come out, at least two (R97)']);
    expect(planProblems(plan('pass').replace(/- \*\*Can't tell[\s\S]*?(?=## Pilot)/, '\n'))).toEqual(['no "## What the result changes" section with a bullet for each way the result could come out, at least two (R97)']);
  });

  test('missing the per-arm pilot fails (R111)', () => {
    expect(planProblems(plan('missing-pilot'))).toEqual(['no "## Pilot" section: a pilot per arm, capped at a tenth of that arm\'s budget (R111)']);
    expect(planProblems(plan('pass').replace('| card | $600 | $60 |', '| card | $600 | $61 |'))).toEqual(['"## Pilot" arm "card": the pilot cap $61 must be above $0 and at most a tenth of the arm\'s $600 budget (R111)']);
    expect(planProblems(plan('pass').replace(/- \*\*Tasks can be supplied:\*\*.*\n/, ''))).toEqual(['"## Pilot" does not say how the pilot shows "tasks can be supplied" (a "Tasks can be supplied:" field) (R111)']);
    expect(planProblems(plan('pass').replace('| card | $600 |', '| card | $700 |'))).toContain('"## Pilot" arm budgets add up to $1300, more than the $1200 paid budget');
  });

  test('missing the judge check fails when a model judge is used, and is not needed without one (R78)', () => {
    expect(planProblems(plan('missing-judge-check'))).toEqual(['a model judge is used but there is no "## Judge check" section, read per arm (R78)']);
    expect(planProblems(plan('pass').replace('| card | 20 | 0.6 |\n', ''))).toEqual(['"## Judge check" has no row for arm "card": the judge is read per arm, not pooled (R78)', '"## Judge check" plans 20 labelled outputs; R78 needs at least 40']);
    const noJudge = plan('missing-judge-check').replace(/- Model judge:.*\n/, '- Model judge: none\n').replace(/- \*\*Judge passes R78:\*\*.*\n/, '');
    expect(planProblems(noJudge)).toEqual([]);
    expect(planProblems(plan('pass').replace(/- \*\*Judge passes R78:\*\*.*\n/, ''))).toEqual(['"## Pilot" does not say how the pilot shows "judge passes R78" (a "Judge passes R78:" field) (R111)']);
  });

  test('a kappa bar is read as the whole signed number, and every arm needs labelled outputs of its own (R78)', () => {
    for (const bar of ['.1', '-0.6', '0.59']) {
      expect(planProblems(plan('pass').replace('| card | 20 | 0.6 |', `| card | 20 | ${bar} |`))).toEqual(['"## Judge check" arm "card": the kappa bar must be at least 0.6 (R78)']);
    }
    expect(planProblems(plan('pass').replace('| plain | 20 | 0.6 |', '| plain | 40 | 0.6 |').replace('| card | 20 | 0.6 |', '| card | 0 | 0.6 |'))).toEqual(['"## Judge check" arm "card" plans no labelled outputs of its own: the judge is read per arm, not pooled (R78)']);
  });

  test('missing the interim look fails above $500 paid, and is not needed at $500 (R113)', () => {
    expect(planProblems(plan('missing-interim-look'))).toEqual(['the plan is above $500 paid but has no "## Interim look" section: one look at half the units, with stop bounds (R113)']);
    expect(planProblems(plan('missing-interim-look').replace('$1,200', '$500').replaceAll('$600 | $60', '$250 | $25'))).toEqual([]);
    expect(planProblems(plan('pass').replace('32 of 64', '20 of 64'))).toEqual(['"## Interim look" needs "Look at: <n> of <N> units" with n half of N (R113)']);
    expect(planProblems(plan('pass').replace('32 of 64', '500 of 1,000'))).toEqual([]);
    for (const look of ['-32 of 64', '0 of 0', '32 of 64,5']) expect(planProblems(plan('pass').replace('32 of 64', look))).toEqual(['"## Interim look" needs "Look at: <n> of <N> units" with n half of N (R113)']);
  });

  test('a plan inside a fenced example block, backtick or tilde, is not read', () => {
    for (const fence of ['```', '~~~']) {
      expect(planProblems(`# Run\n\n${fence}markdown\n${plan('pass')}${fence}\n`)).toEqual(['no "## Eval loop" section declaring Size (counted run or quick look), Paid budget and Model judge']);
    }
  });

  test('a plan with no Eval loop section, or a template placeholder left in, fails', () => {
    expect(planProblems('# Run\n\n## What the result changes\n')).toEqual(['no "## Eval loop" section declaring Size (counted run or quick look), Paid budget and Model judge']);
    expect(planProblems(plan('pass').replace('- Paid budget: $1,200', '- Paid budget: $<n>'))).toContain('"## Eval loop" has no "Paid budget: $<n>" field');
    expect(planProblems(plan('pass').replace('- Size: counted run', '<!-- - Size: counted run -->'))).toContain('"## Eval loop" Size must be "counted run" or "quick look"');
    expect(planProblems(plan('quick-look').replace('$60\n', '$2k\n'))).toEqual(['"## Eval loop" has no "Paid budget: $<n>" field']);
  });
});

describe('which experiments the check reads', () => {
  test('a grandfathered experiment is not read, and neither is its run folder\'s report', () => {
    expect(check([entry('missing-decision')], { old: ['missing-decision'] })).toEqual({ grandfathered: 1, checked: 0, problems: [] });
    const extension = check([entry('missing-settled'), entry('missing-settled', 'prereg-harbor-s01.json', 'old-shard')], { old: ['old-shard'] });
    expect(extension.problems).toEqual([]);
  });

  test('a new shard JSON is covered by its folder\'s Markdown plan, and fails with none', () => {
    expect(check([entry('pass'), entry('pass', 'prereg-harbor-s01.json', 'pass-s01')]).problems).toEqual([]);
    expect(check([entry('pass', 'prereg-harbor-s01.json', 'pass-s01')]).problems).toEqual([{ id: 'pass-s01', file: 'pass/prereg-harbor-s01.json', problem: 'no Markdown preregistration is registered from pass, so nothing states this experiment\'s eval-loop practices' }]);
    expect(check([entry('missing-decision'), entry('missing-decision', 'prereg-harbor-s01.json', 'new-shard')], { old: ['missing-decision'] }).problems).toEqual([]);
  });

  test('the checked-in grandfather list holds every experiment registered when the check landed, and an edit fails', () => {
    const old = readGrandfathered(join(import.meta.dir, '..'));
    expect(old.size).toBe(131);
    expect(old.has('frontier-shootout-2026-11')).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), 'he-practices-'));
    try {
      mkdirSync(join(dir, 'runner/prereg'), { recursive: true });
      copyFileSync(join(import.meta.dir, '..', GRANDFATHERED_PATH), join(dir, GRANDFATHERED_PATH));
      expect(readGrandfathered(dir).size).toBe(131);
      const list = JSON.parse(readFileSync(join(dir, GRANDFATHERED_PATH), 'utf8'));
      list.experiments.push('a-new-plan-2026-11');
      writeFileSync(join(dir, GRANDFATHERED_PATH), JSON.stringify(list, null, 2) + '\n');
      expect(() => readGrandfathered(dir)).toThrow(/is frozen: a new preregistration states the eval-loop practices/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('prereg.ts runs the practices check', () => {
  test('both modes fail a newly registered plan that skips the practices, and pass it once it states them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-practices-cli-'));
    try {
      const git = (...a: string[]) => expect(spawnSync('git', ['-C', dir, ...a], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir } }).status).toBe(0);
      const prereg = 'docs/benchmarks/new-plan/PREREGISTRATION.md';
      mkdirSync(join(dir, 'runner/prereg'), { recursive: true });
      mkdirSync(join(dir, 'docs/benchmarks/new-plan'), { recursive: true });
      copyFileSync(join(import.meta.dir, '..', GRANDFATHERED_PATH), join(dir, GRANDFATHERED_PATH));
      writeFileSync(join(dir, 'docs/benchmarks/preregistrations.json'), JSON.stringify({ schema_version: 1, experiments: [{ id: 'new-plan', preregistration: prereg, results: ['docs/benchmarks/new-plan/results/**'] }] }));
      writeFileSync(join(dir, LEDGER_PATH), JSON.stringify({ schema_version: 1, note: 'synthetic', label: ATTESTED, cutover: '2000-01-01T00:00:00.000Z', experiments: [] }));
      writeFileSync(join(dir, ATTESTATION_MAP_PATH), JSON.stringify({ schema_version: 1, note: 'synthetic', label: MAPPED, attestations: {}, exceptions: [] }));
      writeFileSync(join(dir, prereg), '# A new plan\n');
      git('init', '-q');
      git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'add', '-A');
      git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'Register');
      const run = (...a: string[]) => spawnSync(process.execPath, [join(import.meta.dir, '..', 'runner/prereg/prereg.ts'), ...a], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir } });
      for (const mode of [[], ['--public']]) {
        const bad = run(...mode);
        expect([mode, bad.status, bad.stderr]).toEqual([mode, 1, expect.stringContaining(`prereg-practices: new-plan: ${prereg}: no "## Eval loop" section`)]);
      }
      copyFileSync(join(ROOT, 'pass', 'PREREGISTRATION.md'), join(dir, prereg));
      git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qam', 'State the practices');
      for (const mode of [[], ['--public']]) {
        const ok = run(...mode);
        expect([mode, ok.status, ok.stdout]).toEqual([mode, 0, expect.stringContaining('prereg-practices: 1 new experiments checked, 0 grandfathered, 0 problems')]);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 20_000);
});

describe('a new run\'s results carry the call it settled and its spend', () => {
  test('a report with no Settled line fails', () => {
    expect(check([entry('missing-settled')]).problems).toEqual([{ id: 'missing-settled', file: 'missing-settled/report.md', problem: 'no "- **Settled:**" line naming the ship-or-kill call this result settled, or "none"' }]);
  });

  test('spend-internal.md without the meter spend line fails in the private check, and the public check does not read it', () => {
    expect(check([entry('missing-spend')]).problems).toEqual([{ id: 'missing-spend', file: 'missing-spend/spend-internal.md', problem: 'no "- **Meter spend:** $<n>" line' }]);
    expect(check([entry('missing-spend')], { spend: false }).problems).toEqual([]);
    expect(check([entry('missing-decision')]).problems.map(p => p.file)).toEqual(['missing-decision/PREREGISTRATION.md']);
  });
});
