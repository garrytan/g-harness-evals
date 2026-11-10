// internal-task pilot amendment: the task bank and seed the preregistration hashed, published at the paths the amendment
// names. Keyless.
//
// Value: protects=the published bank.json and seed.txt are byte for byte the files whose sha256 design.json and the
// preregistration committed before the edition was pinned, and the bank is the 72-template, 24-per-family real bank;
// and the amended run bank is that bank less amendment 1's removed templates, with no other byte changed;
// fails_when=a published file differs from its digest, a test-only bank is published in its place, or the run bank
// drops, adds or edits any other template; seam=design.json task_bank_sha256 and pilot_amendment.reduced_bank_sha256;
// no_claim=the generator's output (tests/qm-s1-edition-fixture.test.ts covers it).
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dir, '..', 'docs', 'benchmarks', '2026-11-06-qm-s1-edition');
const design = JSON.parse(readFileSync(join(DIR, 'design.json'), 'utf8'));
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

describe('qm-s1-edition published task bank', () => {
  test('bank.json and seed.txt match the sha256 the preregistration committed', () => {
    expect(sha(join(DIR, 'bank', 'bank.json'))).toBe(design.task_bank_sha256['bank.json']);
    expect(sha(join(DIR, 'bank', 'seed.txt'))).toBe(design.task_bank_sha256['seed.txt']);
  });

  test('it is the real bank: its bank_id, 72 templates, 24 per family, not test-only', () => {
    const bank = JSON.parse(readFileSync(join(DIR, 'bank', 'bank.json'), 'utf8'));
    expect(bank.bank_id).toBe(design.task_bank_sha256.bank_id);
    expect(bank.test_only).toBe(false);
    expect(bank.templates.length).toBe(72);
    const families: Record<string, number> = {};
    for (const t of bank.templates) families[t.family] = (families[t.family] ?? 0) + 1;
    expect(families).toEqual({ investigate: 24, review: 24, plan: 24 });
  });

  test('amendment 1: the run bank is bank.json less the removed templates, byte for byte as the original serializes', () => {
    const src = readFileSync(join(DIR, 'bank', 'bank.json'), 'utf8');
    const bank = JSON.parse(src);
    const write = (b: unknown) => JSON.stringify(b, null, 2) + '\n';
    expect(write(bank)).toBe(src);
    const pins = design.pilot_amendment;
    expect(bank.templates.filter((t: { family: string }) => t.family === 'investigate').map((t: { id: string }) => t.id)).toEqual(pins.removed_templates);
    const kept = { ...bank, templates: bank.templates.filter((t: { id: string }) => !pins.removed_templates.includes(t.id)) };
    const published = readFileSync(join(DIR, 'bank', 'bank-review-plan.json'), 'utf8');
    expect(published).toBe(write(kept));
    expect(sha(join(DIR, 'bank', 'bank-review-plan.json'))).toBe(pins.reduced_bank_sha256.review_plan_48);
    const families: Record<string, number> = {};
    for (const t of kept.templates) families[t.family] = (families[t.family] ?? 0) + 1;
    expect(families).toEqual(design.families);
    expect(kept.templates.length).toBe(design.tasks_total);
    const reviewOnly = write({ ...bank, templates: bank.templates.filter((t: { family: string }) => t.family === 'review') });
    expect(createHash('sha256').update(reviewOnly).digest('hex')).toBe(pins.reduced_bank_sha256.review_only_24);
  });

  test('amendment 3 part 3: the committed review-only bank is the fallback bank, byte for byte', () => {
    const pins = design.pilot_amendment;
    const bank = JSON.parse(readFileSync(join(DIR, 'bank', 'bank.json'), 'utf8'));
    const reviewOnly = JSON.stringify({ ...bank, templates: bank.templates.filter((t: { family: string }) => t.family === 'review') }, null, 2) + '\n';
    expect(readFileSync(join(DIR, 'bank', 'bank-review.json'), 'utf8')).toBe(reviewOnly);
    expect(sha(join(DIR, 'bank', 'bank-review.json'))).toBe(pins.reduced_bank_sha256.review_only_24);
    expect(design.main_amendment.part3.bank).toBe('docs/benchmarks/2026-11-06-qm-s1-edition/bank/bank-review.json');
  });
});
