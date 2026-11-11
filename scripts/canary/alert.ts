#!/usr/bin/env bun
// Renders the canary's messages from verdicts (scripts/canary/decide.ts) and history lines (scripts/canary/receipts.sh):
//
//   bun scripts/canary/alert.ts alert --verdict <verdict.json>          the alert block (BROKEN, REGRESSION, WATCH, INCOMPLETE)
//   bun scripts/canary/alert.ts ok --verdict <verdict.json>             the one-line OK summary
//   bun scripts/canary/alert.ts summary --verdict <v.json>... [--note <text>]...   summary.md for the drive
//   bun scripts/canary/alert.ts digest --history <history.jsonl> --until <ISO date>  the weekly digest line (7 days)
//
// The alert format is fixed by the plan ("Alert format"); a line whose data does not apply is left out.
import { readFileSync } from 'node:fs';
import type { ModelKey, ModelReport, Reason, Status, Verdict } from './decide.ts';

const OWNER = {
  gstack: 'internal-task',
  gbrain: 'internal-task',
} as const;
const RANK: Record<Status, number> = { OK: 0, WATCH: 1, REGRESSION: 2, INCOMPLETE: 3, BROKEN: 4 };
export const short = (sha: string) => sha.slice(0, 8);
const usd = (x: number | null) => (x === null ? 'n/a' : '$' + x.toFixed(2));
const int = (x: number | null) => (x === null ? 'n/a' : Math.round(x).toLocaleString('en-US'));
const num = (x: number, d = 2) => x.toFixed(d);

export function headline(v: Verdict, status: string = v.status): string {
  return `Harness Evals canary: ${status} in ${v.suite} stable ${v.release.new.version} (${short(v.release.new.sha)}), previous ${v.release.prev.version} (${short(v.release.prev.sha)})`;
}

/** The reason the alert leads with: the most severe, earliest. */
export function leadReason(v: Verdict): Reason | null {
  return [...v.reasons].sort((a, b) => RANK[b.status] - RANK[a.status])[0] ?? null;
}

function leadModel(v: Verdict): [ModelKey, ModelReport] | null {
  const lead = leadReason(v);
  const key = lead?.model && v.models[lead.model] ? lead.model : (Object.keys(v.models) as ModelKey[])[0];
  return key ? [key, v.models[key]!] : null;
}

const MODEL_NAME: Record<ModelKey, string> = { opus: 'Opus 5.5', sol: 'GPT-6.1 Sol', particle: 'particle-1' };
const HARNESS_NAME: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex', hermes: 'Hermes' };

export function renderAlert(v: Verdict): string {
  const lines = [headline(v)];
  const lead = leadReason(v);
  const m = leadModel(v);
  if (m) {
    const [key, r] = m;
    const s = r.screen ?? { ...r.pass, tier: r.tier };
    const confirm = r.confirm ? `; confirm ${num(r.confirm.delta_points, 1)} points${r.confirm.ci95 ? ` [${num(r.confirm.ci95[0], 1)}, ${num(r.confirm.ci95[1], 1)}]` : ''}` : '';
    lines.push(`- What moved: ${MODEL_NAME[key]} in ${HARNESS_NAME[r.harness] ?? r.harness}: pass ${s.prev}/${s.n} -> ${s.new}/${s.n} (${s.b} tasks got worse, ${s.c} got better; screen p ${num(s.screen_p, 4)}${confirm})`);
    const c = r.cost;
    if (c.prev_usd !== null && c.new_usd !== null && c.ratio !== null) {
      const ci = c.lower !== null && c.upper !== null ? ` [${num(c.lower)}, ${num(c.upper)}]` : '';
      lines.push(`- Cost per trial: ${usd(c.prev_usd)} -> ${usd(c.new_usd)} (x${num(c.ratio)}${ci}); tokens per trial ${int(c.tokens_prev)} -> ${int(c.tokens_new)}`);
    }
    const e = lead?.rule === 'exposure_broken' ? ['listed', r.exposure.listed] as const : ['called', r.exposure.called] as const;
    const route = v.install_route?.[r.harness] ? `; install route ${v.install_route[r.harness]} at ${short(v.release.new.sha)}` : '';
    if (e[1].prev.n || e[1].new.n) lines.push(`- Exposure: ${e[0]} in ${e[1].prev.a}/${e[1].prev.n} -> ${e[1].new.b}/${e[1].new.n}${route}`);
    if (v.suite === 'gbrain' && r.safety) lines.push(`- Safety (gbrain): cross-scope reads ${r.safety.prev.reads} -> ${r.safety.new.reads}; leaks ${r.safety.prev.leaks} -> ${r.safety.new.leaks}`);
    if (r.plain) lines.push(`- No-gstack/no-brain arm (same window): ${r.plain.pass}/${r.plain.n}`);
    if (s.worse.length) lines.push(`- Tasks that got worse: ${s.worse.slice(0, 10).join(', ')}`);
  }
  if (v.release.range.length) lines.push(`- Releases in range: ${v.release.range.map((x) => x.version).join(', ')}; bisect: ${v.release.bisect?.first_bad ?? 'not run'}`);
  lines.push(`- Receipts: canary-receipts:${v.receipts_dir}, drive canary/runs/${v.run_id}/`);
  lines.push(`- Suggested owner: ${OWNER[v.suite]}; what to check first: ${lead?.check_first ?? 'the run log'}`);
  return lines.join('\n');
}

