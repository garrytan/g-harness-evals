// Tests for the edition graders (harnesses/qm/gstack/edition-grade.ts): the extraction step, hand-written good and
// bad replies, and the red team that must fail every grader (decision F1): an all-files-and-flags plan, an
// every-hunk-but-the-decoys review, a hypothesis list that concludes wrong, padding and heading-only replies.
// Keys come from generating the TEST-ONLY bank in tests/fixtures/qm-s1-edition/.
import { beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, type Generated, type KeyRecord, type PlanKey } from '../harnesses/qm/gstack/edition-fixture.ts';
import { aliasJudge, extract, gradeInvestigate, gradeReply, gradeReview, has, lineRefs, sections, strip, type PlanJudge, type PlanJudgeInput } from '../harnesses/qm/gstack/edition-grade.ts';

const BANK_TEXT = readFileSync(join(import.meta.dir, 'fixtures', 'qm-s1-edition', 'test-only-bank.json'), 'utf8');
let gen: Generated, out: string;
beforeAll(() => { out = join(mkdtempSync(join(tmpdir(), 'edition-grade-')), 'gen'); gen = generate(BANK_TEXT, 'test-seed-1', out); }, 120_000);
const key = (id: string) => gen.keys[id]! as KeyRecord;
const grade = async (id: string, reply: string, judge?: PlanJudge) => gradeReply('t-' + id, id, reply, key(id), gen.tasks.find((t) => t.id === id)!.request, judge);
const ok = async (id: string, reply: string) => (await grade(id, reply)).success;
const md = (s: string) => s.replace(/BTK/g, String.fromCharCode(96));
const FILLER = Array.from({ length: 40 }, (_, i) => 'We value careful engineering and thorough analysis of every change, paragraph ' + i + '.').join(' ');

describe('edition-grade: one extraction step', () => {
  test('markers go, but dunder and underscore file names stay whole', () => {
    expect(strip('the cause is in plugins/__init__.py')).toBe('the cause is in plugins/__init__.py');
    expect(strip('see __init__.py and src/_cache.py')).toBe('see __init__.py and src/_cache.py');
    expect(strip('**bold** and __also bold__ and *em* and _em_')).toBe('bold and also bold and em and em');
  });

  test('headings go, markers go, and a heading-only reply extracts nothing', () => {
    const s = sections(md('# Title\n\n## Root cause\n\n**Bold** and BTKcodeBTK and _em_ with a [link](http://x).\n\nRoot cause:\nnext line\n\nSummary\n-------\nlast'));
    expect(s.map((x) => x.heading)).toEqual(['Root cause', 'Root cause', 'Summary']);
    expect(s[0]!.units).toEqual(['Bold and code and em with a link.']);
    expect(extract('# Root cause: src/paginate.js uses Math.floor\n## Fix: Math.ceil\n**Verdict**\n')).toEqual([]);
  });

  test('trailing follow-up sections and courtesy lines are cut; earlier sections stay', () => {
    const s = extract('## Answer\nThe cause is X.\n\nWant me to fix it?\n\n## Next steps\n- run the tests\n\n## Questions\nShould I open a PR?');
    expect(s).toEqual([{ heading: 'Answer', units: ['The cause is X.'] }]);
  });

  test('list items are units; nested bullets and continuation lines join their item; table rows are units', () => {
    const s = sections('- one\n  - nested\n  more\n- two\n\n| a | b |\n|---|---|\n| c | d |\n\npara one\nstill para');
    expect(s[0]!.units).toEqual(['one nested more', 'two', 'a b', 'c d', 'para one still para']);
  });

  test('phrases match at word edges, with stem* prefixes; line references are read in four forms', () => {
    expect(has('see src/paginate.js:12', 'paginate.js')).toBe(true);
    expect(has('see index.js', 'x.js')).toBe(false);
    expect(has('it truncates', 'truncat*')).toBe(true);
    expect(has('items', 'ms')).toBe(false);
    expect(has('use >= here', '>=')).toBe(true);
    expect(lineRefs('line 17, lines 3-5, price.js:9, #L20-L22, L4')).toEqual([[17, 17], [3, 5], [9, 9], [20, 22], [4, 4]]);
  });
});

