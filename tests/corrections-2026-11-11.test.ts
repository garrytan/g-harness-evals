// The 2026-11-11 correction rebuilds every number from committed receipts, keyless (docs/corrections/2026-11-11/README.md).
// These tests rerun the reproducer on the committed receipts and check that the published prose quotes sensitivity.json.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CLEAN_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir() };
// The rebuild reads the per-try records of the four paired runs; where a copy lacks them it is skipped with a line naming them.
const HELD = ['2026-10-31-v03-opus-dev', '2026-11-01-installer-cc-codex', '2026-11-03-qm-c4-told-live', '2026-11-06-harness-zero-h2h']
  .map((r) => `docs/benchmarks/${r}/results/trials`).filter((p) => !existsSync(join(ROOT, p)));
if (HELD.length) console.log(`SKIP reproduce-2026-11-11.sh --check: absent in this copy: ${HELD.join(', ')}`);

describe('2026-11-11 correction: every number rebuilds from committed receipts', () => {
  test.skipIf(HELD.length > 0)('reproduce-2026-11-11.sh --check rebuilds docs/corrections/2026-11-11/sensitivity.json byte for byte', () => {
    const r = spawnSync('bash', ['scripts/corrections/reproduce-2026-11-11.sh', mkdtempSync(join(tmpdir(), 'he-corrections-s11-')), '--check'], { cwd: ROOT, encoding: 'utf8', env: CLEAN_ENV });
    expect(r.stderr + r.stdout).toBe('');
    expect(r.status).toBe(0);
  }, 300_000);

  test('the reproducer runs every script the numbers come from', () => {
    const sh = readFileSync(join(ROOT, 'scripts/corrections/reproduce-2026-11-11.sh'), 'utf8');
    for (const script of ['scripts/failure-mining/analyze.ts', 'scripts/corrections/failure-mining-scope.ts']) expect(sh).toContain(script);
  });
});

