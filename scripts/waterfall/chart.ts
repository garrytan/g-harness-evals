#!/usr/bin/env bun
// Token waterfall charts (internal-task): plain hand-written SVG from a mined waterfall (scripts/waterfall/mine.ts).
//
//   bun scripts/waterfall/chart.ts --mined <waterfall.json> --out <dir> [--charts billing,content,growth,avoidable]
//
// Per cell: a billing waterfall (dollars per billing class, summing to the cell's receipt dollars), a content
// waterfall (bytes per section, or tokens when the miner had a calibration table), a per-turn growth line chart
// (input tokens per request by user turn) and a horizontal bar chart of the avoidable-looking categories with
// task-clustered interval whiskers. A chart whose data the mined file does not hold is skipped. Every title names the
// harness and the model, and says "secondary model, no headline" unless the model is one a headline may rest on.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SectionTotals } from './mine.ts';
import { BILLING_CLASSES, BILLING_LABELS, isHeadline, SECTION_NAMES, type Bill } from './types.ts';

export interface Bar { label: string; value: number; start: number }
export interface CellData {
  cell: string; harness: string | null; model: string | null; trials: number; bill: Bill; sections?: SectionTotals;
  turns_by_index: Array<{ turn: number; trials: number; mean_input_tokens_per_request: number; mean_last_request_input_tokens: number }>;
  avoidable?: Record<string, { label: string; unit: string; per_trial_mean: number; ci95: [number, number] | null }>;
}

const W = 760, ROW = 26, LABEL = 210, VALUE = 110;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (x: number) => Number(x.toFixed(2));
const grouped = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const format = (x: number, unit: string) => (unit === 'USD' ? `${x < 0 ? '-' : ''}$${Math.abs(x).toFixed(4)}` : `${grouped(x)} ${unit}`);

/** Waterfall steps: each bar starts where the previous one ended; the last end is the total. */
export function waterfall(items: ReadonlyArray<{ label: string; value: number }>): { bars: Bar[]; total: number } {
  let at = 0;
  const bars = items.map(({ label, value }) => { const bar = { label, value, start: at }; at += value; return bar; });
  return { bars, total: at };
}

/** Billing classes in dollars; a class at $0, and a remainder under $1e-9, is left out. */
export function billingItems(bill: Bill) {
  return BILLING_CLASSES.filter((k) => (k === 'remainder' ? Math.abs(bill.usd[k]) > 1e-9 : bill.usd[k] !== 0)).map((k) => ({ label: BILLING_LABELS[k], value: bill.usd[k] }));
}

/** Content sections in tokens when calibrated, else bytes. */
export function contentItems(s: SectionTotals) {
  const tokens = s.tokens && s.uncalibrated_requests === 0 && SECTION_NAMES.every((k) => !s.uncalibrated_bytes?.[k]);
  return { unit: tokens ? 'tokens' : 'bytes', items: SECTION_NAMES.map((k) => ({ label: k.replace('_', ' '), value: tokens ? s.tokens![k] : s.bytes[k] })).filter((i) => i.value !== 0) };
}

export function title(c: Pick<CellData, 'harness' | 'model'>, chart: string) {
  const model = (c.model ?? 'unknown model').replace(/^[a-z]+:/, '');
  return `${c.harness ?? 'unknown harness'}, ${model}${isHeadline(model) ? '' : ' (secondary model, no headline)'}: ${chart}`;
}

const frame = (height: number, heading: string, sub: string, body: string) => [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" font-family="Helvetica, Arial, sans-serif" font-size="12">`,
  `<title>${esc(heading)}</title>`,
  `<rect width="${W}" height="${height}" fill="#ffffff"/>`,
  `<text x="12" y="22" font-size="14" font-weight="bold">${esc(heading)}</text>`,
  `<text x="12" y="40" fill="#555555">${esc(sub)}</text>`,
  body,
  '</svg>',
].join('\n') + '\n';