describe('edition-grade: investigate', () => {
  const STRUCTURED = md([
    '## Symptom', 'BTKpageCount(101, 10)BTK returns 10, so "a partial last page still counts as a page" fails.', '',
    '## Root cause', 'The commit "Simplify the page math" changed BTKsrc/paginate.jsBTK so BTKpageCountBTK uses BTKMath.floorBTK instead of BTKMath.ceilBTK, which rounds down and drops the partial last page.', '',
    '## Ruled out', '- BTKsrc/config.jsBTK: the default page size went from 10 to 20, but the test passes BTKperPageBTK explicitly, so it is unrelated.', '- BTKsrc/format.jsBTK: the BTKtoLocaleStringBTK change only affects display and its own test passes.', '',
    '## Next steps', 'Want me to switch it back to BTKMath.ceilBTK?',
  ].join('\n'));
  const PROSE = md([
    'I ran the tests: BTKa partial last page still counts as a pageBTK fails because BTKpageCount(101, 10)BTK returns 10 instead of 11.', '',
    'The cause is the "Simplify the page math" commit. It changed BTKpageCountBTK in src/paginate.js from BTKMath.ceilBTK to BTKMath.floorBTK, so any partial last page is dropped.', '',
    'The other recent changes are unrelated: raising BTKdefaultPerPageBTK to 20 in src/config.js does not matter because the test passes a page size, and the BTKtoLocaleStringBTK change in src/format.js only touches display.', '',
    "I haven't changed anything. Want me to put BTKMath.ceilBTK back?",
  ].join('\n'));

  test('good replies pass, structured or prose', async () => {
    expect(await ok('inv-01', STRUCTURED)).toBe(true);
    expect(await ok('inv-01', PROSE)).toBe(true);
    expect(await ok('inv-01', 'I first suspected the default page size change in src/config.js, but the real cause is src/paginate.js: pageCount now uses Math.floor, which rounds 101/10 down to 10.')).toBe(true);
    expect(await ok('inv-02', 'Root cause: src/token.js. issue() now stores expiresAt in seconds, but isExpired still compares it with Date.now() in milliseconds, so every token looks expired. The 30 minute session change in src/session.js is not the cause.')).toBe(true);
  });

  test('bad replies fail: the wrong cause, the right file without a mechanism, or two causes', async () => {
    expect(await ok('inv-01', '## Root cause\nThe default page size in src/config.js was raised from 10 to 20, which breaks the page count.')).toBe(false);
    expect(await ok('inv-01', 'Something in src/paginate.js changed this week and broke the test.')).toBe(false);
    expect(await ok('inv-02', 'Two things broke it: src/token.js stores expiresAt in seconds, and src/session.js shortened TTL_SECONDS to 1800.')).toBe(false);
  });

  test('red team: a hypothesis list that concludes wrong fails, and so does one that never concludes', async () => {
    const hypotheses = '## Hypotheses\n1. src/paginate.js: Math.floor in pageCount rounds down.\n2. src/config.js: the default page size changed to 20.\n3. src/format.js: toLocaleString formatting.\n\n';
    expect(await ok('inv-01', hypotheses + '## Conclusion\nThe most likely cause is the default page size change in src/config.js.')).toBe(false);
    expect(await ok('inv-01', hypotheses + '## Next steps\nI can dig into any of these.')).toBe(false);
    expect(await ok('inv-01', 'Possible causes:\n- src/paginate.js Math.floor\n- src/config.js default page size to 20\n- src/format.js toLocaleString')).toBe(false);
    expect(await ok('inv-01', "It could be src/paginate.js with Math.floor or src/config.js with the default page size. I think it's src/config.js: the default page size went to 20.")).toBe(false);
    expect(await ok('inv-01', hypotheses + '## Conclusion\nThe cause is src/paginate.js: Math.floor rounds the last partial page away.')).toBe(true);
  });

  test('red team: padding and heading-only replies fail', async () => {
    expect(await ok('inv-01', 'Root cause analysis. ' + FILLER + ' It could be src/paginate.js with Math.floor, src/config.js with the default page size of 20, or src/format.js with toLocaleString. ' + FILLER)).toBe(false);
    expect(await ok('inv-01', 'Root cause: src/paginate.js uses Math.floor. Also relevant: src/config.js changed the default page size to 20 and src/format.js added toLocaleString. ' + FILLER)).toBe(false);
    expect(await ok('inv-01', FILLER)).toBe(false);
    expect(await ok('inv-01', '# Root cause: src/paginate.js uses Math.floor\n## Mechanism: rounds down\n')).toBe(false);
  });

  test('every grade reports the reply length and the final answer length', async () => {
    const g = await grade('inv-01', STRUCTURED);
    expect(g.reply_chars).toBe(STRUCTURED.length);
    expect(g.final_chars).toBeGreaterThan(0);
    expect(g.final_chars).toBeLessThan(g.reply_chars);
    expect(g.detail.heading).toBe('Root cause');
  });
});

