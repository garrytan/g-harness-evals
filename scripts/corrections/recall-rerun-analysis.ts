#!/usr/bin/env bun
// The recall rerun's readings, keyless, exactly as docs/corrections/2026-11-09/recall-rerun-pre-data.md words them:
//
//   bun scripts/corrections/recall-rerun-analysis.ts --rerun <merged results dir> --published <h2h results dir> --out <dir>
//
// 1. Exposure: every gbrain remember whose write_source is a channel source (not private-<member>), and every later
//    search, query or recall by another member whose reply carried that saved text (effect.facts), per cell.
// 2. The three gbrain readings on the rerun alone (12 pairs each): 13-1 lean+MCP-instructions+gbrain minus lean,
//    14-1 lean+gbrain minus lean, 15-5 Claude Code+gbrain minus Claude Code, paired by task and repetition, with the h2h
//    report-extras method (runner/stats/paired.ts clusteredPairedDelta, clustered by task, seed 7, 10,000 draws; a pair where
//    either side ended model_error, infra_error or exam_fault is excluded on both sides).
// 3. The spliced readings: the published 60 pairs (repetitions 1 to 3) with cr-01 to cr-04 replaced by the rerun's pairs for
//    both arms of each reading.
// 4. Each reading against the published value and the ceiling (README section 7's upper bound).
// 5. The note's rule: KEEP (dev, after the recall fix) for an arm only when exposure shows saved facts read back by another
//    member and that arm's spliced 95% interval lies entirely above zero; FIX-METHOD otherwise.
// Writes <out>/analysis.json and <out>/analysis.md.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clusteredPairedDelta } from '../../runner/stats/paired.ts';

