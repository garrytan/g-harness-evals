#!/usr/bin/env bun
// internal-task Amendment 3, part 2: the plan judges' calibration, the blind labellers of the 40 real replies, and the plan band
// on the stored headroom replies. Every model call goes through the metering proxy under a lease.
//
//   bun harnesses/qm/gstack/judge-calibration.ts reserve --public <dir> --replicate-to <dir>
//   bun harnesses/qm/gstack/judge-calibration.ts inputs  --private <dir> --tasks-dir <dir> --bank <private bank dir> --calibration-turns <turns.jsonl>
//   bun harnesses/qm/gstack/judge-calibration.ts run     --private <dir> --public <dir> --role <role> --set <set> [--rep 2] [--concurrency 4]
//   bun harnesses/qm/gstack/judge-calibration.ts report  --private <dir> --public <dir>
//   bun harnesses/qm/gstack/judge-calibration.ts band    --headroom <headroom dir> --out <json>
//
// reserve: writes the judge-calibration reserve ($25) as a line of the main stage ledger (<replicate-to>/stage-ledger.jsonl,
//   scripts/ubicloud/stage_ledger.py, run id qm-s1-edition-2026-11, stage main), refused when main's $520 would be passed,
//   then opens lease qm-s1-edition-2026-11-judge-calibration ($25, 128,000 output tokens) on <public>/ledger.sqlite.
// inputs: builds <private>/items.jsonl. Sets: dev (the bank's 48 author plan replies and its 6 paraphrased good probes, the
//   development set, never a gate), A (72) and C (96) (the blind sets, labels per constraint), nbb (the bank's 4 probes
//   that name their constraints while breaking them), redteam (24 plans built from the keys, one per plan task, naming every
//   constraint and distractor), real (the 40 real replies: plain from headroom/turns.jsonl and edition from
//   pilot/turns.jsonl and the calibration trials, plan-01 to plan-10, both models). Every text goes through the grader's
//   own extraction (edition-grade.ts extract), so a judge sees what it would see in a run.
// run: one role over one set, items in order, resumable (an item already in the output is skipped). Roles: primary,
//   secondary (the judges), label-opus, label-sol (the blind labellers, set real only) and label-third (the third blind
//   Opus pass, only on the real replies whose two labels disagree on the outcome; it sees neither label). Each role meters
//   under its own usage key <role>:<set>:<run id>. A cap refusal stops the run. Output: <private>/out/<role>-<set>[-r2]-
//   rubric-<sha12>.jsonl, per item, private.
// report: the aggregate agreement table to <public>/agreement.json (no plan text, no per-item label), details to
//   <private>/report-detail.json. Truth: real, the full rule (at least 2 respected, at most 6 items) on the reference labels
//   (the outcome both labellers agree on, else the third pass's); A and C, at least 2 respected on the bank's labels; nbb and
//   redteam, every plan fails the full rule.
// band: the primary's plan success rate per model on the 48 stored headroom plan replies (band-grades.jsonl in each headroom
//   shard, from judge-shard.ts --judges primary --out-prefix band-), with the Wilson 95 percent interval, against 15 to 75 percent.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BudgetRun } from '../../../runner/ledger/budget-ledger.ts';
import { RunProxy } from '../../../runner/trial/proxy.ts';
import type { UsageLine } from '../../../runner/proxy/metering-proxy.ts';
import { extract, MAX_PLAN_NAMED, MIN_PLAN_CONSTRAINTS, type PlanJudgeInput } from './edition-grade.ts';
import type { KeyRecord, PlanKey, TaskRecord } from './edition-fixture.ts';
import { CapStop, judgeWith, modelId, RUBRIC_SHA256, ROLES, type FullJudgement, type Role, type RoleSpec, type Verdict } from './plan-judge.ts';