describe('edition-grade: review', () => {
  const STRUCTURED = md([
    '## Summary', 'One issue to fix before merging.', '',
    '## Issues', '1. **src/price.js line 17, BTKbulkDiscountBTK**: BTKitemCount(items) > BULK_MIN_QTYBTK excludes orders of exactly 10 items, but the README says 10 or more get the discount. Use BTK>=BTK.', '',
    '## Looks odd but is fine', '- BTKsrc/cart.jsBTK line 6 uses BTK== nullBTK on purpose so null and undefined variants both map to an empty string.', '- BTKsrc/money.jsBTK adds BTKNumber.EPSILONBTK before rounding, the standard fix for values like 1.005.', '',
    'Want me to push the fix?',
  ].join('\n'));
  const PROSE = md('I read the diff. The one real problem is in src/price.js: BTKbulkDiscountBTK checks BTKitemCount(items) > BULK_MIN_QTYBTK, so an order of exactly 10 items gets no discount even though the README promises it for 10 or more. It should be BTK>=BTK.\n\nThe BTK== nullBTK check in src/cart.js and the BTKNumber.EPSILONBTK rounding in src/money.js look unusual but are correct.\n\nEverything else (tests, README, changelog) looks good.');

  test('good replies pass, structured or prose', async () => {
    expect(await ok('rev-01', STRUCTURED)).toBe(true);
    expect(await ok('rev-01', PROSE)).toBe(true);
    expect(await ok('rev-02', 'Blocking: src/cell.js line 5 writes values with String(value) and never quotes or escapes them, so a customer name with a comma or a double quote breaks the row.\n\nThe CRLF line endings in src/csv.js and isoDay slicing toISOString in src/dates.js match the README, so leave them.')).toBe(true);
  });

  test('bad replies fail: a flagged decoy, a missed defect, or the right line with no mechanism', async () => {
    expect(await ok('rev-01', '1. src/price.js line 17: > should be >= for orders of exactly 10.\n2. src/cart.js line 6: == null should be ===, loose equality is a bug.')).toBe(false);
    expect(await ok('rev-01', 'Looks good to merge. The README and changelog are clear.')).toBe(false);
    expect(await ok('rev-01', 'Please double-check src/price.js line 17.')).toBe(false);
    expect(await ok('rev-02', 'src/cell.js line 5 does not escape commas. Also src/dates.js line 2: slicing the ISO string drops the timezone, use a date library.')).toBe(false);
  });

  test('red team: an every-hunk-but-the-decoys review fails, even with the defect named correctly', async () => {
    for (const id of ['rev-01', 'rev-02']) {
      const k = key(id).key as any;
      const plain = k.hunks.filter((h: any) => !k.decoys.some((d: any) => h.file === d.file && h.start <= d.lines[1] && d.lines[0] <= h.end));
      const reply = plain.map((h: any) => '- ' + h.file + ' line ' + h.start + ': this change is risky' + (h.file === k.defect.file ? ' (' + k.defect.mechanism[0].replace('*', '') + ' problem)' : '') + '.').join('\n');
      const g = await grade(id, reply);
      expect(g.success).toBe(false);
      expect(g.detail.issue_count as number).toBeGreaterThan(3);
    }
  });

  test('red team: padding and heading-only replies fail', async () => {
    expect(await ok('rev-01', 'src/price.js line 17 should use >= for exactly 10 items. ' + FILLER + '\n\nsrc/cart.js line 6 == null and src/money.js line 2 EPSILON also need attention.')).toBe(false);
    expect(await ok('rev-01', '# src/price.js line 17: use >= for exactly 10\n## No other issues\n')).toBe(false);
    expect(await ok('rev-01', FILLER)).toBe(false);
  });
});

