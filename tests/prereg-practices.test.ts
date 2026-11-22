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
import { checkPractices, freezeDate, GRANDFATHERED_PATH, COST_PROJECTION_FROM, JUDGE_100_FROM, minLabelled, planProblems as planProblemsOn, readGrandfathered, receiptProblems } from '../runner/prereg/practices.ts';

const ROOT = join(import.meta.dir, 'fixtures/prereg-practices');
const plan = (name: string) => readFileSync(join(ROOT, name, 'PREREGISTRATION.md'), 'utf8');
const entry = (folder: string, file = 'PREREGISTRATION.md', id = folder): ManifestEntry => ({ id, preregistration: `${folder}/${file}`, results: [`${folder}/results/**`] });
// The fixtures read under R78's 40-output floor, a plan frozen before 2026-11-22; the floor's own tests pass dates.
const BEFORE = '2026-11-21';
const planProblems = (text: string, frozen = BEFORE) => planProblemsOn(text, frozen);
const check = (entries: ManifestEntry[], opts: { spend?: boolean; old?: string[] } = {}) =>
  checkPractices(entries, ROOT, { spend: opts.spend ?? true, grandfathered: new Set(opts.old ?? []), frozen: () => BEFORE });

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
    expect(planProblems(plan('pass').replace('| card | 20 | 0.6 |\n', ''))).toEqual(['"## Judge check" has no row for arm "card": the judge is read per arm, not pooled (R78)', '"## Judge check" plans 20 labelled outputs; R78 needs at least 40 for a plan frozen on 2026-11-21']);
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

