#!/usr/bin/env bun
/**
 * Scores the third-model labels (R126) for the review-real-bugs judge checks: the known-answer anchors, then each
 * judge against the third model's labels on the items it decided. See third-model-label.ts for how the labels are made.
 *
 *   bun scripts/review-bugs/third-model-score.ts anchors --key <key.json> --labels <labels.jsonl|rulings.jsonl>
 *   bun scripts/review-bugs/third-model-score.ts match --prompts <dir with manifest.json> --items <items.json>
 *       --labels <labels.jsonl> --answers <labeller answers.json> --answers <labeller answers.json> --judge <name>
 *       [--adjudicate-judge <name>]   (names the judge behind the packets' adjudicate-kind items; --judge names the matcher)
 *   bun scripts/review-bugs/third-model-score.ts adjudicate --items <sampled items.jsonl> | --sample <sample.json> --check <name>
 *       --labels <rulings.jsonl>
 *       --rulings <the check's rulings.jsonl> [--primary <judge id>]
 *
 * Kappa is Cohen's (rejudge.ts's kappa) on the items the third model decided; its unsure or cant-tell is an abstention.
 * A judge's cant-tell stays a category of its own, so it counts as a disagreement, as in the published checks; two more
 * readings drop it or count it as defect (the eval's counted reading of a cant-tell ruling). The 95%
 * range is a percentile bootstrap over items (2,000 resamples, seed 20261125). Prints JSON.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kappa } from './rejudge.ts';
import { parseFlags } from './tool-judge.ts';

const ABSTAIN = new Set(['unsure', 'cant-tell']);
const r4 = (x: number | null) => (x === null ? null : Math.round(x * 10000) / 10000);
const jsonl = (f: string) => readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
export function bootKappa(a: string[], b: string[], n = 2000, seed = 20261125): [number, number] | null {
  if (a.length < 2) return null;
  const r = rng(seed), ks: number[] = [];
  for (let i = 0; i < n; i++) {
    const idx = a.map(() => Math.floor(r() * a.length));
    const k = kappa(idx.map((j) => a[j]!), idx.map((j) => b[j]!));
    if (k !== null) ks.push(k);
  }
  ks.sort((x, y) => x - y);
  return ks.length ? [r4(ks[Math.floor(0.025 * ks.length)]!)!, r4(ks[Math.min(ks.length - 1, Math.floor(0.975 * ks.length))]!)!] : null;
}

/** One comparison: reference labels against the third model's decided labels. */
export function compare(ref: Map<string, string>, third: Map<string, string | null>) {
  const ids = [...ref.keys()].filter((i) => third.has(i) && third.get(i) && !ABSTAIN.has(third.get(i)!));
  const a = ids.map((i) => ref.get(i)!), b = ids.map((i) => third.get(i)!);
  const table: Record<string, number> = {};
  ids.forEach((_, i) => { const k = a[i] + ' | ' + b[i]; table[k] = (table[k] ?? 0) + 1; });
  const noCant = ids.filter((i) => ref.get(i) !== 'cant-tell');
  return { n: ids.length, agree: ids.filter((i) => ref.get(i) === third.get(i)).length, kappa: r4(kappa(a, b)), range95: bootKappa(a, b),
    kappa_without_reference_cant_tell: r4(kappa(noCant.map((i) => ref.get(i)!), noCant.map((i) => third.get(i)!))), n_without_reference_cant_tell: noCant.length,
    kappa_reference_cant_tell_as_defect: r4(kappa(a.map((x) => (x === 'cant-tell' ? 'defect' : x)), b)),
    table_reference_vs_third: table };
}

function abstention(ids: string[], third: Map<string, string | null>) {
  const out = { items: ids.length, decided: 0, unsure: 0, no_label: 0 };
  for (const i of ids) { const l = third.get(i); if (!l) out.no_label++; else if (ABSTAIN.has(l)) out.unsure++; else out.decided++; }
  return { ...out, abstain_share: r4((out.unsure + out.no_label) / ids.length) };
}

function agreed(a: Map<string, string | null>, b: Map<string, string | null>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [i, x] of a) if (x && !ABSTAIN.has(x) && x === b.get(i)) m.set(i, x);
  return m;
}

