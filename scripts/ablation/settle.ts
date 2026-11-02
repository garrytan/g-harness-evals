#!/usr/bin/env bun
// Settles the two coders' codes into layer maps (internal-task).
//
//   bun scripts/ablation/settle.ts [--missing <file>]
//
// Regenerates the candidates (gen-anchors.ts), reads the raw codes in
// harnesses/ablation/coding/{opus,sol}.json, computes percent agreement and
// Cohen's kappa (per harness, per map and overall, over distinct coding
// items), settles every disagreement by the rule in harnesses/ablation/README.md,
// and writes harnesses/ablation/<harness>.<wire>.layers.json, agreement.json
// and manifest.json (each map's sha256, which the proxy checks at bind time).
// With --missing it only writes the items that either coder has not coded,
// for a re-run on a new pin, and exits 1 when there are any.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Candidate, COMBOS, type ComboCandidates, codingItems, comboId, generate } from './gen-anchors.ts';
import { LAYERS, type Label, type LayerMap, NEVER_REMOVED, type Paragraph, ROOT, type Span, sha256 } from './maps.ts';

export const DIR = join(ROOT, 'harnesses/ablation');
const LABELS: readonly string[] = [...LAYERS, ...NEVER_REMOVED];
const PRECEDENCE: Label[] = ['safety', 'memory-skills', 'tool-guide', 'work-habits', 'identity', 'style'];
export interface CoderFile { coder: string; model: string; reasoning: string; spend: string; assignments: Array<{ id: string; label: string; reason: string }> }

const inToolDescription = (c: Candidate) => c.location.kind === 'tool_description' || c.location.kind === 'additional_tool';
const never = (l: string) => (NEVER_REMOVED as readonly string[]).includes(l);

/** The README's settling rule. Returns the label and the step that decided it (0 when the coders agree). */
export function settle(a: string | undefined, b: string | undefined, toolDescription: boolean): { label: Label; step: number } {
  const ok = (l: string | undefined): l is Label => l !== undefined && LABELS.includes(l);
  if (!ok(a) && !ok(b)) throw new Error(`no valid code (${a}, ${b})`);
  if (!ok(a) || !ok(b)) return { label: (ok(a) ? a : b) as Label, step: 6 };
  if (a === b) return { label: a, step: 0 };
  if (never(a) !== never(b)) return { label: never(a) ? a : b, step: 1 };
  if (never(a)) return { label: 'protocol-and-discovery', step: 2 };
  if (toolDescription) for (const l of ['memory-skills', 'tool-descriptions'] as Label[]) if (a === l || b === l) return { label: l, step: 3 };
  if (!toolDescription && (a === 'tool-descriptions' || b === 'tool-descriptions')) return { label: a === 'tool-descriptions' ? b : a, step: 4 };
  return { label: PRECEDENCE.find((l) => l === a || l === b)!, step: 5 };
}

/** Percent agreement and Cohen's kappa over paired codes. */
export function agreement(pairs: Array<[string, string]>): { n: number; agree: number; percent: number; kappa: number | null } {
  const n = pairs.length;
  if (!n) return { n, agree: 0, percent: 0, kappa: null };
  const agree = pairs.filter(([a, b]) => a === b).length;
  const po = agree / n;
  const count = (k: string, side: 0 | 1) => pairs.filter((p) => p[side] === k).length / n;
  const pe = LABELS.reduce((s, k) => s + count(k, 0) * count(k, 1), 0);
  return { n, agree, percent: Number((100 * po).toFixed(1)), kappa: pe === 1 ? null : Number(((po - pe) / (1 - pe)).toFixed(3)) };
}

export function readCoder(name: string): CoderFile {
  return JSON.parse(readFileSync(join(DIR, 'coding', name), 'utf8')) as CoderFile;
}