const ROOT = resolve(import.meta.dir, '..', '..', '..');
const BENCH = 'docs/benchmarks/2026-11-06-qm-s1-edition';
export const RUN_ID = 'qm-s1-edition-2026-11-judge-calibration';
export const LEASE_USD = 25;
export const SETS = ['dev', 'A', 'C', 'nbb', 'redteam', 'real'] as const;
export type SetName = (typeof SETS)[number];
export const CAL_ROLES = ['primary', 'secondary', 'label-opus', 'label-sol', 'label-third'] as const;
export type CalRole = (typeof CAL_ROLES)[number];
const specOf = (r: CalRole): RoleSpec => ROLES[(r === 'label-third' ? 'label-opus' : r) as Role];
export const REAL_TASKS = Array.from({ length: 10 }, (_, i) => 'plan-' + String(i + 1).padStart(2, '0'));
export const GATES = { real: 36, A: 65, C: 87, nbb: 4, redteam: 24 } as const;

export interface Item { set: SetName; id: string; task_id: string; input: PlanJudgeInput; cell?: string; truth?: { outcome: boolean; constraints?: Record<string, Verdict> } }
export interface Row { id: string; set: SetName; named: string[]; named_count: number; verdicts: Record<string, Verdict>; items: number; empty: boolean; attempts: number; full: boolean; resp2: boolean; error?: string }

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const jsonl = <T>(p: string): T[] => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as T) : []);
export const planText = (reply: string) => extract(reply).flatMap((s) => s.units).join('\n');
export const fullRule = (named: number, namedCount: number) => named >= MIN_PLAN_CONSTRAINTS && namedCount <= MAX_PLAN_NAMED;
const inputFor = (task: TaskRecord, key: PlanKey, text: string): PlanJudgeInput => ({ request: task.request, final_answer: planText(text), constraints: key.constraints.map(({ id, description }) => ({ id, description })) });

/** The red-team plan of one task: every constraint and distractor named as something to preserve, built from the key. */
export function redTeamPlan(key: PlanKey): string {
  const all = [...key.constraints, ...key.distractors];
  return ['## Plan', ...all.map((i, n) => (n + 1) + '. Preserve and check: ' + i.description), '## Checks', ...all.map((i) => '- Confirm ' + i.id + ' is unchanged before merging.')].join('\n');
}

