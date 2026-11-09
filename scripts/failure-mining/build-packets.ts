#!/usr/bin/env bun
// Layer-2 packets for the frontier failures, and the codebook and gold samples drawn from them (internal-task, failure mining).
//
//   bun scripts/failure-mining/build-packets.ts [--out-dir ~/.capy/work/harn66/packets]
//
// Selects every corpus/manifest.jsonl row with kind multiuser, a frontier model, a grade other than pass and population
// default, variant or uncounted, and builds its packet with scripts/failure-mining/packet.ts from the folder's layer-1
// taxonomy.json and the task tree layer 1 used (corpus.ts withTaskTree: the run commit's tree when the checkout's has
// moved, extracted for the build and deleted after it). Packets go to <out-dir>/<run>__<results subpath>.jsonl, outside
// the repository, because they carry the turns' text. Into the repository go corpus/packet-index.jsonl, one row per
// selected trial with its packet's sha256 or the reason it has none, and corpus/samples.json.
//
// Samples come from index rows that have a packet and population default or variant. A stratum is layer-1 primary label
// (the label of the first failed predicate that is not by construction) x harness x model. A draw visits the strata in a
// seeded order, round after round, taking the next trial of a seeded shuffle from each stratum that still has one, until
// it reaches its size, so strata get equal counts, give or take one, until they run out. Codebook: 150 trials, seed 2020.
// Gold: 200 trials, seed 2021, from the trials the codebook did not take. Keyless and deterministic: building twice gives
// byte-identical packets, index and samples.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { buildPackets, PACKET_VERSION, type HashedPacket } from './packet.ts';
import { BENCH, OUT, ROOT, withTaskTree, type ResultsDir } from './corpus.ts';
import { TAXONOMY_VERSION, type RunTaxonomy } from '../taxonomy.ts';

const SELECTED_POPULATIONS = ['default', 'variant', 'uncounted'];
const SAMPLE_POPULATIONS = ['default', 'variant'];
const SAMPLES = [{ name: 'codebook', size: 150, seed: 2020 }, { name: 'gold', size: 200, seed: 2021 }];
type Row = Record<string, any>;

const readJsonl = (path: string): Row[] => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** mulberry32: a small seeded generator, so a draw depends on its seed alone. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], next: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

export function stratifiedSample(rows: Array<{ trial_id: string; stratum: string }>, size: number, seed: number): string[] {
  const next = rng(seed);
  const byStratum = new Map<string, string[]>();
  for (const r of [...rows].sort((a, b) => a.trial_id.localeCompare(b.trial_id))) (byStratum.get(r.stratum) ?? byStratum.set(r.stratum, []).get(r.stratum)!).push(r.trial_id);
  const order = shuffle([...byStratum.keys()].sort(), next);
  const queues = new Map(order.map((k) => [k, shuffle(byStratum.get(k)!, next)]));
  const out: string[] = [];
  while (out.length < size && [...queues.values()].some((q) => q.length)) {
    for (const k of order) {
      if (out.length >= size) break;
      const id = queues.get(k)!.shift();
      if (id) out.push(id);
    }
  }
  return out;
}

const countBy = (xs: string[]) => Object.fromEntries([...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => a[0].localeCompare(b[0])));