/** One map from a combo's candidates and the settled label of each candidate. */
export function buildMap(cc: ComboCandidates, labelOf: (c: Candidate) => Label, coders: CoderFile[]): LayerMap {
  const families = cc.families.map((f) => {
    const cands = cc.candidates.filter((c) => c.family === f.id);
    const spans: Span[] = [];
    let k = 0;
    for (let i = 0; i < cands.length;) {
      const first = cands[i]!;
      let j = i + 1;
      while (j < cands.length && cands[j]!.unit === first.unit && cands[j]!.section === first.section && cands[j]!.presence === first.presence && cands[j]!.location.kind !== 'tool_definition') j++;
      const group = cands.slice(i, j);
      const labels = group.map(labelOf);
      const set = (l: Label) => ((LAYERS as readonly string[]).includes(l) ? { layer: l as Span['layer'] } : { never_removed: l as Span['never_removed'] });
      const sum = (g: Candidate[]) => ({ min: g.reduce((s, c) => s + c.bytes.min, 0), max: g.reduce((s, c) => s + c.bytes.max, 0) });
      const span: Span = {
        id: `${f.id}.${first.unit}.s${k++}`, unit: first.unit, location: first.location,
        ...(first.anchor !== undefined ? { anchor: first.anchor } : {}),
        section: first.section, presence: first.presence, bytes: sum(group),
        ...(group.every((c) => c.text_sha256) ? { text_sha256: sha256(group.map((c) => c.text).join('')) } : {}),
        candidates: group.map((c) => c.id),
      };
      if (new Set(labels).size === 1) Object.assign(span, set(labels[0]!));
      else {
        const paragraphs: Paragraph[] = [];
        group.forEach((c, n) => {
          const last = paragraphs[paragraphs.length - 1];
          if (last && labels[n - 1] === labels[n]) { last.bytes = { min: last.bytes.min + c.bytes.min, max: last.bytes.max + c.bytes.max }; last.candidates.push(c.id); }
          else paragraphs.push({ anchor: c.anchor!, ...set(labels[n]!), bytes: { ...c.bytes }, candidates: [c.id] });
        });
        span.paragraphs = paragraphs;
      }
      spans.push(span);
      i = j;
    }
    return { id: f.id, kind: f.kind, fingerprint: f.fingerprint, requests_seen: f.requests.length, spans };
  });
  return {
    schema: 'harness-ablation-layers/1', harness: cc.combo.harness, wire: cc.combo.wire, model: cc.combo.model, sources: cc.sources,
    coding: { coders: coders.map((c, i) => ({ file: `harnesses/ablation/coding/${['opus', 'sol'][i]}.json`, model: c.model })), items: 'harnesses/ablation/coding/items.json', agreement: 'harnesses/ablation/agreement.json', rule: 'harnesses/ablation/README.md#settling-a-disagreement' },
    families,
  } as LayerMap;
}

