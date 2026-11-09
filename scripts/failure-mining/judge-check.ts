#!/usr/bin/env bun
// Judge check for the layer-2 labeller (internal-task, failure mining; R78): how well a candidate labeller agrees with gold.
//
//   bun scripts/failure-mining/judge-check.ts --gold-a <labels.jsonl> --gold-b <labels.jsonl> --candidate <labels.jsonl>
//       [--retest-a <labels.jsonl> --retest-b <labels.jsonl>] [--codebook <codebook.json>] [--samples <samples.json>]
//       [--out <judge-check.json>]
//
// Each file is a labels.jsonl from label.ts; the latest ok line per trial id counts, failed lines count as unlabelled.
// - Gold labellers' agreement: Cohen's kappa on root_cause between the two gold labellers over the whole gold sample
//   (samples.json "gold" when given, else every trial id either file holds); a missing or failed label on either side
//   counts as a disagreement. The fallback labeller is gated on this kappa (analyze.ts), not on gold.
// - Gold set: the trials where both gold labellers give the same root_cause; that class is the gold label.
// - Candidate vs gold: over every gold trial. A gold trial with no valid candidate label (missing or failed) is scored
//   as class "unlabelled", so it counts as a disagreement. Reported beside the kappa: the labelled n and the coverage
//   (labelled n over gold n). Per class, over the same gold trials: the catch rate (of the gold trials in that class, the
//   share the candidate put in it; an unlabelled one is not caught), the false-assignment rate (of the gold trials in
//   other classes, the share the candidate put in it), and the labelled n and coverage of each denominator.
// - Test-retest: kappa and raw agreement between two runs of one labeller over the trials both runs labelled.
// The R78 gate is reported, never applied here: at least 40 gold trials and a candidate kappa of at least 0.6 with
// unlabelled gold trials scored as disagreements.

import { readFileSync, writeFileSync } from 'node:fs';
import { loadCodebook, readLabels } from './check-labels.ts';

export const GATE = { min_gold: 40, min_kappa: 0.6 } as const;
export const UNLABELLED = 'unlabelled';

/** Cohen's kappa for two label sequences of the same length; null when it is undefined (no items, or chance agreement is 1). */
export function cohensKappa(a: readonly string[], b: readonly string[]): number | null {
  if (a.length !== b.length) throw new Error('kappa needs two sequences of the same length');
  const n = a.length;
  if (!n) return null;
  let agree = 0;
  const ca = new Map<string, number>(), cb = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++;
    ca.set(a[i]!, (ca.get(a[i]!) ?? 0) + 1);
    cb.set(b[i]!, (cb.get(b[i]!) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const [k, x] of ca) pe += (x / n) * ((cb.get(k) ?? 0) / n);
  if (pe === 1) return null;
  return (po - pe) / (1 - pe);
}

/** root_cause by trial id, from the latest ok line per trial. */
export function rootCauses(path: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, l] of readLabels(path).lines) if (l.status === 'ok' && typeof l.root_cause === 'string') out.set(id, l.root_cause);
  return out;
}

export interface Agreement { n: number; agree: number; raw_agreement: number | null; kappa: number | null }

export function agreement(x: Map<string, string>, y: Map<string, string>): Agreement {
  const ids = [...x.keys()].filter((id) => y.has(id)).sort();
  const a = ids.map((id) => x.get(id)!), b = ids.map((id) => y.get(id)!);
  const agree = ids.filter((_, i) => a[i] === b[i]).length;
  return { n: ids.length, agree, raw_agreement: ids.length ? agree / ids.length : null, kappa: cohensKappa(a, b) };
}

/** Agreement over a fixed id set: an id with no valid label on one side gets that side's own missing marker, so it disagrees. */
export function agreementOver(ids: readonly string[], x: Map<string, string>, y: Map<string, string>): Agreement & { x_labelled: number; y_labelled: number } {
  const sorted = [...new Set(ids)].sort();
  const a = sorted.map((id) => x.get(id) ?? '\u0000missing a'), b = sorted.map((id) => y.get(id) ?? '\u0000missing b');
  const agree = sorted.filter((_, i) => a[i] === b[i]).length;
  return { n: sorted.length, agree, raw_agreement: sorted.length ? agree / sorted.length : null, kappa: cohensKappa(a, b), x_labelled: sorted.filter((id) => x.has(id)).length, y_labelled: sorted.filter((id) => y.has(id)).length };
}

export interface ClassRates {
  class: string; gold: number; labelled: number; coverage: number | null; caught: number; catch_rate: number | null;
  others: number; others_labelled: number; others_coverage: number | null; false_assigned: number; false_assignment_rate: number | null;
}

export interface JudgeCheck {
  gold_labellers: { a: string; b: string; sample: 'samples.json gold' | 'ids in either file'; agreement: Agreement & { x_labelled: number; y_labelled: number } };
  gold: { n: number; by_class: Record<string, number> };
  candidate: { file: string; n: number; labelled: number; missing: number; coverage: number | null; agreement: Agreement; per_class: ClassRates[] };
  retest: { a: string; b: string; agreement: Agreement } | null;
  gate: { min_gold: number; min_kappa: number; n_gold_ok: boolean; kappa_ok: boolean; passes: boolean };
}