export function buildItems(o: { tasks: TaskRecord[]; keys: Record<string, KeyRecord>; bank: string; turns: { headroom: string; pilot: string; calibration: string } }): Item[] {
  const byTemplate = new Map<string, { task: TaskRecord; key: PlanKey }>();
  for (const t of o.tasks) { const k = o.keys[t.id]; if (k?.family === 'plan') byTemplate.set(k.template, { task: t, key: k.key as PlanKey }); }
  const byTask = new Map([...byTemplate.values()].map((v) => [v.task.id, v]));
  const at = (template: string) => { const v = byTemplate.get(template); if (!v) throw new Error('no plan task for template ' + template); return v; };
  const items: Item[] = [];
  const replies = JSON.parse(readFileSync(join(o.bank, 'labelled', 'plan-replies.json'), 'utf8')) as Record<string, { good: string; bad: string }>;
  for (const [template, r] of Object.entries(replies)) {
    const { task, key } = at(template);
    items.push({ set: 'dev', id: 'dev-' + template + '-good', task_id: task.id, input: inputFor(task, key, r.good), truth: { outcome: true } });
    items.push({ set: 'dev', id: 'dev-' + template + '-bad', task_id: task.id, input: inputFor(task, key, r.bad), truth: { outcome: false } });
  }
  const probes = JSON.parse(readFileSync(join(o.bank, 'labelled', 'plan-probes.json'), 'utf8')) as Record<string, [string, string]>;
  for (const [template, [label, text]] of Object.entries(probes)) {
    const { task, key } = at(template);
    if (label === 'paraphrase-good') items.push({ set: 'dev', id: 'dev-' + template + '-probe', task_id: task.id, input: inputFor(task, key, text), truth: { outcome: true } });
    else if (label === 'violating') items.push({ set: 'nbb', id: 'nbb-' + template, task_id: task.id, input: inputFor(task, key, text), truth: { outcome: false } });
    else throw new Error('plan probe ' + template + ' has the unknown label ' + label);
  }
  for (const set of ['A', 'C'] as const) {
    const blind = JSON.parse(readFileSync(join(o.bank, 'plan-blind-' + set + '.json'), 'utf8')) as Array<{ template: string; text: string; constraints: Record<string, Verdict> }>;
    blind.forEach((b, i) => {
      const { task, key } = at(b.template);
      const ids = key.constraints.map((c) => c.id).sort();
      if (JSON.stringify(Object.keys(b.constraints).sort()) !== JSON.stringify(ids)) throw new Error('blind set ' + set + ' plan ' + i + ' labels other constraints than its key');
      const resp = Object.values(b.constraints).filter((v) => v === 'respected').length;
      items.push({ set, id: set + '-' + String(i + 1).padStart(3, '0'), task_id: task.id, input: inputFor(task, key, b.text), truth: { outcome: resp >= MIN_PLAN_CONSTRAINTS, constraints: b.constraints } });
    });
  }
  for (const { task, key } of [...byTemplate.values()].sort((a, b) => a.task.id.localeCompare(b.task.id))) items.push({ set: 'redteam', id: 'redteam-' + task.id, task_id: task.id, input: inputFor(task, key, redTeamPlan(key)), truth: { outcome: false } });
  type Turn = { trial_id: string; task_id: string; arm: string; model: string; rep: number; status: string; reply_text?: string };
  const pick = (file: string, arm: string, tasks: string[]) => jsonl<Turn>(file).filter((t) => t.arm === arm && t.rep === 1 && tasks.includes(t.task_id));
  const real = [...pick(o.turns.headroom, 'plain', REAL_TASKS), ...pick(o.turns.pilot, 'edition', ['plan-01']), ...pick(o.turns.calibration, 'edition', REAL_TASKS.slice(1))];
  for (const t of real) {
    if (t.status !== 'ok') throw new Error('real reply ' + t.trial_id + ' has status ' + t.status + '; only ok trials are labelled');
    const v = byTask.get(t.task_id)!;
    items.push({ set: 'real', id: 'real-' + t.trial_id, task_id: t.task_id, cell: (t.model.includes('opus') ? 'opus' : 'sol') + '-' + t.arm, input: inputFor(v.task, v.key, t.reply_text ?? '') });
  }
  const cells = new Map<string, number>();
  for (const i of items.filter((x) => x.set === 'real')) cells.set(i.cell!, (cells.get(i.cell!) ?? 0) + 1);
  if ([...cells.values()].length !== 4 || [...cells.values()].some((n) => n !== 10)) throw new Error('the real set needs 10 replies in each of 4 cells, got ' + JSON.stringify(Object.fromEntries(cells)));
  return items;
}

export const outFile = (priv: string, role: CalRole, set: SetName, rep: number) => join(priv, 'out', role + '-' + set + (rep === 2 ? '-r2' : '') + '-rubric-' + RUBRIC_SHA256.slice(0, 12) + '.jsonl');
const usageKey = (role: CalRole, set: SetName, rep: number) => role + ':' + set + (rep === 2 ? ':r2' : '') + ':' + RUN_ID;
const rowOf = (item: Item, j: FullJudgement): Row => ({ id: item.id, set: item.set, named: j.named, named_count: j.named_count, verdicts: j.verdicts, items: j.items.length, empty: j.empty, attempts: j.attempts, full: fullRule(j.named.length, j.named_count), resp2: j.named.length >= MIN_PLAN_CONSTRAINTS });

/** The outcome a labeller gave a real reply: the full rule on its labels. */
const labelOutcome = (r: Row | undefined) => (r && !r.error ? r.full : undefined);

