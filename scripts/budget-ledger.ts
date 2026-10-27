#!/usr/bin/env bun
// Budget ledger page: renders docs/budget-ledger.md from docs/ledger/lane-spend.jsonl, the program's ledger notes
// (one JSON line per lane, copied verbatim from the project drive's harness-eval/ledger/lane-spend.jsonl, the program's ledger notes).
//
//   bun scripts/budget-ledger.ts [--check] [--root <repo>]
//
// Keyless and byte-stable: the same JSONL renders the same page, with no timestamp. Each line gives lane, ledger (the
// lease ledger path or paths as the lane recorded them), committed_usd, date, and optionally trials, requests and note;
// any other field (smoke_usd on one line) is shown in the note column and never summed. The program total is the sum of
// committed_usd over every line, against the $2,000 program cap of docs/methodology.md item 11. A second table lists the
// runs of docs/receipts-manifest.json that no lane line names (run id as `lane`, or results directory inside `ledger`)
// with the committed spend read from their SQLite ledgers, and a combined total adds them to the lane total. The changelog at the
// bottom is kept in CHANGELOG below: add an entry when the page's shape changes. --check exits 1 when the committed page
// differs from the render.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

export const SOURCE_FILE = 'docs/ledger/lane-spend.jsonl';
export const MANIFEST_FILE = 'docs/receipts-manifest.json';
export const OUTPUT_FILE = 'docs/budget-ledger.md';
export const PROGRAM_CAP_USD = 2000;

export interface LaneLine { lane: string; ledger: string; committed_usd: number; date: string; trials?: number; requests?: number; note?: string; [extra: string]: unknown }

const KNOWN = new Set(['lane', 'ledger', 'committed_usd', 'date', 'trials', 'requests', 'note']);

const CHANGELOG: Array<{ date: string; title: string; text: string }> = [
  { date: '2026-10-26', title: 'first version (internal-task)', text: 'harness-evals v0.0.12. The lane table rendered from `docs/ledger/lane-spend.jsonl` by `scripts/budget-ledger.ts`, the run ledgers the lane ledger does not yet name (from `docs/receipts-manifest.json`), the lane-only and combined totals against the $2,000 cap, and the pointer to what the provider-side check has and has not shown.' },
];

export interface ManifestRun { directory: string; run_id: string | null; report: string | null; trials: number; ledgers: Array<{ ledger_committed_usd: number | string }> }
export interface UnlistedRun { run_id: string; directory: string; report: string | null; trials: number; committed_usd: number; unreadable_ledgers: number }

/** Runs of the receipts manifest that no lane line names, by run id in `lane` or by results directory in `ledger`. */
export function unlistedRuns(runs: ManifestRun[], lanes: LaneLine[]): UnlistedRun[] {
  const out: UnlistedRun[] = [];
  for (const r of runs) {
    if (!r.run_id) continue;
    const named = lanes.some((l) => l.lane === r.run_id || l.ledger.includes(r.directory));
    if (named) continue;
    const spend = r.ledgers.map((l) => l.ledger_committed_usd).filter((x): x is number => typeof x === 'number');
    out.push({ run_id: r.run_id, directory: r.directory, report: r.report, trials: r.trials, committed_usd: Number(spend.reduce((s, x) => s + x, 0).toFixed(6)), unreadable_ledgers: r.ledgers.length - spend.length });
  }
  return out;
}

export function parseLanes(text: string): LaneLine[] {
  const out: LaneLine[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch (e) { throw new Error(`${SOURCE_FILE} line ${i + 1}: not JSON (${e instanceof Error ? e.message : String(e)})`); }
    const l = parsed as Partial<LaneLine>;
    if (typeof l.lane !== 'string' || typeof l.ledger !== 'string' || typeof l.committed_usd !== 'number' || typeof l.date !== 'string') {
      throw new Error(`${SOURCE_FILE} line ${i + 1}: needs string lane, string ledger, number committed_usd and string date`);
    }
    out.push(l as LaneLine);
  });
  return out;
}