export function waterfallSvg(heading: string, sub: string, unit: string, items: ReadonlyArray<{ label: string; value: number }>) {
  const { bars, total } = waterfall(items);
  const lo = Math.min(0, ...bars.map((b) => Math.min(b.start, b.start + b.value))), hi = Math.max(total, ...bars.map((b) => Math.max(b.start, b.start + b.value)));
  const span = hi - lo || 1, plot = W - LABEL - VALUE - 24, x = (v: number) => r2(LABEL + ((v - lo) / span) * plot);
  const rows = [...bars.map((b) => ({ ...b, total: false })), { label: 'Total', value: total, start: 0, total: true }];
  const body = rows.map((b, i) => {
    const y = 56 + i * ROW, x0 = x(Math.min(b.start, b.start + b.value)), x1 = x(Math.max(b.start, b.start + b.value));
    return [`<text x="${LABEL - 8}" y="${y + 17}" text-anchor="end"${b.total ? ' font-weight="bold"' : ''}>${esc(b.label)}</text>`,
      `<rect x="${x0}" y="${y + 4}" width="${r2(Math.max(x1 - x0, 1))}" height="${ROW - 8}" fill="${b.total ? '#333333' : '#4a7ab5'}"/>`,
      `<text x="${W - VALUE}" y="${y + 17}"${b.total ? ' font-weight="bold"' : ''}>${esc(format(b.value, unit))}</text>`].join('\n');
  }).join('\n');
  return frame(56 + rows.length * ROW + 12, heading, sub, body);
}

export function growthSvg(heading: string, sub: string, series: ReadonlyArray<{ name: string; points: Array<[number, number]> }>) {
  const H = 330, left = 80, right = W - 200, top = 76, bottom = H - 40;
  const xs = series.flatMap((s) => s.points.map((p) => p[0])), ys = series.flatMap((s) => s.points.map((p) => p[1]));
  const raw = (Math.max(...ys) * 1.05) / 4 || 1, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw)! * mag;
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMax = step * 4;
  const px = (v: number) => r2(xMax === xMin ? (left + right) / 2 : left + ((v - xMin) / (xMax - xMin)) * (right - left)), py = (v: number) => r2(bottom - (v / yMax) * (bottom - top));
  const colors = ['#4a7ab5', '#c0504d', '#9bbb59'];
  const ticks = Array.from({ length: 5 }, (_, i) => step * i);
  const body = [
    `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#999999"/>`,
    `<line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="#999999"/>`,
    ...ticks.map((t) => `<text x="${left - 6}" y="${py(t) + 4}" text-anchor="end" fill="#555555">${grouped(t)}</text>`),
    ...[...new Set(xs)].sort((a, b) => a - b).map((t) => `<text x="${px(t)}" y="${bottom + 16}" text-anchor="middle" fill="#555555">turn ${t}</text>`),
    `<text x="${left}" y="${top - 12}" fill="#555555">input tokens per request</text>`,
    ...series.flatMap((s, i) => [
      `<polyline fill="none" stroke="${colors[i % colors.length]}" stroke-width="2" points="${s.points.map(([a, b]) => `${px(a)},${py(b)}`).join(' ')}"/>`,
      ...s.points.map(([a, b]) => `<circle cx="${px(a)}" cy="${py(b)}" r="3" fill="${colors[i % colors.length]}"/>`),
      `<rect x="${right + 16}" y="${top + i * 20}" width="12" height="12" fill="${colors[i % colors.length]}"/>`,
      `<text x="${right + 34}" y="${top + i * 20 + 11}">${esc(s.name)}</text>`,
    ]),
  ].join('\n');
  return frame(H, heading, sub, body);
}