export function thirdPassIds(priv: string): string[] {
  const opus = new Map(jsonl<Row>(outFile(priv, 'label-opus', 'real', 1)).map((r) => [r.id, r]));
  const sol = new Map(jsonl<Row>(outFile(priv, 'label-sol', 'real', 1)).map((r) => [r.id, r]));
  return [...opus.keys()].filter((id) => sol.has(id) && labelOutcome(opus.get(id)) !== labelOutcome(sol.get(id)));
}

async function run(o: { priv: string; pub: string; role: CalRole; set: SetName; rep: number; concurrency: number }): Promise<number> {
  if (o.role.startsWith('label') && o.set !== 'real') { console.error('judge-calibration: the labellers label the real set only'); return 2; }
  const items = jsonl<Item>(join(o.priv, 'items.jsonl')).filter((i) => i.set === o.set);
  if (!items.length) { console.error('judge-calibration: no ' + o.set + ' items in ' + join(o.priv, 'items.jsonl') + '; run inputs first'); return 2; }
  const ledger = join(o.pub, 'ledger.sqlite');
  if (!existsSync(ledger)) { console.error('judge-calibration: ' + ledger + ' does not exist; run reserve first'); return 2; }
  const todoIds = o.role === 'label-third' ? new Set(thirdPassIds(o.priv)) : null;
  const out = outFile(o.priv, o.role, o.set, o.rep);
  mkdirSync(join(o.priv, 'out'), { recursive: true });
  const done = new Set(jsonl<Row>(out).filter((r) => !r.error).map((r) => r.id));
  const todo = items.filter((i) => !done.has(i.id) && (!todoIds || todoIds.has(i.id)));
  console.log('judge-calibration: ' + o.role + ' on ' + o.set + (o.rep === 2 ? ' (second run)' : '') + ': ' + todo.length + ' to grade, ' + done.size + ' already done, rubric ' + RUBRIC_SHA256.slice(0, 12));
  if (!todo.length) return 0;
  const spec = specOf(o.role);
  process.chdir(ROOT);
  const proxy = await RunProxy.start({ runId: RUN_ID, runDir: o.pub, ledgerPath: ledger, leaseUsd: LEASE_USD, allowModels: [modelId(ROLES.primary), modelId(ROLES.secondary)], maxOutputTokens: 128_000, reachableFromContainers: false });
  const slot = 'cal-' + o.role, key = usageKey(o.role, o.set, o.rep), token = key + '.' + sha256(String(Math.random()) + Date.now()).slice(0, 32);
  let stopped = false, failed = 0;
  try {
    await proxy.bind(slot, key, token, [modelId(spec)]);
    const ep = { baseUrl: proxy.baseUrlFor(slot, spec.provider, false), token };
    let next = 0;
    const worker = async () => {
      while (!stopped && next < todo.length) {
        const item = todo[next++]!;
        try { appendFileSync(out, JSON.stringify(rowOf(item, await judgeWith(spec, item.input, ep))) + '\n'); } catch (e) {
          if (e instanceof CapStop) { stopped = true; console.error('judge-calibration: cap refusal; the run stops and nothing is retried: ' + e.message); return; }
          failed++;
          appendFileSync(out, JSON.stringify({ id: item.id, set: item.set, error: (e as Error).message.slice(0, 500) }) + '\n');
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, o.concurrency) }, worker));
    await proxy.finalize(key).catch(() => null);
    await proxy.unbind(slot);
  } finally { await proxy.stop(); }
  const lines = proxy.usageLines(key);
  const usd = lines.reduce((s, l) => s + (l.actual_usd ?? (l.charged_reservation ? l.reserved_usd ?? 0 : 0)), 0);
  console.log('judge-calibration: ' + o.role + ' on ' + o.set + ': ' + (todo.length - failed) + ' graded, ' + failed + ' failed after retries, ' + lines.length + ' metered calls, $' + usd.toFixed(4) + (stopped ? ', CAP STOP' : ''));
  return stopped ? 3 : failed ? 1 : 0;
}