/** Dollars as recorded: at least two decimals, more when the line carries them, never a rounding of its own. */
export const usd = (x: number) => { const s = String(x); const dec = s.includes('.') ? s.length - s.indexOf('.') - 1 : 0; const d = Math.max(2, Math.min(dec, 10)); return '$' + x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); };
const text = (s: string) => s.replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, ' ');
const code = (s: string) => '`' + s.replace(/`/g, "'").replace(/\|/g, '\\|').replace(/\r?\n/g, ' ') + '`';
const count = (n: number | undefined) => (n === undefined ? 'not recorded' : String(n));

export function renderPage(lanes: LaneLine[], unlisted: UnlistedRun[]): string {
  const total = lanes.reduce((s, l) => s + l.committed_usd, 0);
  const unlistedTotal = unlisted.reduce((s, r) => s + r.committed_usd, 0);
  const unlistedRows = unlisted.map((r) => `| ${code(r.run_id)} | [${r.directory}](../${r.directory}/) | ${usd(r.committed_usd)}${r.unreadable_ledgers ? ` (${r.unreadable_ledgers} ledger(s) unreadable, not summed)` : ''} | ${r.trials} | ${r.report ? `[report](../${r.report})` : 'no report'} |`);
  const unlistedTable = unlisted.length
    ? `| Run | Directory | Committed USD (sum over its ledgers) | Trials | Report |\n|---|---|---|---|---|\n${unlistedRows.join('\n')}`
    : 'Every run in the manifest is named by a lane line.';
  const rows = lanes.map((l) => {
    const extras = Object.keys(l).filter((k) => !KNOWN.has(k)).map((k) => `${k}: ${JSON.stringify(l[k])} (not in the total)`);
    const note = [l.note ?? '', ...extras].filter(Boolean).join('; ');
    return `| ${l.date} | ${code(l.lane)} | ${usd(l.committed_usd)} | ${count(l.trials)} | ${count(l.requests)} | ${code(l.ledger)} | ${text(note)} |`;
  });
  const trials = lanes.reduce((s, l) => s + (l.trials ?? 0), 0);
  const requests = lanes.reduce((s, l) => s + (l.requests ?? 0), 0);
  const changelog = CHANGELOG.map((c) => `### ${c.date}: ${c.title}\n\n${c.text}`).join('\n\n');
  return `# Budget ledger

harness-evals v0.0.12. This page is the program's spend ledger: one row per lane of paid work, in the order the lanes reported, rendered from [${SOURCE_FILE}](ledger/lane-spend.jsonl) (a verbatim copy of the program's drive ledger notes, \`harness-eval/ledger/lane-spend.jsonl\` in the project drive). Every dollar here is the metering proxy's list-price meter, reserved before each request left and settled to the provider's usage in a SQLite lease ledger (\`runner/ledger/budget-ledger.ts\`); "committed" is settled spend plus any reservation a machine restart left open, so a lane can only overstate what it spent. The provider-side check, the proxy's priced usage against the provider's own usage report for the key, has never been performed: it needs an Admin API key no run has had, and until then every run's \`spend-reconciliation.json\` says so ([docs/methodology.md](methodology.md), item 3 as amended on 2026-10-24; [README.md](../README.md), "Known limits"). The ledger files a row names are hashed per run in [docs/receipts-manifest.json](receipts-manifest.json), with the committed spend read back from each file.

Regenerate this page with \`bun scripts/budget-ledger.ts\` after appending a line to \`${SOURCE_FILE}\`; \`bun scripts/budget-ledger.ts --check\` exits non-zero when the page and the JSONL disagree. The render is byte-stable and carries no timestamp.

## Lanes

| Date | Lane | Committed USD | Trials | Requests | Ledger | Note |
|---|---|---|---|---|---|---|
${rows.join('\n')}

"Not recorded" means the line carries no such field; the counts are the lane's own and the totals below add only what was recorded.

## Run ledgers not yet in the lane ledger

The lane ledger above is the drive record copied verbatim; this table is what the committed SQLite ledgers add: every run in [${MANIFEST_FILE}](receipts-manifest.json) whose run id is no lane line's \`lane\` and whose results directory appears in no lane line's \`ledger\` text, with the sum of \`ledger_committed_usd\` over its ledger files as the manifest read them.

${unlistedTable}

## Program total

Lane ledger only: ${lanes.length} lanes, ${usd(Number(total.toFixed(6)))} committed (the sum of \`committed_usd\` over every line, to six decimals), ${trials.toLocaleString('en-US')} recorded trials and ${requests.toLocaleString('en-US')} recorded requests, against the $${PROGRAM_CAP_USD.toLocaleString('en-US')} program cap set on 2026-10-22 ([docs/methodology.md](methodology.md), item 11); ${usd(Number((PROGRAM_CAP_USD - total).toFixed(2)))} of the cap remains.

Combined: ${usd(Number((total + unlistedTotal).toFixed(6)))} committed, the lane total plus the ${unlisted.length} run ledger row(s) above (${usd(unlistedTotal)}), against the same $${PROGRAM_CAP_USD.toLocaleString('en-US')} cap; ${usd(Number((PROGRAM_CAP_USD - total - unlistedTotal).toFixed(2)))} remains.

Uncounted smokes, scratch leases and infrastructure outside the paid-call lane (Ubicloud VM time) appear only where a line's note names them.

## Changelog

${changelog}
`;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };
  const root = resolve(flag('root') ?? resolve(import.meta.dir, '..'));
  const source = resolve(root, SOURCE_FILE);
  const out = resolve(root, OUTPUT_FILE);
  if (!existsSync(source)) { console.error(`budget-ledger: ${SOURCE_FILE} is missing`); process.exit(2); }
  const manifestPath = resolve(root, MANIFEST_FILE);
  if (!existsSync(manifestPath)) { console.error(`budget-ledger: ${MANIFEST_FILE} is missing; run bun scripts/receipts-manifest.ts first`); process.exit(2); }
  const lanes = parseLanes(readFileSync(source, 'utf8'));
  const page = renderPage(lanes, unlistedRuns((JSON.parse(readFileSync(manifestPath, 'utf8')) as { runs: ManifestRun[] }).runs, lanes));
  if (argv.includes('--check')) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== page) { console.error(`budget-ledger: ${relative(root, out)} differs from ${SOURCE_FILE}; run bun scripts/budget-ledger.ts`); process.exit(1); }
    console.log(`budget-ledger: ${relative(root, out)} matches`);
  } else {
    writeFileSync(out, page);
    console.log(`budget-ledger: wrote ${relative(root, out)}`);
  }
}