if (import.meta.main) {
  const i = process.argv.indexOf('--out-dir');
  const outDir = i >= 0 ? process.argv[i + 1]! : join(homedir(), '.capy', 'work', 'harn66', 'packets');
  const manifest = readJsonl(join(ROOT, OUT, 'corpus', 'manifest.jsonl'));
  const runs = JSON.parse(readFileSync(join(ROOT, OUT, 'corpus', 'runs.json'), 'utf8')) as { runs: Record<string, { results: ResultsDir[] }> };
  const dirs = new Map(Object.values(runs.runs).flatMap((r) => r.results).map((d) => [d.results_dir, d]));
  const selected = manifest.filter((m) => m.kind === 'multiuser' && m.frontier && m.grade !== 'pass' && SELECTED_POPULATIONS.includes(m.population));
  if (new Set(selected.map((m) => m.trial_id)).size !== selected.length) throw new Error('duplicate trial ids among the selected rows');
  const groups = new Map<string, Row[]>();
  for (const m of selected) (groups.get(m.results_dir) ?? groups.set(m.results_dir, []).get(m.results_dir)!).push(m);

  mkdirSync(outDir, { recursive: true });
  const index: Row[] = [];
  const allPackets: HashedPacket[] = [];
  for (const resultsDir of [...groups.keys()].sort()) {
    const rows = groups.get(resultsDir)!.sort((a, b) => a.trial_id.localeCompare(b.trial_id));
    const run: string = rows[0]!.run;
    const file = `${run}__${relative(join(BENCH, run), resultsDir).replaceAll('/', '-')}.jsonl`;
    const taxPath = join(ROOT, OUT, 'layer1', relative(BENCH, resultsDir), 'taxonomy.json');
    const tax = JSON.parse(readFileSync(taxPath, 'utf8')) as RunTaxonomy;
    const entries = new Map(tax.trials.map((t) => [t.trial_id, t]));
    const ids = rows.map((r) => r.trial_id as string).filter((id) => entries.has(id) && !entries.get(id)!.failures.some((f) => f.label === 'no_receipts'));
    const { packets, skipped } = ids.length
      ? withTaskTree(dirs.get(resultsDir)!, (tasksRoot) => buildPackets(taxPath, { results: join(ROOT, resultsDir), tasksRoot: join(ROOT, tasksRoot), trials: ids }))
      : { packets: [] as HashedPacket[], skipped: [] as Array<{ trial_id: string; reason: string }> };
    if (packets.length) writeFileSync(join(outDir, file), packets.map((p) => JSON.stringify(p)).join('\n') + '\n');
    allPackets.push(...packets);
    const byId = new Map(packets.map((p) => [p.trial_id, p]));
    for (const r of rows) {
      const e = entries.get(r.trial_id);
      const p = byId.get(r.trial_id);
      const noPacket = p ? null : !e ? `not a failed trial in ${relative(ROOT, taxPath)}` : e.failures.some((f) => f.label === 'no_receipts') ? 'no receipts (layer 1 no_receipts)' : skipped.find((s) => s.trial_id === r.trial_id)?.reason ?? 'not built';
      index.push({
        trial_id: r.trial_id, run, results_dir: resultsDir, population: r.population, harness: r.harness, model: r.model, cell: r.cell, task: r.task,
        gbrain_present: r.gbrain.present, gbrain_in_turn_calls: r.gbrain.in_turn_calls ?? null,
        layer1_labels: [...new Set((e?.failures ?? []).map((f) => f.label))], layer1_primary: e?.failures.find((f) => !f.by_construction)?.label ?? null,
        packet_file: p ? file : null, packet_sha256: p?.packet_sha256 ?? null, approx_tokens: p?.truncation.tokens_after ?? null,
        truncated: p ? p.truncation.dropped_non_bot_seqs.length + p.truncation.dropped_bot_seqs.length > 0 : null,
        ...(noPacket ? { no_packet: noPacket } : {}),
      });
    }
  }
  writeFileSync(join(ROOT, OUT, 'corpus', 'packet-index.jsonl'), index.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const stratum = (r: Row) => `${r.layer1_primary ?? 'none'} | ${r.harness} | ${r.model}`;
  const pool = index.filter((r) => r.packet_sha256 && SAMPLE_POPULATIONS.includes(r.population));
  const byId = new Map(pool.map((r) => [r.trial_id as string, r]));
  const taken = new Set<string>();
  const drawn = SAMPLES.map((s) => {
    const from = pool.filter((r) => !taken.has(r.trial_id));
    const ids = stratifiedSample(from.map((r) => ({ trial_id: r.trial_id, stratum: stratum(r) })), s.size, s.seed);
    for (const id of ids) taken.add(id);
    return { name: s.name, seed: s.seed, size: s.size, drawn: ids.length, pool: from.length, strata_in_pool: new Set(from.map(stratum)).size, strata: countBy(ids.map((id) => stratum(byId.get(id)!))), trial_ids: [...ids].sort() };
  });
  writeFileSync(join(ROOT, OUT, 'corpus', 'samples.json'), JSON.stringify({
    generated_by: 'scripts/failure-mining/build-packets.ts', packet_version: PACKET_VERSION, taxonomy_version: TAXONOMY_VERSION,
    pool: { from: 'corpus/packet-index.jsonl rows with a packet', populations: SAMPLE_POPULATIONS, trials: pool.length, strata: new Set(pool.map(stratum)).size },
    rule: 'stratum = layer-1 primary label (first failed predicate not by construction) x harness x model; strata visited in a seeded order, one trial per stratum per round from a seeded shuffle of the stratum (members sorted by trial id first), until the sample is full; mulberry32 generator; gold drawn after codebook from the trials the codebook did not take',
    samples: drawn,
  }, null, 1) + '\n');

  const tokens = allPackets.map((p) => p.truncation.tokens_after).sort((a, b) => a - b);
  const q = (f: number) => tokens.length ? tokens[Math.min(tokens.length - 1, Math.ceil(f * tokens.length) - 1)] : 0;
  const lines = [`${index.length} selected trials, ${allPackets.length} packets in ${outDir}`];
  for (const p of SELECTED_POPULATIONS) lines.push(`  ${p}: ${index.filter((r) => r.population === p && r.packet_sha256).length} packets of ${index.filter((r) => r.population === p).length}`);
  const missing = countBy(index.filter((r) => r.no_packet).map((r) => r.no_packet));
  if (Object.keys(missing).length) lines.push(`  no packet: ${JSON.stringify(missing)}`);
  lines.push(`tokens: median ${q(0.5)}, p95 ${q(0.95)}, max ${tokens.at(-1) ?? 0}; truncated ${allPackets.filter((p) => p.truncation.dropped_non_bot_seqs.length + p.truncation.dropped_bot_seqs.length > 0).length}; still over the cap ${allPackets.filter((p) => p.truncation.over_cap).length}`);
  for (const s of drawn) lines.push(`${s.name}: ${s.drawn} of ${s.size} from ${s.pool} trials in ${s.strata_in_pool} strata; ${Object.keys(s.strata).length} strata drawn; per-stratum counts ${JSON.stringify(countBy(Object.values(s.strata).map(String)))}`);
  process.stdout.write(lines.join('\n') + '\n');
}