export function avoidableSvg(heading: string, sub: string, items: ReadonlyArray<{ label: string; unit: string; value: number; ci95: [number, number] | null }>) {
  const units = [...new Set(items.map((i) => i.unit))];
  const plot = W - LABEL - VALUE - 24;
  let y = 56;
  const parts: string[] = [];
  for (const unit of units) {
    const rows = items.filter((i) => i.unit === unit);
    const hi = Math.max(...rows.map((r) => Math.max(r.value, r.ci95?.[1] ?? 0))) || 1, x = (v: number) => r2(LABEL + (Math.max(v, 0) / hi) * plot);
    parts.push(`<text x="12" y="${y + 14}" fill="#555555">per trial, ${esc(unit)}</text>`);
    y += ROW;
    for (const r of rows) {
      parts.push(`<text x="${LABEL - 8}" y="${y + 17}" text-anchor="end">${esc(r.label)}</text>`, `<rect x="${LABEL}" y="${y + 4}" width="${r2(Math.max(x(r.value) - LABEL, 1))}" height="${ROW - 8}" fill="#4a7ab5"/>`);
      if (r.ci95) parts.push(`<line x1="${x(r.ci95[0])}" y1="${y + 13}" x2="${x(r.ci95[1])}" y2="${y + 13}" stroke="#222222"/>`,
        `<line x1="${x(r.ci95[0])}" y1="${y + 7}" x2="${x(r.ci95[0])}" y2="${y + 19}" stroke="#222222"/>`, `<line x1="${x(r.ci95[1])}" y1="${y + 7}" x2="${x(r.ci95[1])}" y2="${y + 19}" stroke="#222222"/>`);
      parts.push(`<text x="${W - VALUE}" y="${y + 17}">${esc(format(r.value, unit))}</text>`);
      y += ROW;
    }
  }
  return frame(y + 12, heading, sub, parts.join('\n'));
}

/** Every chart the cell's data supports, by kind. */
export function cellCharts(c: CellData, kinds: readonly string[]): Record<string, string> {
  const sub = `cell ${c.cell}, ${c.trials} trials`;
  const out: Record<string, string> = {};
  if (kinds.includes('billing')) out.billing = waterfallSvg(title(c, 'billing by class'), `${sub}, ${c.bill.requests} requests`, 'USD', billingItems(c.bill));
  if (kinds.includes('content') && c.sections) {
    const { unit, items } = contentItems(c.sections);
    out.content = waterfallSvg(title(c, `content by section (${unit})`), `${sub}, ${c.sections.requests} requests with sections`, unit, items);
  }
  if (kinds.includes('growth') && c.turns_by_index.length) {
    out.growth = growthSvg(title(c, 'growth by user turn'), `${sub}; a later turn holds only the trials that reached it`, [
      { name: 'mean per request', points: c.turns_by_index.map((t) => [t.turn, t.mean_input_tokens_per_request]) },
      { name: 'last request of the turn', points: c.turns_by_index.map((t) => [t.turn, t.mean_last_request_input_tokens]) }]);
  }
  if (kinds.includes('avoidable') && c.avoidable) {
    out.avoidable = avoidableSvg(title(c, 'avoidable-looking spend'), `${sub}; bars are per-trial means, whiskers task-clustered 95% intervals`,
      Object.values(c.avoidable).map((a) => ({ label: a.label, unit: a.unit, value: a.per_trial_mean, ci95: a.ci95 })));
  }
  return out;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const minedPath = arg('mined'), outDir = arg('out');
  if (!minedPath || !outDir) { console.error('usage: bun scripts/waterfall/chart.ts --mined <waterfall.json> --out <dir> [--charts billing,content,growth,avoidable]'); process.exit(64); }
  const kinds = (arg('charts') ?? 'billing,content,growth,avoidable').split(',');
  const mined = JSON.parse(readFileSync(minedPath, 'utf8')) as { cells: CellData[] };
  mkdirSync(outDir, { recursive: true });
  for (const c of mined.cells) for (const [kind, svg] of Object.entries(cellCharts(c, kinds))) {
    writeFileSync(join(outDir, `${c.cell}.${kind}.svg`), svg);
    console.log(join(outDir, `${c.cell}.${kind}.svg`));
  }
}