describe('edition-grade: plan', () => {
  const GOOD = md([
    '## Plan',
    '1. Add BTKmigrations/0004_add_gift_message.sqlBTK with a nullable BTKgift_messageBTK column. Do not edit 0002 or 0003: migrations run in filename order and merged ones are never edited.',
    '2. Accept the message in both checkout paths, BTKsrc/checkout/v1.jsBTK and BTKv2.jsBTK, since BTKcheckout_v2BTK is still off behind its flag.',
    '3. Leave the existing receipt lines alone: BTKtest/receipt.test.jsBTK pins the exact text finance parses. If the message must appear, add a new last line and update the test deliberately.',
    '4. Add tests for the new column and both checkout paths.', '',
    'Want me to start with the migration?',
  ].join('\n'));

  test('a good plan passes; a plan naming one constraint fails', async () => {
    expect(await ok('plan-01', GOOD)).toBe(true);
    expect(await ok('plan-02', '1. Put the limiter in src/app.js after auth in the middleware order, since it needs req.user.\n2. Ship it in shadow mode: rate_limit_enforce is off, so log what would be blocked.\n3. Keep /health exempt; test/health.test.js pins that.')).toBe(true);
    expect(await ok('plan-01', '1. Add a gift_message column with a new migration 0004.\n2. Show it on the order page.')).toBe(false);
  });

  test('red team: an all-files-and-flags plan fails, built from the repository alone', async () => {
    for (const id of ['plan-01', 'plan-02']) {
      const dir = gen.tasks.find((t) => t.id === id)!.repo_dir;
      const files = spawnSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } }).stdout.trim().split('\n');
      const flags = Object.keys(JSON.parse(readFileSync(join(dir, 'config', 'flags.json'), 'utf8')));
      const reply = 'Plan: review and update every file: ' + files.join(', ') + '. Check every flag: ' + flags.join(', ') + '. Add a new migration if needed, keep the tests passing, and follow the middleware order, health check and receipt format.';
      const g = await grade(id, reply);
      expect(g.success).toBe(false);
      expect(g.detail.named_count as number).toBeGreaterThan(6);
    }
  });

  test('red team: padding and heading-only plans fail', async () => {
    expect(await ok('plan-01', GOOD + '\n\n## Risks\n- dark_mode styling\n- the confirmation email template\n- the db.js connection pool\n- eslint rules\n- the README')).toBe(false);
    expect(await ok('plan-01', '# Plan\n## Add migration 0004, never edit old migrations\n## Handle checkout_v2 behind the flag\n## Keep the receipt test pinned\n')).toBe(false);
    expect(await ok('plan-01', FILLER)).toBe(false);
  });

  test('the judge is pluggable and arm-blind: it gets the request, stripped text and constraint descriptions only', async () => {
    const seen: PlanJudgeInput[] = [];
    const stub: PlanJudge = { id: 'stub-judge', async judge(input) { seen.push(input); return { named: ['new-migration', 'receipt-pinned', 'not-a-constraint'], named_count: 4 }; } };
    const g = await grade('plan-01', '## Plan\n**Step one**: do the thing.', stub);
    expect(g.success).toBe(true);
    expect(g.grader).toBe('edition-grade/1+stub-judge');
    expect(g.detail.named).toEqual(['new-migration', 'receipt-pinned']);
    expect(Object.keys(seen[0]!).sort()).toEqual(['constraints', 'final_answer', 'request']);
    expect(seen[0]!.final_answer).toBe('Step one: do the thing.');
    expect(seen[0]!.constraints.map((c) => Object.keys(c).sort().join(','))).toEqual(['description,id', 'description,id', 'description,id']);
    const fallback = await aliasJudge.judge({ request: '', final_answer: 'nothing here', constraints: [] }, key('plan-01').key as PlanKey);
    expect(fallback).toEqual({ named: [], named_count: 0 });
  });
});