const arg = (k: string) => { const i = process.argv.indexOf(k); if (i < 0 || !process.argv[i + 1]) { console.error('recall-rerun-analysis: ' + k + ' is required'); process.exit(2); } return process.argv[i + 1]!; };
const rerunDir = arg('--rerun'), publishedDir = arg('--published'), outDir = arg('--out');
const o = { seed: 7, draws: 10000 };
const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);
const CR = /^cr-0[1-4]-/;
type T = { trial_id: string; cell: string; task: string; grade: string; termination: string; usage?: { usd?: number } };
const load = (d: string): T[] => readFileSync(join(d, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const rerun = load(rerunDir), published = load(publishedDir);
const rep = (t: T) => Number(t.trial_id.split('/').pop()!.slice(1));
const key = (t: T) => t.task + '/r' + rep(t);
const pass = (t: T) => (t.grade === 'pass' ? 1 : 0);
const r1 = (x: number) => Math.round(x * 1000) / 10;

const READINGS = [
  { label: '13-1', name: 'lean + MCP instructions + gbrain minus lean', base: 'zero-lean-opus-none-mu-v03-dev2', pub: 'zero-lean-mcp-instructions-opus-gbrain-mu-v03-dev2', conv: 'zero-lean-mcp-instructions-opus-gbrain-conv-mu-v03-dev2', published: 0.05, ceiling: 0.2 },
  { label: '14-1', name: 'lean + gbrain minus lean', base: 'zero-lean-opus-none-mu-v03-dev2', pub: 'zero-lean-opus-gbrain-mu-v03-dev2', conv: 'zero-lean-opus-gbrain-conv-mu-v03-dev2', published: 0.0167, ceiling: 0.1667 },
  { label: '15-5', name: 'Claude Code + gbrain minus Claude Code', base: 'claude-code-opus-none-mu-v03-dev2', pub: 'claude-code-opus-gbrain-mu-v03-dev2', conv: 'claude-code-opus-gbrain-conv-mu-v03-dev2', published: 0.0333, ceiling: 0.1 },
];

function side(rows: T[], cell: string, keep: (t: T) => boolean) {
  const m = new Map<string, T>();
  for (const t of rows) {
    if (t.cell !== cell || rep(t) > 3 || !keep(t)) continue;
    if (m.has(key(t))) throw new Error('recall-rerun-analysis: duplicate trial ' + cell + ' ' + key(t));
    m.set(key(t), t);
  }
  return m;
}
function paired(A: Map<string, T>, B: Map<string, T>) {
  const excluded: Array<{ id: string; reason: string }> = [];
  const pairs: Array<{ id: string; cluster: string; a: number; b: number }> = [];
  for (const id of [...new Set([...A.keys(), ...B.keys()])].sort()) {
    const ta = A.get(id), tb = B.get(id);
    if (!ta || !tb) { excluded.push({ id, reason: 'missing in ' + (ta ? 'B' : 'A') }); continue; }
    const bad = [ta, tb].find((t) => EXCLUDED.has(t.termination));
    if (bad) { excluded.push({ id, reason: bad.termination + ' in ' + bad.cell }); continue; }
    pairs.push({ id, cluster: ta.task, a: pass(ta), b: pass(tb) });
  }
  const d = clusteredPairedDelta(pairs, o);
  return { pairs: pairs.length, tasks: d.n_clusters, pass_a: d.mean_a, pass_b: d.mean_b, delta: d.delta, ci95: d.ci95, p: d.p_two_sided, p_method: d.p_method, excluded };
}
const merge = (x: Map<string, T>, y: Map<string, T>) => new Map([...x, ...y]);

// 1. Exposure
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
type Ev = { seq: number; via: string; tool: string; grant?: string; outcome: string; args?: any; write_source?: string; effect?: { facts?: Array<{ fact: string; source_id?: string }> } };
const exposure: Record<string, any> = {};
for (const r of READINGS) {
  const cellDir = join(rerunDir, 'trials', r.conv);
  const per = { trials: 0, remembers: 0, remembers_ok: 0, channel_remembers: 0, private_remembers: 0, remembers_no_write_source: 0, channel_remembers_read_by_other: 0, reads_by_other_returning_channel_save: 0, reads_by_same_member_returning_channel_save: 0, trials_with_cross_member_read: [] as string[], examples: [] as any[] };
  if (existsSync(cellDir)) for (const task of readdirSync(cellDir).sort()) for (const rr of readdirSync(join(cellDir, task)).sort()) {
    const f = join(cellDir, task, rr, 'events.jsonl');
    if (!existsSync(f)) continue;
    per.trials++;
    const evs: Ev[] = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e: Ev) => e.via === 'gbrain');
    const saves = evs.filter((e) => e.tool === 'gbrain.remember');
    per.remembers += saves.length;
    const channelSaves = [];
    for (const s of saves) {
      if (s.outcome === 'ok') per.remembers_ok++;
      if (!s.write_source) per.remembers_no_write_source++;
      else if (s.write_source.startsWith('private-')) per.private_remembers++;
      else if (s.outcome === 'ok') { per.channel_remembers++; channelSaves.push(s); }
    }
    let crossHere = false;
    for (const s of channelSaves) {
      const text = norm(String(s.args?.fact ?? ''));
      if (!text) continue;
      let readByOther = false;
      for (const e of evs) {
        if (e.seq <= s.seq || !/^gbrain\.(search|query|recall)$/.test(e.tool) || e.outcome !== 'ok') continue;
        const hit = (e.effect?.facts ?? []).some((x) => { const t = norm(x.fact); return t === text || t.includes(text) || (t.length > 20 && text.includes(t)); });
        if (!hit) continue;
        if (e.grant && e.grant !== s.grant && e.grant !== 'public-only' && e.grant !== 'bot') {
          per.reads_by_other_returning_channel_save++; readByOther = true;
          if (per.examples.length < 3) per.examples.push({ trial: task + '/' + rr, saved_by: s.grant, write_source: s.write_source, read_by: e.grant, tool: e.tool, fact: s.args?.fact });
        } else if (e.grant === s.grant) per.reads_by_same_member_returning_channel_save++;
      }
      if (readByOther) { per.channel_remembers_read_by_other++; crossHere = true; }
    }
    if (crossHere) per.trials_with_cross_member_read.push(task + '/' + rr);
  }
  exposure[r.conv] = per;
}
const exposed = Object.values(exposure).some((e: any) => e.reads_by_other_returning_channel_save > 0);