const pct = (k: number, n: number) => (n ? Math.round((1000 * k) / n) / 10 : null);
export function wilson(k: number, n: number, z = 1.959964): [number, number] {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

function report(priv: string, pub: string) {
  const items = jsonl<Item>(join(priv, 'items.jsonl'));
  const rows = (role: CalRole, set: SetName, rep = 1) => new Map(jsonl<Row>(outFile(priv, role, set, rep)).filter((r) => !r.error).map((r) => [r.id, r]));
  const real = items.filter((i) => i.set === 'real');
  const lo = rows('label-opus', 'real'), ls = rows('label-sol', 'real'), l3 = rows('label-third', 'real');
  const reference = new Map<string, { outcome: boolean; constraints: Record<string, Verdict>; by: string }>();
  for (const i of real) {
    const a = lo.get(i.id), b = ls.get(i.id);
    if (!a || !b) continue;
    if (a.full === b.full) reference.set(i.id, { outcome: a.full, constraints: Object.fromEntries(Object.keys(a.verdicts).filter((c) => a.verdicts[c] === b.verdicts[c]).map((c) => [c, a.verdicts[c]!])), by: 'agreed' });
    else if (l3.has(i.id)) reference.set(i.id, { outcome: l3.get(i.id)!.full, constraints: l3.get(i.id)!.verdicts, by: 'third' });
  }
  const usage = jsonl<UsageLine>(join(pub, 'proxy-usage.ndjson'));
  const cost = (prefix: string) => {
    const ls = usage.filter((u) => u.key.startsWith(prefix));
    const usd = ls.reduce((s, l) => s + (l.actual_usd ?? (l.charged_reservation ? l.reserved_usd ?? 0 : 0)), 0);
    const first = ls.slice(0, 10), inTok = first.reduce((s, l) => s + (l.input_tokens ?? 0), 0), cached = first.reduce((s, l) => s + (l.cached_tokens ?? 0), 0);
    return { calls: ls.length, usd: Math.round(usd * 1e6) / 1e6, first10_input_tokens: inTok, first10_cached_tokens: cached, first10_cached_share: inTok ? Math.round((1000 * cached) / inTok) / 1000 : null };
  };
  const judge = (role: 'primary' | 'secondary') => {
    const out: Record<string, unknown> = {};
    const graded = (set: SetName) => rows(role, set);
    const blind = (set: 'A' | 'C') => {
      const r = graded(set), its = items.filter((i) => i.set === set);
      let agree = 0, cAgree = 0, cN = 0, missing = 0;
      for (const i of its) {
        const g = r.get(i.id); if (!g) { missing++; continue; }
        if (g.resp2 === i.truth!.outcome) agree++;
        for (const [c, v] of Object.entries(i.truth!.constraints!)) { cN++; if ((v === 'respected') === (g.verdicts[c] === 'respected')) cAgree++; }
      }
      return { n: its.length, agree, missing, gate: GATES[set], pass: agree >= GATES[set] && !missing, constraints: cN, constraints_agree: cAgree };
    };
    const allFail = (set: 'nbb' | 'redteam') => { const r = graded(set), its = items.filter((i) => i.set === set); const failed = its.filter((i) => r.get(i.id) && !r.get(i.id)!.full).length; return { n: its.length, failed, gate: GATES[set], pass: failed === GATES[set] && its.length === GATES[set] }; };
    const r1 = graded('real'), r2 = rows(role, 'real', 2);
    const vs = (ref: (id: string) => boolean | undefined) => { let n = 0, agree = 0; for (const i of real) { const t = ref(i.id), g = r1.get(i.id); if (t === undefined || !g) continue; n++; if (g.full === t) agree++; } return { n, agree }; };
    const refAgree = vs((id) => reference.get(id)?.outcome);
    let cN = 0, cAgree = 0;
    for (const i of real) { const ref = reference.get(i.id), g = r1.get(i.id); if (!ref || !g) continue; for (const [c, v] of Object.entries(ref.constraints)) { cN++; if (g.verdicts[c] === v) cAgree++; } }
    const otherFamily = role === 'primary' ? ls : lo;
    out.real = { replies: real.length, ...refAgree, gate: GATES.real, pass: refAgree.n === real.length && refAgree.agree >= GATES.real, constraints: cN, constraints_agree: cAgree, vs_other_family_labeller: { labeller: role === 'primary' ? 'label-sol' : 'label-opus', ...vs((id) => labelOutcome(otherFamily.get(id))) } };
    out.A = blind('A'); out.C = blind('C'); out.nbb = allFail('nbb'); out.redteam = allFail('redteam');
    const retest = real.filter((i) => r1.has(i.id) && r2.has(i.id));
    out.retest = { n: retest.length, same_outcome: retest.filter((i) => r1.get(i.id)!.full === r2.get(i.id)!.full).length };
    const dev = graded('dev'), devItems = items.filter((i) => i.set === 'dev');
    out.dev = { n: devItems.length, graded: devItems.filter((i) => dev.has(i.id)).length, agree: devItems.filter((i) => dev.get(i.id) && dev.get(i.id)!.full === i.truth!.outcome).length };
    const c = cost(role + ':'), gradesMade = SETS.reduce((s, set) => s + [...graded(set).values()].filter((g) => !g.empty).length, 0) + [...r2.values()].filter((g) => !g.empty).length;
    out.cost = { ...c, grades: gradesMade, usd_per_grade: gradesMade ? Math.round((c.usd / gradesMade) * 1e6) / 1e6 : null };
    out.passes_every_gate = ['real', 'A', 'C', 'nbb', 'redteam'].every((k) => (out[k] as { pass: boolean }).pass);
    return out;
  };
  const cells = [...new Set(real.map((i) => i.cell!))].sort();
  const agreement = {
    run_id: RUN_ID, rubric_sha256: RUBRIC_SHA256, generated_at: new Date().toISOString(),
    labellers: {
      real: real.length, both_labelled: real.filter((i) => lo.has(i.id) && ls.has(i.id)).length,
      outcome_agree: real.filter((i) => lo.has(i.id) && ls.has(i.id) && lo.get(i.id)!.full === ls.get(i.id)!.full).length,
      third_pass: real.filter((i) => reference.get(i.id)?.by === 'third').length, unresolved: real.length - reference.size,
      reference_pass: [...reference.values()].filter((r) => r.outcome).length,
      reference_pass_by_cell: Object.fromEntries(cells.map((c) => [c, real.filter((i) => i.cell === c && reference.get(i.id)?.outcome).length])),
      cost: { 'label-opus': cost('label-opus:'), 'label-sol': cost('label-sol:'), 'label-third': cost('label-third:') },
    },
    primary: judge('primary'), secondary: judge('secondary'),
  };
  writeFileSync(join(pub, 'agreement.json'), JSON.stringify(agreement, null, 2) + '\n');
  writeFileSync(join(priv, 'report-detail.json'), JSON.stringify({ reference: Object.fromEntries(reference) }, null, 2) + '\n');
  return agreement;
}

export function band(headroom: string) {
  const turns = new Map(jsonl<{ trial_id: string; task_id: string; family: string; model: string }>(join(headroom, 'turns.jsonl')).map((t) => [t.trial_id, t]));
  const grades: Array<{ trial_id: string; success: boolean; grader: string }> = [];
  for (const s of readdirSync(join(headroom, 'shards')).sort()) grades.push(...jsonl<{ trial_id: string; success: boolean; grader: string }>(join(headroom, 'shards', s, 'band-grades.jsonl')));
  const models: Record<string, unknown> = {};
  for (const m of ['anthropic:claude-opus-5-5', 'openai:gpt-6.1-sol']) {
    const g = grades.filter((x) => turns.get(x.trial_id)?.model === m && turns.get(x.trial_id)?.family === 'plan');
    const k = g.filter((x) => x.success).length, n = g.length, [lo, hi] = wilson(k, n);
    models[m] = { n, success: k, rate: n ? k / n : null, wilson95: [lo, hi], in_band: n === 24 && k / n >= 0.15 && k / n <= 0.75, graders: [...new Set(g.map((x) => x.grader))] };
  }
  return { band: [0.15, 0.75], plan_tasks: 24, models, all_in_band: Object.values(models).every((m) => (m as { in_band: boolean }).in_band) };
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const flag = (n: string) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
  const need = (n: string) => { const v = flag(n); if (!v) { console.error('judge-calibration ' + cmd + ': ' + n + ' is required'); process.exit(2); } return resolve(v); };
  if (cmd === 'reserve') {
    const pub = need('--public'), rep = need('--replicate-to');
    if (existsSync(join(pub, 'ledger.sqlite'))) { console.error('judge-calibration: ' + join(pub, 'ledger.sqlite') + ' exists; the reserve was written once'); return 2; }
    const commit = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    mkdirSync(pub, { recursive: true });
    const r = spawnSync('python3', [join(ROOT, 'scripts', 'ubicloud', 'stage_ledger.py'), 'launch', ROOT, commit, BENCH + '/design.json', rep, pub, String(LEASE_USD), '0', '', '--stage', 'main'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', PYTHONDONTWRITEBYTECODE: '1' } });
    if (r.status !== 0) { console.error(r.stderr.trim()); return 2; }
    BudgetRun.openLease({ runId: RUN_ID, leaseUsd: LEASE_USD, ledgerPath: join(pub, 'ledger.sqlite'), maxOutputTokens: 128_000, runner: 'metering-proxy' });
    console.log('judge-calibration: reserve ' + r.stdout.trim() + ' of $' + LEASE_USD + ' in ' + join(rep, 'stage-ledger.jsonl') + ' (stage main); lease ' + RUN_ID + ' opened on ' + join(pub, 'ledger.sqlite'));
    return 0;
  }
  if (cmd === 'inputs') {
    const priv = need('--private'), tasksDir = need('--tasks-dir');
    const items = buildItems({ tasks: JSON.parse(readFileSync(join(tasksDir, 'tasks.json'), 'utf8')), keys: JSON.parse(readFileSync(join(tasksDir, 'keys.json'), 'utf8')), bank: need('--bank'), turns: { headroom: join(ROOT, BENCH, 'headroom', 'turns.jsonl'), pilot: join(ROOT, BENCH, 'pilot', 'turns.jsonl'), calibration: need('--calibration-turns') } });
    mkdirSync(priv, { recursive: true });
    writeFileSync(join(priv, 'items.jsonl'), items.map((i) => JSON.stringify(i)).join('\n') + '\n');
    const counts = Object.fromEntries(SETS.map((s) => [s, items.filter((i) => i.set === s).length]));
    console.log('judge-calibration: items ' + JSON.stringify(counts) + ', ' + items.filter((i) => !i.input.final_answer.trim()).length + ' empty after extraction');
    return 0;
  }
  if (cmd === 'run') {
    const role = flag('--role') as CalRole, set = flag('--set') as SetName, rep = Number(flag('--rep') ?? 1);
    if (!CAL_ROLES.includes(role) || !SETS.includes(set) || ![1, 2].includes(rep)) { console.error('judge-calibration run: --role ' + CAL_ROLES.join('|') + ' --set ' + SETS.join('|') + ' [--rep 2]'); return 2; }
    return run({ priv: need('--private'), pub: need('--public'), role, set, rep, concurrency: Number(flag('--concurrency') ?? 4) });
  }
  if (cmd === 'report') { console.log(JSON.stringify(report(need('--private'), need('--public')), null, 2)); return 0; }
  if (cmd === 'band') { const b = band(need('--headroom')); writeFileSync(need('--out'), JSON.stringify(b, null, 2) + '\n'); console.log(JSON.stringify(b, null, 2)); return 0; }
  console.error('usage: bun harnesses/qm/gstack/judge-calibration.ts reserve|inputs|run|report|band ...');
  return 2;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