describe('edition-grade: wording does not decide the grade (/ship round 1 on #290)', () => {
  const rkey = {
    base: 'main', defect: { file: 'src/session.js', lines: [10, 10] as [number, number], mechanism: ['off-by-one', '<='], symbols: ['isExpired'] },
    decoys: [{ file: 'src/session.js', lines: [13, 13] as [number, number] }, { file: 'src/auth.js', lines: [30, 30] as [number, number] }],
    diff_files: ['src/session.js', 'src/auth.js', 'src/util.js', 'README.md'],
    hunks: [{ file: 'src/session.js', start: 10, end: 10 }, { file: 'src/session.js', start: 13, end: 13 }, { file: 'src/auth.js', start: 5, end: 6 }, { file: 'src/auth.js', start: 30, end: 30 }, { file: 'src/util.js', start: 1, end: 4 }, { file: 'README.md', start: 1, end: 2 }],
  };
  const ikey = { cause: { file: 'src/paginate.js', aliases: ['pageCount'], mechanism: ['Math.floor', 'rounds down', 'truncat*'] }, decoys: [{ file: 'src/config.js', mechanism: ['default page size'] }] };
  const review = (t: string) => gradeReview(extract(t), rkey as never);
  const inv = (t: string) => gradeInvestigate(extract(t), ikey as never);

  test('correct reviews pass however they are worded', () => {
    for (const t of [
      'src/session.js lines 10-11: isExpired uses < instead of <=, an off-by-one, so sessions expire one tick late.',
      'This branch touches src/session.js, src/auth.js, src/util.js and README.md.\n\nsrc/session.js:10 isExpired has an off-by-one: it should use <=.',
      'src/session.js:10 isExpired is an off-by-one bug but the rest is fine.',
      '## src/session.js:10\n\nThe comparison is an off-by-one: it must be <= so a session expires on time.',
      'src/session.js:10 isExpired has an off-by-one, it should use <=.\n\nsrc/auth.js:30 trims the token, but that is intentional.',
      "src/session.js:10 isExpired has an off-by-one, it should use <=. src/auth.js:30 isn't a problem.",
      'src/session.js:10 isExpired uses < so an expired session cannot be rejected on its last tick; use <= (an off-by-one).',
      'src/session.js:10 isExpired has an off-by-one, not in the token check: it should use <=.',
      "src/session.js:10 isExpired has an off-by-one, it should use <=.\n\nsrc/auth.js:30 trims the token, which can't be an issue.",
    ]) expect([t, review(t).success]).toEqual([t, true]);
  });

  test('a line range that covers a decoy as well as the defect flags the decoy', () => {
    expect(review('src/session.js:10-13 is buggy: off-by-one, use <=.').detail.decoys_flagged).toEqual(['decoy-0']);
  });

  test('a flagged decoy fails even when its sentence holds a negation', () => {
    for (const t of [
      'src/session.js:10 isExpired has an off-by-one, it should use <=.\n\nsrc/auth.js:30 does not validate the token length, this is a bug.',
      'src/session.js:10 isExpired has an off-by-one, it should use <=.\n\nsrc/auth.js:30 trims the token, which is a bug.',
    ]) expect(review(t).detail.decoys_flagged).toEqual(['decoy-1']);
  });

  test('correct investigations pass however they are worded', () => {
    for (const t of [
      'pageCount in src/paginate.js should use Math.ceil instead of Math.floor.',
      'The cause is pageCount in src/paginate.js using Math.floor, but the page size setting is fine.',
      "The cause is pageCount in src/paginate.js: it uses Math.floor. src/config.js's default page size is fine.",
      '## Root cause\n\npageCount in src/paginate.js uses Math.floor, which rounds down.\n\n## Verification\n\nRan the tests: tests/paginate.test.js now passes.',
      '## Root cause: src/paginate.js\n\npageCount uses Math.floor, which rounds down and drops the last partial page.',
      'pageCount in src/paginate.js uses Math.floor, so the last partial page cannot be reached.',
      "pageCount in src/paginate.js uses Math.floor, so the last partial page can't be shown.",
      '## Root cause\n\npageCount in src/paginate.js uses Math.floor, which rounds down.\n\n## Fix\n\nSo the fix is to use Math.ceil.',
      '## Root cause\n\npageCount in src/paginate.js uses Math.floor, which rounds down.\n\nIn summary, I added a regression test in tests/pagination.test.js.',
      'pageCount in src/paginate.js uses Math.floor, which rounds down. The default page size in src/config.js cannot be the root cause.',
      "pageCount in src/paginate.js uses Math.floor, which rounds down. The default page size in src/config.js can't be responsible.",
      "pageCount in src/paginate.js uses Math.floor, which rounds down. The default page size in src/config.js couldn't be related.",
    ]) expect([t, inv(t).success]).toEqual([t, true]);
  });

  test('an abandoned correct hypothesis followed by a wrong conclusion fails', () => {
    const g = inv('## Hypothesis\n\nsrc/paginate.js uses Math.floor, which rounds down.\n\n## Conclusion\n\nThe real cause is a missing database index in src/database.js, which makes the query time out.');
    expect(g.success).toBe(false);
    expect(String(g.detail.later_conclusion)).toContain('src/database.js');
  });
});

