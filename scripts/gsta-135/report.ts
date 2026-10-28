#!/usr/bin/env bun
/**
 * internal-task report: cells.jsonl to report.md, one Markdown table worded as one
 * trial per cell (an existence proof, never a rate), plus the run's settings,
 * spend (spent, reserved-unknown, never folded into one number) and the dated
 * deviations. Used by scripts/gsta-135/discovery.sh.
 *
 *   bun scripts/gsta-135/report.ts <cells.jsonl> <report.md> --pin <pin8> --run-id <id> --lease-usd <n> --cap <n> [--summary <json>] [--stop <reason>]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [cellsPath, outPath, ...rest] = process.argv.slice(2);
const arg = (n: string, d = '') => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] ?? d : d; };
const rows = readFileSync(cellsPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const money = (n: number) => '$' + (Math.round(n * 10000) / 10000).toFixed(4);
const ev = (r: any, k: string) => {
  const e = r.evidence?.[k];
  if (!r.evidence) return r.termination.startsWith('not_run') ? 'not run' : 'unobservable';
  if (r.evidence.transcript !== 'complete' && !e) return 'unobservable (transcript ' + r.evidence.transcript + ')';
  return e ? e.detail.slice(0, 90) + ' [' + e.locator + '; sha256 ' + e.sha256.slice(0, 12) + ']' : 'absent';
};
// A positive event is an existence proof whatever the transcript's state; absence is a verdict only on a complete transcript.
const verdict = (r: any) => {
  if (r.termination.startsWith('not_run')) return r.termination;
  if (!r.evidence) return 'unobservable';
  const opened = !!r.evidence.skill_open, ran = !!r.evidence.helper_run, any = r.evidence.gstack_paths > 0 || opened || ran;
  const complete = r.evidence.transcript === 'complete';
  const absent = (s: string) => complete ? s : 'unobservable (transcript ' + r.evidence.transcript + ')';
  if (r.arm === 'none') return any ? 'gstack path seen in a no-gstack arm (' + r.evidence.gstack_paths + ' events)' : absent('no gstack path in this trial');
  if (r.task === 3) return opened ? 'gstack skill opened in the control' : absent('no gstack skill opened in this trial');
  return opened && ran ? 'skill opened and helper run in this trial' : opened ? (complete ? 'skill opened, no helper run in this trial' : 'skill opened; helper run unobservable (transcript ' + r.evidence.transcript + ')') : absent('no gstack skill opened in this trial');
};
const sum = (k: string) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
const spent = sum('usd_spent');
const unknown = sum('usd_reserved_unknown');
const refusals: Record<string, number> = {};
for (const r of rows) for (const [k, n] of Object.entries(r.refusals ?? {})) refusals[k] = (refusals[k] ?? 0) + (n as number);
// Refusals cost nothing; what matters is whether any was the lease (402) rather than a route or credential the proxy does not allow (403).
const budget = sum('budget_refusals');
const refusalNote = !sum('requests_refused') ? '' : ' (' + (budget ? budget + ' by the lease; ' : 'none by the lease; ') +
  [...Object.entries(refusals).sort((a, b) => b[1] - a[1]).map(([k, n]) => n + ' x ' + k.replace(/[|\n]/g, ' ')), 'a refusal costs nothing'].join('; ') + ')';
const unfinalized = rows.filter(r => r.requests_undrained === null).map(r => r.trial_id);
const day = (rows.find(r => r.started_at)?.started_at ?? new Date().toISOString()).slice(0, 10);
const deviations = [
  ...(Number(arg('--cap')) !== 16384 ? ['- ' + day + ': the lease ran with an output cap of ' + Number(arg('--cap')).toLocaleString('en-US') + ' tokens a request, not the plan\'s 16,384 (the harnesses state their own max_tokens on every turn and the proxy refuses a stated value above the cap). Accepted as a ceiling detail inside the $' + arg('--lease-usd') + ' lease.'] : []),
  ...(rows.some(r => r.termination === 'not_run:register_failed') ? ['- ' + day + ': ' + rows.filter(r => r.termination === 'not_run:register_failed').map(r => r.trial_id).join(', ') + ' not run: ' + (rows.find(r => r.termination === 'not_run:register_failed')?.note ?? 'registration failed in the preflight') + '.'] : []),
  ...(rows.some(r => r.termination?.startsWith('not_run:cap')) ? ['- ' + day + ': ' + rows.filter(r => r.termination.startsWith('not_run:cap')).length + ' planned cell(s) not dispatched after the lease refused a request' + (arg('--stop') ? ' (' + arg('--stop') + ')' : '') + '.'] : []),
].concat(rows.some(r => r.tree_dirty) ? ['- ' + day + ': the tree carried uncommitted changes when the run started (tree-status.txt beside this report lists them).'] : []);
if (!deviations.length) deviations.push('- none recorded by the driver.');
const lines = [
  '# internal-task live discovery, uncounted diagnostic (' + day + ')',
  '',
  'One trial per cell. Each row is an existence proof for that one trial, not a rate; nothing here is a comparison claim. ' +
  'Evidence comes from the harness\'s native transcript (OpenClaw: the exec session store under state/openclaw/exec/agents; Hermes: HERMES_HOME/state.db; QM: no decoder at this pin, so a QM cell is unobservable), ' +
  'decoded tool-call events only; the wrapper\'s gstack-register.log, assistant prose and quoted examples never count.',
  '',
  '- gstack pin: ' + arg('--pin') + '; tree ' + (rows[0]?.tree ?? '?') + (rows[0]?.tree_dirty ? ' (dirty)' : '') + '; model ' + (rows[0]?.model ?? '?'),
  '- lease: run id ' + arg('--run-id') + ', $' + arg('--lease-usd') + ', output cap ' + arg('--cap') + ' tokens a request; proxy on the docker bridge gateway with per-trial tokens',
  '- spent ' + money(spent) + ' settled; ' + money(unknown) + ' reserved on failed requests (unknown, not folded into spent); lease summary: ' + (arg('--summary') || 'none'),
  '- requests: ' + sum('requests_forwarded') + ' forwarded, ' + sum('requests_refused') + ' refused' + refusalNote + (sum('requests_undrained') ? '; ' + sum('requests_undrained') + ' still in flight when their trial was finalized (cost in the ledger, not in any row)' : '') + (unfinalized.length ? '; finalize failed for ' + unfinalized.join(', ') + ' (those rows may miss in-flight requests; the ledger summary is authoritative)' : ''),
  ...(arg('--stop') ? ['- stopped: ' + arg('--stop')] : []),
  '',
  '## Deviations',
  '',
  ...deviations,
  '',
  '## Cells',
  '',
  '| trial | harness | task | arm | termination | exit | forwarded | spent | unknown | skill opened | helper run | verdict for this trial |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map(r => '| ' + [r.trial_id, r.harness, r.task, r.arm, r.termination, r.exit_code ?? '', r.requests_forwarded ?? 0, money(r.usd_spent ?? 0), money(r.usd_reserved_unknown ?? 0), ev(r, 'skill_open'), ev(r, 'helper_run'), verdict(r)].join(' | ') + ' |'),
  '',
  '## Images',
  '',
  ...[...new Map(rows.map(r => [r.image, r.image_digest])).entries()].map(([i, d]) => '- ' + i + ' ' + d),
  '',
];
writeFileSync(outPath, lines.join('\n'));
console.log('wrote ' + outPath + ' with ' + rows.length + ' rows');