// 2-5. Readings
const readings = READINGS.map((r) => {
  const own = paired(side(rerun, r.base, () => true), side(rerun, r.conv, () => true));
  const notCr = (t: T) => !CR.test(t.task);
  const pubOnly = paired(side(published, r.base, () => true), side(published, r.pub, () => true));
  const pubCr = paired(side(published, r.base, (t) => CR.test(t.task)), side(published, r.pub, (t) => CR.test(t.task)));
  const spliced = paired(merge(side(published, r.base, notCr), side(rerun, r.base, () => true)), merge(side(published, r.pub, notCr), side(rerun, r.conv, () => true)));
  const armExposed = exposure[r.conv].reads_by_other_returning_channel_save > 0;
  const above = !!spliced.ci95 && spliced.ci95[0] > 0;
  const gain = spliced.delta - pubOnly.delta;
  return {
    label: r.label, name: r.name, a: r.base, b_published: r.pub, b_rerun: r.conv,
    published_note: r.published, ceiling: r.ceiling,
    published_recomputed: pubOnly, published_cr_only: pubCr, rerun_12_pairs: own, spliced,
    spliced_minus_published: gain, ceiling_headroom: r.ceiling - pubOnly.delta,
    share_of_ceiling_gap_recovered: (r.ceiling - pubOnly.delta) > 0 ? gain / (r.ceiling - pubOnly.delta) : null,
    rule: { exposure_any_arm: exposed, exposure_this_arm: armExposed, spliced_ci_entirely_above_zero: above, verdict: exposed && above ? 'KEEP (dev, after the recall fix)' : 'FIX-METHOD (dev) stands' },
  };
});

const cells: Record<string, any> = {};
for (const t of rerun) { const c = cells[t.cell] ??= { trials: 0, pass: 0, usd: 0, terminations: {} as Record<string, number> }; c.trials++; c.pass += pass(t); c.usd += t.usage?.usd ?? 0; c.terminations[t.termination] = (c.terminations[t.termination] ?? 0) + 1; }
const out = { seed: o.seed, draws: o.draws, rerun_trials: rerun.length, cells, exposure, exposure_confirmed: exposed, readings };
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'analysis.json'), JSON.stringify(out, null, 1) + '\n');
const ci = (c: [number, number] | null) => (c ? '[' + r1(c[0]) + ', ' + r1(c[1]) + ']' : '-');
const md = [
  '# Recall rerun analysis (written by scripts/corrections/recall-rerun-analysis.ts)', '',
  'Seed 7, 10,000 draws, pairs by task and repetition, clustered by task. Exposure confirmed: ' + (exposed ? 'yes' : 'no') + '.', '',
  '## Exposure', '', '| Cell | Trials | Remembers | To a channel source | Private | No write_source | Channel saves read by another member | Reads by another member returning one | Trials with such a read |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...Object.entries(exposure).map(([c, e]: [string, any]) => `| \`${c}\` | ${e.trials} | ${e.remembers} | ${e.channel_remembers} | ${e.private_remembers} | ${e.remembers_no_write_source} | ${e.channel_remembers_read_by_other} | ${e.reads_by_other_returning_channel_save} | ${e.trials_with_cross_member_read.length} |`),
  '', '## Readings (points)', '', '| Reading | Published (60) | Published, cr only (12) | Rerun (12) [95% CI] | Spliced (60) [95% CI] | Spliced minus published | Ceiling | Share of the gap to the ceiling recovered | Verdict |', '|---|---|---|---|---|---:|---:|---:|---|',
  ...readings.map((r) => `| ${r.label} ${r.name} | ${r1(r.published_recomputed.delta)} ${ci(r.published_recomputed.ci95)} | ${r1(r.published_cr_only.delta)} | ${r1(r.rerun_12_pairs.delta)} ${ci(r.rerun_12_pairs.ci95)} (n=${r.rerun_12_pairs.pairs}) | ${r1(r.spliced.delta)} ${ci(r.spliced.ci95)} (n=${r.spliced.pairs}) | ${r1(r.spliced_minus_published)} | ${r1(r.ceiling)} | ${r.share_of_ceiling_gap_recovered === null ? '-' : r1(r.share_of_ceiling_gap_recovered) + '%'} | ${r.rule.verdict} |`),
  '',
].join('\n');
writeFileSync(join(outDir, 'analysis.md'), md);
console.log(md);