export function score(argv: string[]) {
  const cmd = argv[0];
  const { f, one } = parseFlags(argv.slice(1));
  if (cmd === 'anchors') {
    const key: Array<{ packet?: string; item: string; want: string }> = JSON.parse(readFileSync(one('--key'), 'utf8'));
    const rows = jsonl(one('--labels'));
    const got = new Map<string, string | null>();
    for (const r of rows) {
      if (r.packet) for (const x of r.labels ?? []) got.set(r.packet + '/' + x.item, x.label);
      else got.set(r.item, r.ruling ?? null);
    }
    const res = key.map((k) => ({ ...k, got: got.get(k.packet ? k.packet + '/' + k.item : k.item) ?? null }));
    const byWant: Record<string, { right: number; of: number }> = {};
    for (const r of res) { const w = (byWant[r.want] ??= { right: 0, of: 0 }); w.of++; if (r.got === r.want) w.right++; }
    const right = res.filter((r) => r.got === r.want).length;
    const pass = right >= 18 && Object.values(byWant).every((w) => w.right >= 8);
    return { right, of: res.length, by_side: byWant, pass, bar: 'at least 18 of 20 right and at least 8 of 10 on each side', wrong: res.filter((r) => r.got !== r.want) };
  }
  if (cmd === 'match') {
    const dir = one('--prompts');
    const manifest: Array<{ file: string; unit: string }> = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const where = new Map<string, string>();
    for (const p of manifest) {
      const t = readFileSync(join(dir, p.file), 'utf8');
      for (const m of t.slice(t.lastIndexOf('=== Items to label')).matchAll(/^(I\d+): kind (match|adjudicate)(.*)$/gm)) {
        const key = [p.unit, m[2], m[3]!.match(/known bug (B\d+)/)?.[1] ?? '', m[3]!.match(/finding (F\d+)/)?.[1] ?? ''].join('|');
        if (where.has(key)) throw new Error('two packet items for ' + key);
        where.set(key, p.file + '/' + m[1]);
      }
    }
    const items: Array<{ kind: string; unit: string; blocker?: string; finding: string; judge: string }> = JSON.parse(readFileSync(one('--items'), 'utf8'));
    const ref = new Map<string, string>(), kinds = new Map<string, string>();
    for (const it of items) {
      const id = where.get([it.unit, it.kind, it.blocker ?? '', it.finding].join('|'));
      if (!id) throw new Error('no packet item for ' + it.unit + ' ' + it.finding);
      ref.set(id, it.judge); kinds.set(id, it.kind);
    }
    const read = (rows: Array<{ packet: string; labels?: Array<{ item: string; label: string }>; items?: Array<{ item: string; label: string }> }>) => {
      const m = new Map<string, string | null>();
      for (const r of rows) for (const x of r.labels ?? r.items ?? []) m.set(r.packet + '/' + x.item, x.label);
      return m;
    };
    const third = read(jsonl(one('--labels')));
    const answers = (f.get('--answers') ?? []).map((p) => read(Object.values(JSON.parse(readFileSync(p, 'utf8')))));
    const out: Record<string, unknown> = {};
    for (const kind of ['match', 'adjudicate']) {
      const ids = [...ref.keys()].filter((i) => kinds.get(i) === kind);
      if (!ids.length) continue;
      const jref = new Map(ids.map((i) => [i, ref.get(i)!]));
      const lab = answers.length === 2 ? agreed(answers[0]!, answers[1]!) : new Map<string, string>();
      const labK = new Map([...lab].filter(([i]) => kinds.get(i) === kind));
      const jOnLab = [...labK.keys()];
      out[kind] = { abstention: abstention(ids, third), judge: { name: kind === 'adjudicate' && f.has('--adjudicate-judge') ? one('--adjudicate-judge') : one('--judge'), ...compare(jref, third) },
        agreed_labels_vs_third: compare(labK, third),
        published_check_reproduced: { n: jOnLab.length, kappa_judge_vs_agreed_labels: r4(kappa(jOnLab.map((i) => ref.get(i)!), jOnLab.map((i) => labK.get(i)!))) } };
    }
    return out;
  }
  if (cmd === 'adjudicate') {
    const ids: string[] = f.has('--sample') ? JSON.parse(readFileSync(one('--sample'), 'utf8')).items[one('--check')] : jsonl(one('--items')).map((i) => i.item);
    const third = new Map<string, string | null>(jsonl(one('--labels')).map((r) => [r.item, r.ruling ?? null]));
    const rows = jsonl(one('--rulings'));
    const seen = new Set<string>();
    for (const r of rows) { const k = r.role + '|' + r.judge + '|' + r.item; if (seen.has(k)) throw new Error('two rulings for ' + k + ' in ' + one('--rulings')); seen.add(k); }
    const by = (role: string, judge: string) => new Map<string, string | null>(rows.filter((r) => r.role === role && r.judge === judge && ids.includes(r.item)).map((r) => [r.item, r.ruling ?? null]));
    const judges = [...new Set(rows.filter((r) => r.role === 'judge').map((r) => r.judge as string))].sort();
    const labellers = [...new Set(rows.filter((r) => r.role === 'labeller').map((r) => r.judge as string))].sort();
    const lab = labellers.length === 2 ? agreed(by('labeller', labellers[0]!), by('labeller', labellers[1]!)) : new Map<string, string>();
    const primary = f.get('--primary')?.[0] ?? null;
    return { items: ids.length, abstention: abstention(ids, third), primary,
      judges: Object.fromEntries(judges.map((j) => {
        const jr = by('judge', j);
        const ref = new Map([...jr].map(([i, x]) => [i, x ?? '(none)']));
        const onLab = [...lab.keys()].filter((i) => jr.has(i));
        return [j, { ...compare(ref, third), published_check_on_sample: { n: onLab.length, kappa_judge_vs_agreed_labels: r4(kappa(onLab.map((i) => jr.get(i) ?? '(none)'), onLab.map((i) => lab.get(i)!))) } }];
      })),
      agreed_labels_vs_third: compare(lab, third) };
  }
  throw new Error('usage: third-model-score.ts anchors|match|adjudicate ... (see the file head)');
}

if (import.meta.main) { try { console.log(JSON.stringify(score(process.argv.slice(2)), null, 2)); } catch (e) { process.stderr.write('third-model-score: ' + (e as Error).message + '\n'); process.exit(2); } }