export const mapFile = (c: { harness: string; wire: string }) => `${comboId(c)}.layers.json`;

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const missingOut = argv[argv.indexOf('--missing') + 1];
  const all = COMBOS.map(generate);
  const problems = all.flatMap((cc) => cc.problems);
  if (problems.length) { for (const p of problems) console.error(`PROBLEM: ${p}`); process.exit(1); }
  const items = codingItems(all);
  const coders = ['opus.json', 'sol.json'].map((f) => (existsSync(join(DIR, 'coding', f)) ? readCoder(f) : { coder: f, model: '', reasoning: '', spend: '', assignments: [] }));
  const codes = coders.map((c) => new Map(c.assignments.map((a) => [a.id, a.label])));
  const missing = items.filter((it) => !codes.every((m) => m.has(it.id)));
  if (missingOut !== undefined && argv.includes('--missing')) {
    writeFileSync(missingOut, JSON.stringify(missing, null, 1) + '\n');
    console.log(`SETTLE: ${missing.length} of ${items.length} items lack a code from one or both coders (${missingOut})`);
    process.exit(missing.length ? 1 : 0);
  }
  if (missing.length) { console.error(`SETTLE: ${missing.length} items have no code from one or both coders; run with --missing <file>`); process.exit(1); }
  const [A, B] = codes as [Map<string, string>, Map<string, string>];
  const itemTool = new Map<string, boolean>();
  for (const cc of all) for (const c of cc.candidates) if (!c.fixed) itemTool.set(c.item, (itemTool.get(c.item) ?? false) || inToolDescription(c));
  const settled = new Map(items.map((it) => [it.id, settle(A.get(it.id), B.get(it.id), itemTool.get(it.id)!)]));
  const pairsFor = (ids: Iterable<string>) => [...new Set(ids)].map((id) => [A.get(id)!, B.get(id)!] as [string, string]);
  const byHarness: Record<string, unknown> = {};
  for (const h of [...new Set(COMBOS.map((c) => c.harness))]) byHarness[h] = agreement(pairsFor(all.filter((cc) => cc.combo.harness === h).flatMap((cc) => cc.candidates.filter((c) => !c.fixed).map((c) => c.item))));
  const byMap: Record<string, unknown> = {};
  for (const cc of all) byMap[comboId(cc.combo)] = agreement(pairsFor(cc.candidates.filter((c) => !c.fixed).map((c) => c.item)));
  const confusion: Record<string, Record<string, number>> = {};
  for (const it of items) { const a = A.get(it.id)!; const b = B.get(it.id)!; (confusion[a] ??= {})[b] = (confusion[a]![b] ?? 0) + 1; }
  const reasons = coders.map((c) => new Map(c.assignments.map((a) => [a.id, a.reason])));
  const disagreements = items.filter((it) => A.get(it.id) !== B.get(it.id)).map((it) => ({
    item: it.id, bytes: it.bytes, opus: A.get(it.id), sol: B.get(it.id), settled: settled.get(it.id)!.label, step: settled.get(it.id)!.step,
    opus_reason: reasons[0]!.get(it.id), sol_reason: reasons[1]!.get(it.id), where: it.contexts, text: it.text.length > 160 ? it.text.slice(0, 160) + '...' : it.text,
  }));
  const steps: Record<string, number> = {};
  for (const d of disagreements) steps[String(d.step)] = (steps[String(d.step)] ?? 0) + 1;
  writeFileSync(join(DIR, 'agreement.json'), JSON.stringify({
    schema: 'harness-ablation-agreement/1',
    coders: coders.map((c, i) => ({ file: `coding/${['opus', 'sol'][i]}.json`, model: c.model, reasoning: c.reasoning, spend: c.spend })),
    unit: 'distinct coding items (candidate texts; identical text in two maps is one item); fixed-by-rule candidates (tool definitions, world MCP tools) are not coded and not counted',
    overall: agreement(pairsFor(items.map((i) => i.id))), by_harness: byHarness, by_map: byMap,
    confusion_opus_by_sol: confusion, settled_by_step: steps, disagreements,
  }, null, 1) + '\n');
  const manifest: Array<{ file: string; harness: string; wire: string; model: string; sha256: string }> = [];
  for (const cc of all) {
    const map = buildMap(cc, (c) => (c.fixed ? c.fixed.never_removed : settled.get(c.item)!.label), coders);
    const text = JSON.stringify(map, null, 1) + '\n';
    writeFileSync(join(DIR, mapFile(cc.combo)), text);
    manifest.push({ file: mapFile(cc.combo), harness: cc.combo.harness, wire: cc.combo.wire, model: cc.combo.model, sha256: sha256(text) });
    console.log(`SETTLE: ${mapFile(cc.combo)} ${map.families.reduce((n, f) => n + f.spans.length, 0)} spans, sha256 ${sha256(text).slice(0, 12)}`);
  }
  writeFileSync(join(DIR, 'manifest.json'), JSON.stringify({ schema: 'harness-ablation-manifest/1', note: 'sha256 of each map file as committed; the metering proxy recomputes it at bind time and refuses a mismatch', maps: manifest }, null, 1) + '\n');
  console.log(`SETTLE: agreement ${JSON.stringify(agreement(pairsFor(items.map((i) => i.id))))}, ${disagreements.length} disagreements settled (${JSON.stringify(steps)})`);
}
