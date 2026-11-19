// Pilot audit helper for the owner-identity grader (plan, "Pilot"): draws n verdicts per arm, each with the line that decided it, as a
// markdown table a reviewer fills in against the gold list, and scores a filled table for agreement.
//
//   bun scripts/owner-identity/audit-sample.ts --verdicts <verdicts.json>... --n 40 --seed <s> [--out <table.md>]
//   bun scripts/owner-identity/audit-sample.ts --score <filled table.md> [--json]
//
// One verdict is one planted fact in one trial: for a false-owner fact, whether it was filed on the owner unnamed; for an owner fact or a
// secondary, whether it reached an owner surface. The reviewer writes agree or disagree in the reviewer column. The draw is seeded, so the
// same files, n and seed give the same table.

import { readFileSync, writeFileSync } from 'node:fs';
import { seededRandom } from '../../runner/stats/paired.ts';
import type { FactVerdict, Verdicts } from '../../runner/grade/owner-identity.ts';

export interface AuditRow { arm: string; file: string; task: string; fact: string; primary: string; claimant: string; token: string; planted: string; grader: string; evidence: string }

const cell = (s: string, max = 220) => s.replace(/\s+/g, ' ').trim().slice(0, max).replace(/\|/g, '\\|');

export function auditRow(file: string, v: Verdicts, f: FactVerdict): AuditRow {
  const fo = f.primary === 'false_owner';
  const decisive = f.occurrences.find((x) => x.surface === 'owner' && (!fo || !x.names_claimant)) ?? f.occurrences.find((x) => x.surface === 'owner');
  const evidence = decisive ? `${decisive.where}: ${decisive.line}`
    : f.occurrences.length ? `no owner-surface line; token on ${[...new Set(f.occurrences.map((x) => x.surface))].join(', ')}: ${f.occurrences[0]!.where}: ${f.occurrences[0]!.line}` : 'token nowhere in the store';
  return { arm: v.arm ?? 'unknown', file, task: v.task, fact: f.id, primary: f.primary, claimant: f.claimant, token: f.token, planted: f.text, grader: fo ? `false_owner_hit ${f.false_owner_hit ? 'yes' : 'no'}` : `owner_hit ${f.owner_hit ? 'yes' : 'no'}`, evidence };
}

function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (const ch of s) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

/** n rows per arm, drawn without replacement with a seeded shuffle of the rows in file, task and fact order. */
export function drawAudit(files: Array<{ file: string; verdicts: Verdicts }>, n: number, seed: string): AuditRow[] {
  const byArm = new Map<string, AuditRow[]>();
  for (const { file, verdicts } of files) for (const f of verdicts.facts) {
    const row = auditRow(file, verdicts, f);
    byArm.set(row.arm, [...(byArm.get(row.arm) ?? []), row]);
  }
  const out: AuditRow[] = [];
  for (const arm of [...byArm.keys()].sort()) {
    const rows = byArm.get(arm)!.sort((a, b) => a.file.localeCompare(b.file) || a.task.localeCompare(b.task) || a.fact.localeCompare(b.fact));
    const rand = seededRandom(seedOf(`${seed}:${arm}`));
    for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rows[i], rows[j]] = [rows[j]!, rows[i]!]; }
    out.push(...rows.slice(0, n));
  }
  return out;
}

const COLUMNS = ['#', 'arm', 'trial file', 'task', 'fact', 'primary', 'claimant', 'token', 'planted sentence', 'grader', 'evidence', 'reviewer', 'note'];

export function renderAudit(rows: AuditRow[], seed: string, n: number): string {
  const head = [`# Owner-identity grader audit (seed ${seed}, ${n} per arm)`, '', 'Fill the reviewer column with agree or disagree: does the grader call match the gold list for the evidence shown? Say why in note.', '',
    `| ${COLUMNS.join(' | ')} |`, `|${COLUMNS.map(() => '---').join('|')}|`];
  return [...head, ...rows.map((r, i) => `| ${i + 1} | ${r.arm} | ${cell(r.file)} | ${r.task} | ${r.fact} | ${r.primary} | ${r.claimant} | ${r.token} | ${cell(r.planted)} | ${r.grader} | ${cell(r.evidence)} |  |  |`)].join('\n') + '\n';
}

export interface AuditScore { arm: string; rows: number; filled: number; agree: number; disagree: number; agreement: number | null }

/** Agreement per arm and overall from a filled table: agree, yes or y agrees; disagree, no or n disagrees; anything else is unfilled. */
export function scoreAudit(markdown: string): AuditScore[] {
  const split = (line: string) => line.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim());
  const lines = markdown.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|') && l.endsWith('|'));
  const header = lines.length ? split(lines[0]!) : [];
  const armAt = header.indexOf('arm');
  const reviewerAt = header.indexOf('reviewer');
  if (armAt < 0 || reviewerAt < 0) throw new Error('the table has no arm or reviewer column');
  const tally = new Map<string, AuditScore>();
  const add = (arm: string, verdict: 'agree' | 'disagree' | null) => {
    const t = tally.get(arm) ?? { arm, rows: 0, filled: 0, agree: 0, disagree: 0, agreement: null };
    t.rows += 1;
    if (verdict) { t.filled += 1; t[verdict] += 1; }
    t.agreement = t.filled ? t.agree / t.filled : null;
    tally.set(arm, t);
  };
  for (const line of lines.slice(2)) {
    const cells = split(line);
    const v = (cells[reviewerAt] ?? '').toLowerCase();
    const verdict = /^(agree|yes|y)$/.test(v) ? 'agree' : /^(disagree|no|n)$/.test(v) ? 'disagree' : null;
    add(cells[armAt] ?? 'unknown', verdict);
    add('all', verdict);
  }
  return [...tally.values()].sort((a, b) => (a.arm === 'all' ? 1 : b.arm === 'all' ? -1 : a.arm.localeCompare(b.arm)));
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const score = flag('--score');
  if (score) {
    const s = scoreAudit(readFileSync(score, 'utf8'));
    if (argv.includes('--json')) console.log(JSON.stringify(s, null, 1));
    else for (const a of s) console.log(`${a.arm}: ${a.agree} of ${a.filled} filled rows agree${a.agreement === null ? '' : ` (${(a.agreement * 100).toFixed(1)}%)`}, ${a.rows - a.filled} unfilled`);
    process.exit(0);
  }
  const files: string[] = [];
  for (let k = argv.indexOf('--verdicts') + 1; k > 0 && k < argv.length && !argv[k]!.startsWith('--'); k++) files.push(argv[k]!);
  const n = Number(flag('--n') ?? 40);
  const seed = flag('--seed');
  if (!files.length || !seed || !Number.isInteger(n) || n < 1) { console.error('usage: audit-sample.ts --verdicts <files>... --n 40 --seed <s> [--out <table.md>] | --score <table.md> [--json]'); process.exit(2); }
  const table = renderAudit(drawAudit(files.map((file) => ({ file, verdicts: JSON.parse(readFileSync(file, 'utf8')) as Verdicts })), n, seed), seed, n);
  const out = flag('--out');
  if (out) { writeFileSync(out, table); console.log(`wrote ${out}`); } else process.stdout.write(table);
}