export function renderOk(v: Verdict): string {
  const parts = (Object.entries(v.models) as Array<[ModelKey, ModelReport]>).map(([k, r]) => {
    const cost = r.cost.ratio === null ? '' : `, cost x${num(r.cost.ratio)}`;
    return `${k} pass ${r.pass.prev}/${r.pass.n} -> ${r.pass.new}/${r.pass.n}${cost}`;
  });
  const cleared = v.cleared.length ? `; cleared: ${v.cleared.map((r) => r.rule + (r.model ? ' ' + r.model : '')).join(', ')}` : '';
  return `${headline(v, 'OK')}; tiers ${v.tiers_run.join(',')}${parts.length ? '; ' + parts.join('; ') : ''}${cleared}`;
}

export function renderNoMove(current: Record<'gstack' | 'gbrain', { sha: string; version: string }>): string {
  return `Harness Evals canary: OK, no stable move (gstack ${current.gstack.version} at ${short(current.gstack.sha)}, gbrain ${current.gbrain.version} at ${short(current.gbrain.sha)})`;
}

export function renderSummary(verdicts: readonly Verdict[], notes: readonly string[] = []): string {
  const out: string[] = ['# Canary run ' + (verdicts[0]?.run_id ?? ''), ''];
  for (const v of verdicts) {
    out.push(`## ${v.suite}: ${v.status}`, '', v.status === 'OK' ? renderOk(v) : renderAlert(v), '');
    out.push('| Model | Tier | Pass prev -> new | Worse / better | Screen p | Cost x | Exposure prev -> new | Plain |', '|---|---|---|---|---|---|---|---|');
    for (const [k, r] of Object.entries(v.models) as Array<[ModelKey, ModelReport]>) {
      const e = r.exposure.called;
      out.push(`| ${k}${r.label ? ' (' + r.label + ')' : ''} | ${r.tier} | ${r.pass.prev}/${r.pass.n} -> ${r.pass.new}/${r.pass.n} | ${r.pass.b} / ${r.pass.c} | ${num(r.pass.screen_p, 4)} | ${r.cost.ratio === null ? 'n/a' : num(r.cost.ratio)} | ${e.prev.a}/${e.prev.n} -> ${e.new.b}/${e.new.n} | ${r.plain ? r.plain.pass + '/' + r.plain.n : 'n/a'} |`);
    }
    out.push('', `Next step: ${v.next}. Tiers run: ${v.tiers_run.join(', ')}.`);
    for (const r of v.reasons) out.push(`- ${r.status} (${r.rule}, ${r.tier}): ${r.detail}`);
    for (const r of v.cleared) out.push(`- cleared (${r.rule}, ${r.tier}): ${r.detail}`);
    for (const d of v.digest) out.push(`- digest: ${d}`);
    for (const n of v.notes) out.push(`- note: ${n}`);
    out.push('');
  }
  for (const n of notes) out.push(`- note: ${n}`);
  return out.join('\n').trimEnd() + '\n';
}

export interface HistoryLine {
  schema: 'canary-history/1'; at: string; run_id: string; product: 'gstack' | 'gbrain' | null; status: Status;
  tiers?: string[]; prev?: { sha: string; version: string } | null; new?: { sha: string; version: string } | null;
  next?: string; pending?: string | null; lease_month?: string; spend_usd?: number; digest?: string[]; particle_flags?: string[];
  verdict?: string | null; note?: string; mode?: string;
}

/** One line for the weekly digest: runs per product by status over the 7 days up to `until`, plus improvement and particle-1 lines. */
export function renderDigest(lines: readonly HistoryLine[], until: string): string {
  const end = Date.parse(until), start = end - 7 * 86400_000;
  const week = lines.filter((l) => { const t = Date.parse(l.at); return t > start && t <= end; });
  const parts = (['gstack', 'gbrain'] as const).map((p) => {
    const mine = week.filter((l) => l.product === p);
    const by = new Map<string, number>();
    for (const l of mine) by.set(l.status, (by.get(l.status) ?? 0) + 1);
    const last = [...mine].reverse().find((l) => l.status !== 'INCOMPLETE' && l.new);
    return `${p} ${mine.length} run${mine.length === 1 ? '' : 's'}${by.size ? ' (' + [...by].map(([s, n]) => s + ' ' + n).join(', ') + ')' : ''}${last?.new ? ', last screened ' + last.new.version : ''}`;
  });
  const quiet = week.filter((l) => l.product === null).length;
  const extra = [...new Set(week.flatMap((l) => l.digest ?? []))];
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return `Harness Evals canary weekly digest ${day(start)} to ${day(end)}: ${parts.join('; ')}; ${quiet} quiet night${quiet === 1 ? '' : 's'}${extra.length ? '; ' + extra.join('; ') : '; no improvements or particle-1 flags'}`;
}

if (import.meta.main) {
  const [cmd, ...argv] = process.argv.slice(2);
  const all = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] !== undefined ? [argv[i + 1]] : []));
  const read = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Verdict;
  const verdicts = all('--verdict').map(read);
  if (cmd === 'alert' && verdicts[0]) console.log(renderAlert(verdicts[0]));
  else if (cmd === 'ok' && verdicts[0]) console.log(renderOk(verdicts[0]));
  else if (cmd === 'summary' && verdicts.length) process.stdout.write(renderSummary(verdicts, all('--note')));
  else if (cmd === 'digest' && all('--history')[0]) {
    const text = (() => { try { return readFileSync(all('--history')[0], 'utf8'); } catch { return ''; } })();
    const lines = text.split('\n').filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l) as HistoryLine]; } catch { return []; } });
    console.log(renderDigest(lines, all('--until')[0] ?? new Date().toISOString()));
  } else {
    console.error('usage: alert.ts alert|ok --verdict <v.json> | summary --verdict <v.json>... | digest --history <file> [--until <iso>]');
    process.exit(2);
  }
}