export function judgeCheck(o: { goldA: string; goldB: string; candidate: string; retestA?: string; retestB?: string; classes?: string[]; sample?: readonly string[] }): JudgeCheck {
  const ga = rootCauses(o.goldA), gb = rootCauses(o.goldB), cand = rootCauses(o.candidate);
  const gold = new Map<string, string>();
  for (const [id, c] of ga) if (gb.get(id) === c) gold.set(id, c);
  const byClass: Record<string, number> = {};
  for (const c of [...gold.values()].sort()) byClass[c] = (byClass[c] ?? 0) + 1;
  const goldIds = [...gold.keys()].sort();
  const said = (id: string) => cand.get(id) ?? UNLABELLED;
  const classes = [...new Set([...(o.classes ?? []), ...gold.values(), ...goldIds.map(said)])].sort();
  const share = (n: number, d: number) => (d ? n / d : null);
  const per_class: ClassRates[] = classes.map((k) => {
    const inK = goldIds.filter((id) => gold.get(id) === k);
    const notK = goldIds.filter((id) => gold.get(id) !== k);
    const caught = inK.filter((id) => said(id) === k).length;
    const falseAssigned = notK.filter((id) => said(id) === k).length;
    const labelled = inK.filter((id) => cand.has(id)).length, othersLabelled = notK.filter((id) => cand.has(id)).length;
    return {
      class: k, gold: inK.length, labelled, coverage: share(labelled, inK.length), caught, catch_rate: share(caught, inK.length),
      others: notK.length, others_labelled: othersLabelled, others_coverage: share(othersLabelled, notK.length), false_assigned: falseAssigned, false_assignment_rate: share(falseAssigned, notK.length),
    };
  });
  const labelled = goldIds.filter((id) => cand.has(id)).length;
  const candAgreement = agreement(new Map(goldIds.map((id) => [id, said(id)])), gold);
  const retest = o.retestA && o.retestB ? { a: o.retestA, b: o.retestB, agreement: agreement(rootCauses(o.retestA), rootCauses(o.retestB)) } : null;
  const nGoldOk = gold.size >= GATE.min_gold;
  const kappaOk = candAgreement.kappa !== null && candAgreement.kappa >= GATE.min_kappa;
  const sample = o.sample ?? [...new Set([...readLabels(o.goldA).lines.keys(), ...readLabels(o.goldB).lines.keys()])];
  return {
    gold_labellers: { a: o.goldA, b: o.goldB, sample: o.sample ? 'samples.json gold' : 'ids in either file', agreement: agreementOver(sample, ga, gb) },
    gold: { n: gold.size, by_class: byClass },
    candidate: { file: o.candidate, n: goldIds.length, labelled, missing: goldIds.length - labelled, coverage: share(labelled, goldIds.length), agreement: candAgreement, per_class },
    retest,
    gate: { ...GATE, n_gold_ok: nGoldOk, kappa_ok: kappaOk, passes: nGoldOk && kappaOk },
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const one = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const goldA = one('gold-a'), goldB = one('gold-b'), candidate = one('candidate');
  const retestA = one('retest-a'), retestB = one('retest-b');
  if (!goldA || !goldB || !candidate || !!retestA !== !!retestB) {
    console.error('usage: bun scripts/failure-mining/judge-check.ts --gold-a <labels.jsonl> --gold-b <labels.jsonl> --candidate <labels.jsonl> [--retest-a <labels.jsonl> --retest-b <labels.jsonl>] [--codebook <codebook.json>] [--samples <samples.json>] [--out <judge-check.json>]');
    process.exit(2);
  }
  const codebook = one('codebook');
  const samples = one('samples');
  const sample = samples ? (JSON.parse(readFileSync(samples, 'utf8')) as { samples: Array<{ name: string; trial_ids: string[] }> }).samples.find((s) => s.name === 'gold')?.trial_ids : undefined;
  if (samples && !sample) { console.error(`${samples} has no gold sample`); process.exit(2); }
  const r = judgeCheck({ goldA, goldB, candidate, retestA, retestB, sample, classes: codebook ? [...loadCodebook(codebook).classes.map((c) => c.id), 'other'] : undefined });
  const out = one('out');
  if (out) writeFileSync(out, JSON.stringify(r, null, 2) + '\n');
  const k = (x: number | null) => (x === null ? 'n/a' : x.toFixed(3));
  console.log(`gold labellers: n ${r.gold_labellers.agreement.n} (labelled ${r.gold_labellers.agreement.x_labelled} and ${r.gold_labellers.agreement.y_labelled}), kappa ${k(r.gold_labellers.agreement.kappa)}; gold set n ${r.gold.n}`);
  console.log(`candidate vs gold: n ${r.candidate.n}, labelled ${r.candidate.labelled} (coverage ${k(r.candidate.coverage)}), agreement ${k(r.candidate.agreement.raw_agreement)}, kappa ${k(r.candidate.agreement.kappa)}`);
  if (r.retest) console.log(`test-retest: n ${r.retest.agreement.n}, agreement ${k(r.retest.agreement.raw_agreement)}, kappa ${k(r.retest.agreement.kappa)}`);
  console.log(`R78 gate (reported, not applied): ${r.gate.passes ? 'passes' : 'does not pass'} (n gold ${r.gold.n} vs ${GATE.min_gold}, kappa ${k(r.candidate.agreement.kappa)} vs ${GATE.min_kappa})${out ? `; written to ${out}` : ''}`);
}
