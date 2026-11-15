#!/usr/bin/env bun
/**
 * Stage 2 adjudication tooling for the review-real-bugs eval (docs/benchmarks/2026-11-review-real-bugs/stage2/
 * PREREGISTRATION.md, "Adjudication" and "Stage 1 re-judge"). Keyless: it builds inputs for tool-judge.ts and reads its
 * outputs, and never calls a model.
 *
 *   items        one tool-judge item per unmatched blocking finding of an adjudication key (noloss judge-packet
 *                --adjudicate's key.json and packets), with the unit's clone, merge base, PR text, and for labellers the
 *                later main-branch tip, the fix commits and the known bugs in our words (a decoy's stand-in over-blocking
 *                blocker is not a known bug, and a missing catalog case is refused). Writes <out>/items.jsonl and
 *                <out>/items-key.json; the key (arm, pass, finding) never goes into an item, so the judges stay blind.
 *   sample       a seeded draw of n items: items ordered by sha256("<seed>:<item>"), the first n kept.
 *   score        from tool-judge rulings: per role and model the outcomes, rulings, can't-tell rate, tool calls, cost and
 *                tokens per read (cost, tokens and tool calls include failed reads that were read again); labeller agreement and kappa; the agreed labels; each judge against the labels (can't
 *                tell counted as a disagreement, and apart); the two judges against each other; and the R78 check.
 *   adjudication the primary judge's rulings as noloss adjudication.tsv files, one per arm, with can't-tell (and any read
 *                that ended without a ruling) mapped to defect or to not-defect, so the guards can be scored both ways. It
 *                refuses to write while any finding has no usable read (never read, or failed for a machine or network
 *                reason), so read those again and pass every --rulings file.
 *
 *   A failed read gives way to a later read of the same item; two usable reads of one item are refused, because no rerun
 *   may change a verdict.
 *
 *   bun scripts/review-bugs/rejudge.ts items --key <key.json> --packets <dir> --suite <suite.json> --catalog <dir>
 *       --pr-context <dir> --clone <owner/repo>=<git dir>... --out <dir>
 *   bun scripts/review-bugs/rejudge.ts sample --items <items.jsonl> --n 20 --seed 2665 --out <items.jsonl>
 *   bun scripts/review-bugs/rejudge.ts score --rulings <rulings.jsonl>... --primary <provider:model> --second <provider:model>
 *       [--usage <usage.ndjson>...] [--min-agreed 60] [--min-kappa 0.6] [--json]
 *   bun scripts/review-bugs/rejudge.ts adjudication --rulings <rulings.jsonl>... --items-key <items-key.json>
 *       --judge <provider:model> --cant-tell defect|not-defect --batch <batch sha256> --out <dir>
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JudgeItem } from './tool-judge.ts';

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const unitDir = (unit: string) => unit.replace(/[/#@]/g, '_');

export interface KeyEntry { packet: string; opaque: string; arm: string; pass: number; finding: string }
/** pr is the packet stem, noloss's pr id: the PR number, or number@head12 where two units share a number. */
export interface ItemKey { item: string; packet: string; opaque: string; arm: string; pass: number; finding: string; unit: string; pr: string; stratum: string | null }