describe('the judge check\'s labelled-output floor follows the plan\'s freeze date (R78; internal-task)', () => {
  const judged = (n: number) => plan('pass').replace('| plain | 20 | 0.6 |', `| plain | ${n} | 0.6 |`).replace('| card | 20 | 0.6 |', `| card | ${n} | 0.6 |`);
  test('a plan frozen before 2026-11-22 needs 40 labelled outputs; one frozen on or after it needs 100', () => {
    expect(JUDGE_100_FROM).toBe('2026-11-22');
    expect([minLabelled('2026-11-21'), minLabelled('2026-11-22'), minLabelled('2027-01-01')]).toEqual([40, 100, 100]);
    expect(planProblemsOn(judged(20), '2026-11-21')).toEqual([]);
    expect(planProblemsOn(judged(20), '2026-11-22')).toEqual(['"## Judge check" plans 40 labelled outputs; R78 needs at least 100 for a plan frozen on 2026-11-22']);
    expect(planProblemsOn(judged(49), '2026-11-22')).toEqual(['"## Judge check" plans 98 labelled outputs; R78 needs at least 100 for a plan frozen on 2026-11-22']);
    expect(planProblemsOn(judged(50), '2026-11-22')).toEqual([]);
    expect(planProblemsOn(judged(19), '2026-11-21')).toEqual(['"## Judge check" plans 38 labelled outputs; R78 needs at least 40 for a plan frozen on 2026-11-21']);
  });

  test('the judge check takes one row per pilot arm: a repeated or unknown arm is a problem and does not count (outside-voice#1)', () => {
    const card = '| card | 20 | 0.6 |';
    expect(planProblemsOn(plan('pass').replace(card, [card, card, card, card].join('\n')), '2026-11-22')).toEqual([
      '"## Judge check" has more than one row for arm "card": one row per pilot arm (R78)',
      '"## Judge check" plans 40 labelled outputs; R78 needs at least 100 for a plan frozen on 2026-11-22',
    ]);
    expect(planProblemsOn(plan('pass').replace(card, `${card}\n| ghost | 60 | 0.6 |`), '2026-11-22')).toEqual([
      '"## Judge check" has a row for arm "ghost", which is not a pilot arm: one row per pilot arm (R78)',
      '"## Judge check" plans 40 labelled outputs; R78 needs at least 100 for a plan frozen on 2026-11-22',
    ]);
  });

  test('the check passes each plan its freeze date', () => {
    expect(checkPractices([entry('pass')], ROOT, { spend: true, grandfathered: new Set(), frozen: () => '2026-11-22' }).problems.map(p => p.problem)).toEqual(['"## Judge check" plans 40 labelled outputs; R78 needs at least 100 for a plan frozen on 2026-11-22']);
    expect(checkPractices([entry('pass')], ROOT, { spend: true, grandfathered: new Set(), frozen: () => '2026-11-21' }).problems).toEqual([]);
  });

  test('a plan freezes when the commit adding it reaches origin/main; until then it freezes no earlier than today', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-practices-freeze-'));
    try {
      const git = (...a: string[]) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir } });
      const later = new Date('2030-06-01T12:00:00Z');
      git('init', '-q');
      writeFileSync(join(dir, 'plan.md'), '# plan\n');
      expect(freezeDate('plan.md', dir, later)).toBe('2030-06-01');
      git('add', 'plan.md');
      git('commit', '-qm', 'Add the plan');
      const committed = git('log', '-1', '--format=%cI').stdout.trim();
      const day = new Date(committed).toISOString().slice(0, 10);
      expect(freezeDate('plan.md', dir, later)).toBe(day);
      writeFileSync(join(dir, 'other.md'), 'x\n');
      git('add', 'other.md');
      git('commit', '-qm', 'Another commit');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD~1');
      expect(freezeDate('plan.md', dir, later)).toBe(day);
      git('update-ref', 'refs/remotes/origin/main', 'HEAD~1');
      writeFileSync(join(dir, 'branch.md'), '# a plan on a branch\n');
      git('add', 'branch.md');
      git('commit', '-qm', 'A plan not yet on main');
      expect(freezeDate('branch.md', dir, later)).toBe('2030-06-01');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a plan merged onto main freezes at the merge, whatever date its branch commit carries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-practices-merge-'));
    try {
      const git = (date: string, ...a: string[]) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
      const text = plan('pass');
      git('2026-11-01T12:00:00Z', 'init', '-q', '-b', 'main');
      writeFileSync(join(dir, 'README.md'), 'x\n');
      git('2026-11-01T12:00:00Z', 'add', 'README.md');
      git('2026-11-01T12:00:00Z', 'commit', '-qm', 'Start');
      git('2026-11-01T12:00:00Z', 'checkout', '-qb', 'prereg');
      writeFileSync(join(dir, 'plan.md'), text);
      git('2026-11-20T12:00:00Z', 'add', 'plan.md');
      git('2026-11-20T12:00:00Z', 'commit', '-qm', 'Add the plan, dated before the rule');
      git('2026-11-20T12:00:00Z', 'update-ref', 'refs/remotes/origin/main', 'main');
      expect(freezeDate('plan.md', dir, new Date('2026-11-21T23:00:00Z'))).toBe('2026-11-21');
      expect(planProblemsOn(text, freezeDate('plan.md', dir, new Date('2026-11-21T23:00:00Z')))).toEqual([]);
      git('2026-11-22T01:00:00Z', 'checkout', '-q', 'main');
      git('2026-11-22T01:00:00Z', 'merge', '-q', '--no-ff', '-m', 'Merge the plan', 'prereg');
      git('2026-11-22T01:00:00Z', 'update-ref', 'refs/remotes/origin/main', 'main');
      expect(freezeDate('plan.md', dir, new Date('2030-06-01T12:00:00Z'))).toBe('2026-11-22');
      expect(planProblemsOn(text, freezeDate('plan.md', dir))).toEqual(['"## Judge check" plans 40 labelled outputs; R78 needs at least 100 for a plan frozen on 2026-11-22']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
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
      writeFileSync(join(dir, prereg), plan('pass').replace('| plain | 20 | 0.6 |', '| plain | 50 | 0.6 |').replace('| card | 20 | 0.6 |', '| card | 50 | 0.6 |'));
      copyFileSync(join(ROOT, 'pass', 'plan-cost-receipt.json'), join(dir, 'docs/benchmarks/new-plan/plan-cost-receipt.json'));
      git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'add', '-A');
      git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'State the practices');
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

describe('a counted plan above $500 states its pilot-priced projection before it freezes', () => {
  const NO_SECTION = 'the plan is above $500 paid but has no "## Cost projection" section with its spend stop and its pilot-priced projection from scripts/plan-cost.ts';
  // The rule starts at COST_PROJECTION_FROM, after R78's 100-output floor, so these plans plan 50 labelled outputs per arm.
  const judged = (text: string) => text.replace('| plain | 20 | 0.6 |', '| plain | 50 | 0.6 |').replace('| card | 20 | 0.6 |', '| card | 50 | 0.6 |');
  const planProblems = (text: string, frozen = COST_PROJECTION_FROM) => planProblemsOn(judged(text), frozen);
  const checkAt = (frozen: string, name: string) => checkPractices([entry(name)], ROOT, { spend: true, grandfathered: new Set(), frozen: () => frozen }).problems.filter(p => !/R78 needs/.test(p.problem));

  test('a plan frozen before COST_PROJECTION_FROM is not asked for one', () => {
    expect(COST_PROJECTION_FROM).toBe('2026-11-23');
    expect(planProblems(plan('missing-cost-projection'), '2026-11-22')).toEqual([]);
    expect(checkAt('2026-11-22', 'missing-cost-projection')).toEqual([]);
  });

  test('missing the section fails above $500 and is not needed at $500', () => {
    expect(planProblems(plan('missing-cost-projection'))).toEqual([NO_SECTION]);
    expect(planProblems(plan('missing-cost-projection').replace('$1,200', '$500').replaceAll('$600 | $60', '$250 | $25').replace(/## Interim look[\s\S]*$/, ''))).toEqual([]);
  });

  test('each field is required, and a projection past the stop fails', () => {
    expect(planProblems(plan('pass').replace(/- Spend stop:.*\n/, ''))).toEqual(['"## Cost projection" has no "Spend stop: $<n>" field']);
    expect(planProblems(plan('pass').replace(/- Pilot-priced projection:.*\n/, ''))).toEqual(['"## Cost projection" has no "Pilot-priced projection: $<n>" field (the TOTAL scripts/plan-cost.ts printed from the pilot)']);
    expect(planProblems(plan('pass').replace(/- Projection receipt:.*\n/, ''))).toEqual(['"## Cost projection" has no "Projection receipt:" field naming the plan-cost receipt committed in the plan folder']);
    expect(planProblems(plan('pass').replace('- Pilot-priced projection: $980.40', '- Pilot-priced projection: $1,350'))).toEqual(['"## Cost projection": the pilot-priced projection $1350 passes the spend stop $1200; shrink the plan or raise the stop before it freezes']);
  });

  test('the committed receipt must exist, be priced in full and match the plan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-practices-receipt-'));
    try {
      const folder = 'plan';
      mkdirSync(join(dir, folder));
      const receipt = JSON.parse(readFileSync(join(ROOT, 'pass', 'plan-cost-receipt.json'), 'utf8'));
      const write = (r: unknown) => writeFileSync(join(dir, folder, 'plan-cost-receipt.json'), JSON.stringify(r));
      const problems = (text = plan('pass')) => receiptProblems(text, folder, dir);
      expect(problems()).toEqual(['"## Cost projection" names the receipt plan-cost-receipt.json, which is not in the repository; commit scripts/plan-cost.ts\'s --out receipt in the plan folder']);
      write(receipt);
      expect(problems()).toEqual([]);
      expect(problems(plan('pass').replace('- Projection receipt: plan-cost-receipt.json', '- Projection receipt: plan/plan-cost-receipt.json'))).toEqual([]);
      write({ ...receipt, projection: { ...receipt.projection, total_usd: 1010 } });
      expect(problems()).toEqual(['"## Cost projection" says $980.4 but its receipt\'s total is $1010.00']);
      write({ ...receipt, stop_usd: 1500 });
      expect(problems()).toEqual(['"## Cost projection" says the spend stop is $1200 but its receipt priced against $1500']);
      write({ ...receipt, projection: { ...receipt.projection, unpriced: ['card'] } });
      expect(problems()).toEqual(['the projection receipt plan-cost-receipt.json leaves cells unpriced (card): every arm is priced from its own pilot before the plan freezes']);
      write({ schema: 'something-else' });
      expect(problems()).toEqual(['the projection receipt plan-cost-receipt.json is not a plan-cost/1 receipt']);
      expect(receiptProblems(plan('quick-look'), folder, dir)).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('checkPractices reads the receipt beside each new plan', () => {
    expect(checkAt(COST_PROJECTION_FROM, 'missing-cost-projection')).toEqual([{ id: 'missing-cost-projection', file: 'missing-cost-projection/PREREGISTRATION.md', problem: NO_SECTION }]);
    expect(checkAt(COST_PROJECTION_FROM, 'pass')).toEqual([]);
  });
});