describe('edition-grade: the command', () => {
  test('grades every turn line with its task key and writes one grade line per trial', () => {
    const turns = join(out, 'turns.jsonl'), grades = join(out, 'grades.jsonl');
    writeFileSync(turns, [
      { trial_id: 'a', task_id: 'inv-01', reply_text: 'The cause is src/paginate.js: Math.floor rounds down.' },
      { trial_id: 'b', task_id: 'rev-01', reply_text: '' },
    ].map((t) => JSON.stringify(t)).join('\n') + '\n');
    const r = spawnSync('bun', [join(import.meta.dir, '..', 'harnesses', 'qm', 'gstack', 'edition-grade.ts'), '--turns', turns, '--keys', join(out, 'keys.json'), '--tasks', join(out, 'tasks.json'), '--out', grades], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/' } });
    expect(r.status).toBe(0);
    const lines = readFileSync(grades, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => [l.trial_id, l.family, l.success, l.reply_chars])).toEqual([['a', 'investigate', true, 53], ['b', 'review', false, 0]]);
  });

  test('--judge swaps in a plan judge module, and the grade names it', () => {
    const plan = gen.tasks.find((t) => t.family === 'plan')!;
    const turns = join(out, 'turns-judge.jsonl'), grades = join(out, 'grades-judge.jsonl'), mod = join(out, 'judge.ts');
    writeFileSync(turns, JSON.stringify({ trial_id: 'p', task_id: plan.id, reply_text: 'A plan.' }) + '\n');
    writeFileSync(mod, "export default { id: 'test-judge/1', async judge(_input, key) { return { named: key.constraints.map((c) => c.id), named_count: key.constraints.length }; } };\n");
    const r = spawnSync('bun', [join(import.meta.dir, '..', 'harnesses', 'qm', 'gstack', 'edition-grade.ts'), '--turns', turns, '--keys', join(out, 'keys.json'), '--judge', mod, '--out', grades], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/' } });
    expect(r.status).toBe(0);
    const g = JSON.parse(readFileSync(grades, 'utf8').trim());
    expect([g.grader, g.success]).toEqual(['edition-grade/1+test-judge/1', true]);
  });
});