export const itemId = (packet: string, opaque: string) => packet.replace(/^.*\//, '').replace(/\.json$/, '') + '-' + opaque;

function git(gitDir: string, ...args: string[]): string {
  const r = spawnSync('git', ['--git-dir', gitDir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' in ' + gitDir + ' failed: ' + (r.stderr ?? '').trim().split('\n')[0]);
  return r.stdout.trim();
}

export function buildItems(o: { key: any; packetsDir: string; suite: any; catalogDir: string; prContext: string; clones: Map<string, string> }): { items: JudgeItem[]; keys: ItemKey[] } {
  const units = new Map<string, any>((o.suite.units as any[]).map((u) => [u.id, u]));
  const packets = new Map<string, any>();
  for (const p of o.key.packets as Array<{ file: string; unit: string; sha256: string }>) {
    const text = readFileSync(join(o.packetsDir, p.file), 'utf8');
    if (sha256(text) !== p.sha256) throw new Error(p.file + ' does not match the key sha256');
    packets.set(p.file, { ...JSON.parse(text), unit_id: p.unit });
  }
  const items: JudgeItem[] = [], keys: ItemKey[] = [];
  const unitCache = new Map<string, { merge_base: string; tip: string; pr_text: string; fixes: string[]; bugs: string[] }>();
  for (const e of o.key.entries as KeyEntry[]) {
    const pk = packets.get(e.packet);
    if (!pk) throw new Error('key entry names packet ' + e.packet + ', which the key does not list');
    const f = (pk.findings as any[]).find((x) => x.id === e.opaque);
    if (!f) throw new Error(e.packet + ' has no finding ' + e.opaque);
    const u = units.get(pk.unit_id);
    if (!u) throw new Error('the suite has no unit ' + pk.unit_id);
    const gitDir = o.clones.get(u.repo);
    if (!gitDir) throw new Error('no --clone for ' + u.repo);
    if (!unitCache.has(u.id)) {
      const prFile = join(o.prContext, unitDir(u.id), 'pr.md');
      if (!existsSync(prFile)) throw new Error('no pr.md for ' + u.id + ' at ' + prFile);
      const cases = ((u.blockers ?? []) as any[]).filter((b) => b.counts !== 'over-blocking').map((b) => b.case).filter(Boolean).map((c: string) => {
        const file = join(o.catalogDir, c + '.json');
        if (!existsSync(file)) throw new Error('no catalog case ' + c + ' for ' + u.id + ' at ' + file);
        return JSON.parse(readFileSync(file, 'utf8'));
      });
      const fixes = [...new Set(cases.map((c: any) => c.fix?.commit).filter((x: unknown): x is string => typeof x === 'string'))];
      for (const fx of fixes) git(gitDir, 'cat-file', '-e', fx + '^{commit}');
      unitCache.set(u.id, { merge_base: git(gitDir, 'merge-base', u.head, u.base), tip: git(gitDir, 'rev-parse', 'HEAD'), pr_text: readFileSync(prFile, 'utf8'), fixes,
        bugs: cases.map((c: any) => (c.defect?.file ? c.defect.file + (c.defect.line ? ':' + c.defect.line : '') + ': ' : '') + String(c.defect?.summary ?? '')).filter((s: string) => s.trim()) });
    }
    const uc = unitCache.get(u.id)!;
    const item = itemId(e.packet, e.opaque);
    items.push({ item, unit: u.id, git_dir: gitDir, head: u.head, merge_base: uc.merge_base, pr_text: uc.pr_text,
      finding: { path: f.path ?? null, line: Number.isInteger(f.line) ? f.line : null, text: String(f.text) }, known_informational: pk.known_informational ?? [],
      later: { tip: uc.tip, fixes: uc.fixes, bugs: uc.bugs } });
    keys.push({ item, packet: e.packet, opaque: e.opaque, arm: e.arm, pass: e.pass, finding: e.finding, unit: u.id, pr: e.packet.replace(/^.*\//, '').replace(/\.json$/, ''), stratum: u.stratum ?? null });
  }
  return { items, keys };
}

export function sample<T extends { item: string }>(items: T[], n: number, seed: number): T[] {
  return [...items].map((it) => [sha256(seed + ':' + it.item), it] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, n).map(([, it]) => it);
}

// ---- scoring --------------------------------------------------------------------------------------------------------

export interface RulingRow { item: string; role: 'judge' | 'labeller'; judge: string; outcome: string; ruling: string | null; tool_calls: number; usage: { input: number; cached: number; cache_write?: number; output: number }; usd: number | null; key?: string }

export function kappa(a: string[], b: string[]): number | null {
  const n = a.length;
  if (!n) return null;
  const cats = [...new Set([...a, ...b])];
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = cats.reduce((s, c) => s + (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n), 0);
  return pe === 1 ? null : (po - pe) / (1 - pe);
}

const CANT = 'cant-tell';

export function readsOf(rows: RulingRow[], role: string, judge: string): Map<string, RulingRow> {
  const m = new Map<string, RulingRow>();
  for (const r of rows.filter((x) => x.role === role && x.judge === judge)) {
    const had = m.get(r.item);
    if (had && had.outcome !== 'failed' && r.outcome !== 'failed') throw new Error('two usable ' + role + ' reads by ' + judge + ' of ' + r.item + '; no rerun may change a verdict');
    if (!had || had.outcome === 'failed') m.set(r.item, r);
  }
  return m;
}
const r4 = (x: number | null) => (x === null ? null : Math.round(x * 10000) / 10000);

export function score(rows: RulingRow[], primary: string, second: string, minAgreed = 60, minKappa = 0.6) {
  const by = (role: string, judge: string) => readsOf(rows, role, judge);
  const items = [...new Set(rows.map((r) => r.item))].sort();
  const reads: Record<string, unknown> = {};
  for (const role of ['judge', 'labeller']) for (const judge of [primary, second]) {
    const rs = [...by(role, judge).values()];
    if (!rs.length) continue;
    const all = rows.filter((r) => r.role === role && r.judge === judge);
    const ruled = rs.filter((r) => r.ruling);
    const count = (k: (r: RulingRow) => string) => rs.reduce((m, r) => ({ ...m, [k(r)]: (m[k(r)] ?? 0) + 1 }), {} as Record<string, number>);
    const mean = (k: (r: RulingRow) => number) => r4(all.reduce((s, r) => s + k(r), 0) / rs.length);
    reads[role + ' ' + judge] = { reads: rs.length, replaced_failed_reads: all.length - rs.length, outcomes: count((r) => r.outcome), rulings: count((r) => r.ruling ?? '(none)'),
      cant_tell_rate: r4(ruled.length ? ruled.filter((r) => r.ruling === CANT).length / ruled.length : null), cant_tell_or_unruled_rate: r4(rs.filter((r) => r.ruling === CANT || !r.ruling).length / rs.length),
      usd_total: r4(all.reduce((s, r) => s + Number(r.usd ?? 0), 0)), usd_per_read: mean((r) => Number(r.usd ?? 0)), tool_calls_per_read: mean((r) => r.tool_calls),
      tokens_per_read: { input: mean((r) => r.usage.input), cached: mean((r) => r.usage.cached), output: mean((r) => r.usage.output) },
      cache_read_share: r4(all.reduce((s, r) => s + r.usage.cached, 0) / Math.max(1, all.reduce((s, r) => s + r.usage.input, 0))) };
  }
  const la = by('labeller', primary), lb = by('labeller', second);
  const both = items.filter((i) => la.get(i)?.ruling && lb.get(i)?.ruling);
  const decided = both.filter((i) => la.get(i)!.ruling !== CANT && lb.get(i)!.ruling !== CANT);
  const labels = new Map(decided.filter((i) => la.get(i)!.ruling === lb.get(i)!.ruling).map((i) => [i, la.get(i)!.ruling!]));
  const labRows = [...la.values(), ...lb.values()];
  const labellers = { items: items.length, both_ruled: both.length,
    unsure_rate: r4(labRows.length ? labRows.filter((r) => r.ruling === CANT || !r.ruling).length / labRows.length : null),
    unsure_rate_by_labeller: { [primary]: r4(la.size ? [...la.values()].filter((r) => r.ruling === CANT || !r.ruling).length / la.size : null), [second]: r4(lb.size ? [...lb.values()].filter((r) => r.ruling === CANT || !r.ruling).length / lb.size : null) },
    raw_agreement_all: r4(both.length ? both.filter((i) => la.get(i)!.ruling === lb.get(i)!.ruling).length / both.length : null),
    kappa_all: r4(kappa(both.map((i) => la.get(i)!.ruling!), both.map((i) => lb.get(i)!.ruling!))),
    kappa_decided: r4(kappa(decided.map((i) => la.get(i)!.ruling!), decided.map((i) => lb.get(i)!.ruling!))),
    agreed_labels: labels.size, label_counts: [...labels.values()].reduce((m, v) => ({ ...m, [v]: (m[v] ?? 0) + 1 }), {} as Record<string, number>), dropped: items.length - labels.size };
  const vsLabels = (judge: string) => {
    const j = by('judge', judge);
    const its = [...labels.keys()].filter((i) => j.has(i) && j.get(i)!.outcome !== 'failed');
    const ruling = (i: string) => j.get(i)!.ruling ?? CANT;
    const exCant = its.filter((i) => j.get(i)!.ruling && j.get(i)!.ruling !== CANT);
    return { n: its.length, raw_agreement: r4(its.length ? its.filter((i) => ruling(i) === labels.get(i)).length / its.length : null),
      kappa: r4(kappa(its.map(ruling), its.map((i) => labels.get(i)!))), judge_cant_tell: its.filter((i) => j.get(i)!.ruling === CANT).length,
      judge_unruled: its.filter((i) => !j.get(i)!.ruling).length, not_read: labels.size - its.length,
      kappa_without_cant_tell: r4(kappa(exCant.map((i) => j.get(i)!.ruling!), exCant.map((i) => labels.get(i)!))) };
  };
  const jp = by('judge', primary), js = by('judge', second);
  const jboth = items.filter((i) => jp.get(i)?.ruling && js.get(i)?.ruling);
  const primaryCheck = vsLabels(primary);
  return { reads, labellers, judge_vs_labels: { [primary]: primaryCheck, [second]: vsLabels(second) },
    judges: { both_ruled: jboth.length, kappa: r4(kappa(jboth.map((i) => jp.get(i)!.ruling!), jboth.map((i) => js.get(i)!.ruling!))) },
    r78: { rule: 'primary judge against agreed labels, can\'t-tell and a read with no ruling counted as a disagreement, every agreed item read: kappa >= ' + minKappa + ' on >= ' + minAgreed + ' items', n: primaryCheck.n, not_read: primaryCheck.not_read, kappa: primaryCheck.kappa,
      pass: primaryCheck.n >= minAgreed && primaryCheck.not_read === 0 && primaryCheck.kappa !== null && primaryCheck.kappa >= minKappa },
    labels: Object.fromEntries(labels) };
}

export function adjudicationTsv(rows: RulingRow[], keys: ItemKey[], judge: string, cantTell: 'defect' | 'not-defect', batch: string): Map<string, string> {
  const ruled = readsOf(rows, 'judge', judge);
  const missing = keys.filter((k) => ruled.get(k.item)?.outcome === undefined || ruled.get(k.item)!.outcome === 'failed').map((k) => k.item);
  if (missing.length) throw new Error(missing.length + ' item(s) have no usable read by ' + judge + ' (not read, or failed): ' + missing.join(', ') + '; read them again and pass every --rulings file');
  const head = ['pr', 'finding', 'pass', 'ruling', 'judge', 'saw_label', 'version', 'batch', 'note'].join('\t');
  const out = new Map<string, string[]>();
  for (const k of keys) {
    const r = ruled.get(k.item);
    const raw = r?.ruling ?? null;
    const ruling = raw === null || raw === CANT ? cantTell : raw;
    const note = raw === null ? 'no ruling (' + r!.outcome + '), counted as ' + cantTell : raw === CANT ? 'cant-tell, counted as ' + cantTell : '';
    out.set(k.arm, [...(out.get(k.arm) ?? []), [String(k.pr), k.finding, String(k.pass), ruling, judge.replace(':', '/'), 'no', '1', batch, note].join('\t')]);
  }
  return new Map([...out].map(([arm, lines]) => [arm, [head, ...lines].join('\n') + '\n']));
}

// ---- CLI ------------------------------------------------------------------------------------------------------------

const readJsonl = <T>(file: string): T[] => readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  const f = new Map<string, string[]>();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') { f.set(a, ['true']); continue; }
    const v = argv[++i];
    if (!a.startsWith('--') || v === undefined) throw new Error('bad argument ' + JSON.stringify(a));
    f.set(a, [...(f.get(a) ?? []), v]);
  }
  const one = (k: string) => f.get(k)?.[0] ?? (() => { throw new Error('rejudge ' + cmd + ' needs ' + k); })();
  if (cmd === 'items') {
    const clones = new Map((f.get('--clone') ?? []).map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)] as const));
    const { items, keys } = buildItems({ key: JSON.parse(readFileSync(one('--key'), 'utf8')), packetsDir: one('--packets'), suite: JSON.parse(readFileSync(one('--suite'), 'utf8')), catalogDir: one('--catalog'), prContext: one('--pr-context'), clones });
    mkdirSync(one('--out'), { recursive: true });
    writeFileSync(join(one('--out'), 'items.jsonl'), items.map((i) => JSON.stringify(i)).join('\n') + '\n');
    writeFileSync(join(one('--out'), 'items-key.json'), JSON.stringify(keys, null, 2) + '\n');
    console.log(items.length + ' items from ' + new Set(items.map((i) => i.unit)).size + ' units');
    return 0;
  }
  if (cmd === 'sample') {
    const picked = sample(readJsonl<JudgeItem>(one('--items')), Number(one('--n')), Number(one('--seed')));
    writeFileSync(one('--out'), picked.map((i) => JSON.stringify(i)).join('\n') + '\n');
    console.log(picked.length + ' items: ' + picked.map((i) => i.item).join(', '));
    return 0;
  }
  if (cmd === 'score') {
    const rows = (f.get('--rulings') ?? []).flatMap((p) => readJsonl<RulingRow>(p));
    const s = score(rows, one('--primary'), one('--second'), Number(f.get('--min-agreed')?.[0] ?? 60), Number(f.get('--min-kappa')?.[0] ?? 0.6));
    console.log(f.has('--json') ? JSON.stringify(s, null, 2) : JSON.stringify({ ...s, labels: Object.keys(s.labels).length + ' labels' }, null, 2));
    return 0;
  }
  if (cmd === 'adjudication') {
    const cant = one('--cant-tell');
    if (cant !== 'defect' && cant !== 'not-defect') throw new Error('--cant-tell takes defect or not-defect');
    const rulings = (f.get('--rulings') ?? [one('--rulings')]).flatMap((p) => readJsonl<RulingRow>(p));
    const files = adjudicationTsv(rulings, JSON.parse(readFileSync(one('--items-key'), 'utf8')), one('--judge'), cant, one('--batch'));
    for (const [arm, text] of files) { mkdirSync(join(one('--out'), arm), { recursive: true }); writeFileSync(join(one('--out'), arm, 'adjudication.tsv'), text); }
    console.log('wrote ' + [...files.keys()].map((a) => a + '/adjudication.tsv').join(', '));
    return 0;
  }
  throw new Error('usage: rejudge.ts items|sample|score|adjudication ... (see the file head)');
}

if (import.meta.main) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { process.stderr.write('rejudge: ' + (e as Error).message + '\n'); process.exit(2); });