describe('the published prose quotes sensitivity.json', () => {
  const s = JSON.parse(readFileSync(join(ROOT, 'docs/corrections/2026-11-11/sensitivity.json'), 'utf8'));
  const md = readFileSync(join(ROOT, 'docs/corrections/2026-11-11/README.md'), 'utf8');
  const pts = (x: number) => (x < 0 ? '-' : '+') + Math.abs(100 * x).toFixed(1);
  type Row = { delta: number; ci95: [number, number]; p?: number; p_holm?: number; worse: number; units: number };
  const range = (r: Row) => `${pts(r.delta)} [${pts(r.ci95[0])}, ${pts(r.ci95[1])}]`;

  test('which checks the 120 unscoped brain-search failures failed', () => {
    const c = s.scope_check.all_pairs;
    expect([c.unscoped_brain_search.failures, c.unscoped_brain_search.failed_only_the_scope_check, c.unscoped_brain_search.would_pass_without_the_scope_check]).toEqual([120, 102, 108]);
    expect(c.unscoped_brain_search.failed_checks).toEqual({ no_cross_scope_reads: 102, 'draft_created + no_cross_scope_reads': 11, 'no_cross_scope_reads + secondary recall_without_reread': 6, 'no_cross_scope_reads + not_distractor': 1 });
    expect(s.scope_check.without_qm.unscoped_brain_search.would_pass_without_the_scope_check).toBe(96);
    expect([c.would_pass_without_the_scope_check.trials, c.failed_only_the_scope_check.trials]).toEqual([119, 113]);
    expect(c.would_pass_without_the_scope_check.by_arm_and_class).toEqual({ 'brain, unscoped_brain_search': 108, 'no brain, cross_scope_read': 6, 'brain, cross_scope_read': 5 });
  });

  test('the answer-only table', () => {
    const pub = s.as_published.all_pairs, a = s.answer_only, st = a.no_other_failed_check_at_all;
    expect(a.counted_as_passes).toBe(119);
    expect(st.counted_as_passes).toBe(113);
    expect(md).toContain(`| As published, 7 pairs | **${range(pub.retrieval_any)}** | ${pub.retrieval_any.p.toFixed(4)} | ${range(pub.overall_failure)} |`);
    expect(md).toContain(`| Answer-only, 7 pairs | **${range(a.all_pairs.retrieval_any)}** | ${a.all_pairs.retrieval_any.p.toFixed(2)} | ${range(a.all_pairs.overall_failure)} |`);
    expect(md).toContain(`| Answer-only, without the QM pairs (5 pairs) | ${range(a.without_qm.retrieval_any)} | ${a.without_qm.retrieval_any.p.toFixed(2)} | ${range(a.without_qm.overall_failure)} |`);
    expect(md).toContain(`no other failed check at all, 7 pairs | ${range(st.all_pairs.retrieval_any)} | ${st.all_pairs.retrieval_any.p.toFixed(2)} | ${range(st.all_pairs.overall_failure)} |`);
    expect(md).toContain(`| Same stricter reading, without the QM pairs | ${range(st.without_qm.retrieval_any)} | ${st.without_qm.retrieval_any.p.toFixed(3)} | ${range(st.without_qm.overall_failure)} |`);
    expect(md).toContain(`-0.3 points [-2.9, +2.4] instead of +9.5`);
    expect(range(a.all_pairs.retrieval_any)).toBe('-0.3 [-2.9, +2.4]');
  });

  test('the sensitivity line without the QM pairs', () => {
    const pub = s.as_published.all_pairs, q = s.as_published.without_qm;
    expect([q.pairs.length, q.units, q.trials_brain, q.trials_none]).toEqual([5, 90, 756, 412]);
    expect(q.pairs.every((p: string) => !p.includes(', qm,'))).toBe(true);
    expect(md).toContain(`| Retrieval failures, gbrain minus none [95%] | ${range(pub.retrieval_any)} | **${range(q.retrieval_any)}** |`);
    expect(md).toContain(`| ${pub.retrieval_any.p_holm.toFixed(4)} (${pub.retrieval_any.p.toFixed(4)}) | **${q.retrieval_any.p_holm.toFixed(4)}** (${q.retrieval_any.p.toFixed(4)}) |`);
    expect(md).toContain(`| Task pairs worse with gbrain | ${pub.retrieval_any.worse} | ${q.retrieval_any.worse} |`);
    expect(md).toContain(`| ${range(pub.retrieval_any_verified_only)}, Holm ${pub.retrieval_any_verified_only.p_holm.toFixed(4)} | ${range(q.retrieval_any_verified_only)}, Holm ${q.retrieval_any_verified_only.p_holm.toFixed(4)} |`);
    expect(md).toContain(`| ${range(pub.unscoped_brain_search)} | ${range(q.unscoped_brain_search)} |`);
    const [lo, hi] = s.scope_table_without_qm.unscoped_range;
    expect(md).toContain(`**${(100 * lo).toFixed(1)}% to ${(100 * hi).toFixed(1)}%**`);
  });

  test('the label note: which ticket ids sit on pages the asker can read', () => {
    const n = s.label_note;
    expect(n.failed_checks).toEqual(['not_distractor', 'no_cross_scope_reads']);
    expect(n.returned_pages.filter((p: { asker_can_read: boolean }) => !p.asker_can_read).map((p: { slug: string; ticket_ids: string[] }) => [p.slug, p.ticket_ids]))
      .toEqual([['dev/meetings/2026-04-22-marrow-renewal-call', ['#PD-8841']], ['dev/emails/2025-10-02-mas-affiliate-amendment-signed', []]]);
    const readable = n.narrated_ids.filter((x: { returned_pages_asker_can_read: string[] }) => x.returned_pages_asker_can_read.length).map((x: { id: string }) => x.id);
    expect(readable).toEqual(['#4419', 'ZD-44918', 'MFW-218', '#PD-88412', '#4418']);
    const pd = n.narrated_ids.find((x: { id: string }) => x.id === '#PD-8841');
    expect([pd.returned_pages_asker_cannot_read, pd.other_world_records_asker_can_read]).toEqual([['dev/meetings/2026-04-22-marrow-renewal-call'], 2]);
  });
});
