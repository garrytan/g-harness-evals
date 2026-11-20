#!/usr/bin/env bun
// The R111 pilot gate of the skills-at-scale eval (Garry, 2026-11-19): before an arm's counted run, a pilot of at most a
// tenth of its budget must show on that arm's own outputs that
//   (a) the part under test ran: native arms list skills in the captured request (saw-skill.json lists at least one skill)
//       on at least 95% of trials; resolver arms put a resolver block into a captured request on at least 95% of their
//       skill-request trials (every trial when no --requests file is given);
//   (b) its judge passes R78: the judge that scores the arm's model (Opus for OpenAI models, Astra for the rest) has a kappa
//       of at least 0.6 on at least 40 labelled outputs, read from adjudicate.ts gold-check's file;
//   (c) the requests can be supplied: at least 95% of the planned pilot trials reached the model (no infra stop, usage
//       recorded);
//   and, when the arm's budget is given, the pilot spent no more than a tenth of it.
// Per harness it also reports the share of pilot trials flags.ts flagged for settling by hand (internal-task, 2026-11-19: #491's cd
// handling has known gaps and the fix PR was dropped); a harness above FLAG_RATE_MAX (2%) fails with "fix PR needed before
// this harness's counted run", and so does one with no flagged.jsonl supplied.
// An arm is a cell (harness, model, skill arm, rung). A failing arm is named, and the gate exits 1; it is fixed or left out
// and reported as left out (R111), never a dropped arm (R71).
//
// Separate judge stage (internal-task's reading, 2026-11-19): when a tenth of an arm's budget cannot buy R78's 40 labelled
// outputs (--arm-usd / 10 < 40 x --judge-usd-per-output), or with --judge-stage separate, the arm's pilot checks only (a)
// and (c), and the judge check is its own stage, sized to R78, read from its own file (--judge-check). That stage must pass
// before any counted session: while it has not, the gate exits 1 naming judge-stage.
//
//   bun scripts/skills-at-scale/pilot-gate.ts --results <pilot results dir> --planned <{cell: trials}.json>
//       --judge-check <judge-check.json> --flagged <flagged.jsonl> [--requests <setl.jsonl>...] [--arm-usd <{cell: usd}.json>]
//       [--judge-usd-per-output 0.05] [--judge-stage pilot|separate] [--out <gate.json>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { JUDGES, judgeFor, loadScaleTrials, type GoldCheck, type Request, type ScaleTrial } from './analyze.ts';
import type { FlaggedRow } from './flags.ts';

export const PART_RAN_MIN = 0.95;
export const SUPPLY_MIN = 0.95;
export const R78_OUTPUTS = 40;
export const R78_KAPPA = 0.6;
export const PILOT_SHARE = 0.1;
export const FLAG_RATE_MAX = 0.02;
export const FLAG_FAIL = "fix PR needed before this harness's counted run";

type Check = { pass: boolean; detail: string };
const share = (x: number, n: number) => (n ? x / n : 0);
const pct = (x: number) => (100 * x).toFixed(1) + '%';

function judgeCheck(check: GoldCheck | null, model: string): Check {
  const source = JUDGES[judgeFor(model)];
  if (!check) return { pass: false, detail: 'no judge-check result for ' + source };
  const kappa = check.sources[source]?.kappa ?? null;
  const pass = check.n_gold >= R78_OUTPUTS && kappa !== null && kappa >= R78_KAPPA;
  return { pass, detail: source + ' kappa ' + kappa + ' on ' + check.n_gold + ' labelled outputs (needs ' + R78_KAPPA + ' on ' + R78_OUTPUTS + ')' };
}

export function pilotGate(o: { trials: ScaleTrial[]; planned: Record<string, number>; judgeCheck: GoldCheck | null; requests?: Request[] | null; armUsd?: Record<string, number> | null;
  judgeUsdPerOutput?: number | null; judgeStage?: 'pilot' | 'separate' | null; flagged?: Pick<FlaggedRow, 'trial_id' | 'flags'>[] | null }) {
  const kind = new Map((o.requests ?? []).map((r) => [r.id, r.kind]));
  const cells = [...new Set([...Object.keys(o.planned), ...o.trials.map((t) => t.cell)])].sort();
  const separateFor = (cell: string) => o.judgeStage === 'separate' || (o.judgeStage !== 'pilot' && o.armUsd?.[cell] !== undefined && o.judgeUsdPerOutput != null && o.armUsd[cell]! * PILOT_SHARE < R78_OUTPUTS * o.judgeUsdPerOutput);
  const arms = cells.map((cell) => {
    const ts = o.trials.filter((t) => t.cell === cell);
    const arm = ts[0]?.arm ?? null, model = ts[0]?.model ?? null;
    let part: Check;
    if (!ts.length) part = { pass: false, detail: 'no pilot trials' };
    else if (arm === 'native') {
      const n = ts.filter((t) => t.saw && t.saw.described.length + t.saw.name_only.length > 0).length;
      part = { pass: share(n, ts.length) >= PART_RAN_MIN, detail: 'native listing captured on ' + n + ' of ' + ts.length + ' trials (' + pct(share(n, ts.length)) + ')' };
    } else {
      const side = o.requests ? ts.filter((t) => kind.get(t.task) === 'skill') : ts;
      const n = side.filter((t) => t.turns.some((u) => u.block && u.injected)).length;
      part = { pass: side.length > 0 && share(n, side.length) >= PART_RAN_MIN, detail: 'resolver block in a captured request on ' + n + ' of ' + side.length + (o.requests ? ' skill-request' : '') + ' trials (' + pct(share(n, side.length)) + ')' };
    }
    const planned = o.planned[cell] ?? 0;
    const reached = ts.filter((t) => !t.infra.length && t.usage && t.usage.input_tokens > 0).length;
    const supply: Check = planned > 0 ? { pass: share(reached, planned) >= SUPPLY_MIN, detail: reached + ' of ' + planned + ' planned trials reached the model (' + pct(share(reached, planned)) + ')' } : { pass: false, detail: 'no planned pilot size' };
    const separate = separateFor(cell);
    const judge: Check | 'separate stage' = separate ? 'separate stage' : model ? judgeCheck(o.judgeCheck, model) : { pass: false, detail: 'no model' };
    const spent = ts.reduce((s, t) => s + (t.usage?.usd ?? 0), 0);
    const budget = o.armUsd?.[cell];
    const tenth: Check | null = budget === undefined ? null : { pass: spent <= budget * PILOT_SHARE + 1e-9, detail: '$' + spent.toFixed(2) + ' spent of a $' + (budget * PILOT_SHARE).toFixed(2) + ' pilot tenth' };
    const failing = [...(part.pass ? [] : ['part_ran']), ...(judge === 'separate stage' || judge.pass ? [] : ['judge']), ...(supply.pass ? [] : ['supply']), ...(tenth && !tenth.pass ? ['pilot_tenth'] : [])];
    return { arm: cell, skill_arm: arm, model, part_ran: part, judge, supply, pilot_tenth: tenth, pass: !failing.length, failing };
  });
  const needStage = arms.some((a) => a.judge === 'separate stage');
  const stage = needStage ? { required: true, models: [...new Set(arms.filter((a) => a.judge === 'separate stage' && a.model).map((a) => a.model!))].sort().map((m) => ({ model: m, ...judgeCheck(o.judgeCheck, m) })) } : { required: false, models: [] };
  const stagePass = !needStage || stage.models.every((m) => m.pass);
  const flaggedIds = new Set((o.flagged ?? []).map((f) => f.trial_id));
  const harnesses = [...new Set(o.trials.map((t) => t.harness))].sort().map((h) => {
    const ts = o.trials.filter((t) => t.harness === h);
    const n = ts.filter((t) => flaggedIds.has(t.id)).length;
    const rate = share(n, ts.length);
    const pass = !!o.flagged && rate <= FLAG_RATE_MAX;
    return { harness: h, trials: ts.length, flagged: n, flag_rate: Number(rate.toFixed(4)), pass,
      detail: !o.flagged ? 'no flagged.jsonl supplied; ' + FLAG_FAIL : n + ' of ' + ts.length + ' pilot trials flagged (' + pct(rate) + ', limit ' + pct(FLAG_RATE_MAX) + ')' + (pass ? '' : '; ' + FLAG_FAIL) };
  });
  return { schema: 'he-skills-at-scale-pilot-gate/1', arms, harnesses, judge_stage: { ...stage, pass: stagePass },
    failing: [...arms.filter((a) => !a.pass).map((a) => a.arm), ...harnesses.filter((h) => !h.pass).map((h) => 'harness:' + h.harness), ...(stagePass ? [] : ['judge-stage'])],
    pass: arms.every((a) => a.pass) && harnesses.every((h) => h.pass) && stagePass };
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; };
  const all = (k: string) => a.flatMap((x, i) => (x === '--' + k && a[i + 1] ? [a[i + 1]!] : []));
  const json = (k: string) => (v(k) ? JSON.parse(readFileSync(v(k)!, 'utf8')) : null);
  const readJsonl = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const stage = v('judge-stage');
  if (!v('results') || !v('planned') || (stage && stage !== 'pilot' && stage !== 'separate')) {
    console.error('usage: pilot-gate.ts --results <dir> --planned <json> --judge-check <json> --flagged <jsonl> [--requests <jsonl>...] [--arm-usd <json>] [--judge-usd-per-output <usd>] [--judge-stage pilot|separate] [--out <json>]');
    process.exit(2);
  }
  try {
    const g = pilotGate({ trials: loadScaleTrials(v('results')!), planned: json('planned'), judgeCheck: v('judge-check') && existsSync(v('judge-check')!) ? json('judge-check') : null,
      requests: all('requests').length ? all('requests').flatMap(readJsonl) : null, armUsd: json('arm-usd'), judgeUsdPerOutput: v('judge-usd-per-output') ? Number(v('judge-usd-per-output')) : null, judgeStage: (stage as 'pilot' | 'separate' | undefined) ?? null,
      flagged: v('flagged') && existsSync(v('flagged')!) ? readJsonl(v('flagged')!) : null });
    if (v('out')) { mkdirSync(dirname(v('out')!), { recursive: true }); writeFileSync(v('out')!, JSON.stringify(g, null, 1) + '\n'); }
    const word = (c: { pass: boolean } | string | null) => (c === null ? '-' : typeof c === 'string' ? 'stage' : c.pass ? 'pass' : 'FAIL');
    for (const x of g.arms) console.log('PILOT_GATE arm=' + x.arm + ' part_ran=' + word(x.part_ran) + ' judge=' + word(x.judge) + ' supply=' + word(x.supply) + ' pilot_tenth=' + word(x.pilot_tenth) + ' ' + (x.pass ? 'PASS' : 'FAIL (' + x.failing.join(', ') + ')'));
    for (const h of g.harnesses) console.log('PILOT_GATE harness=' + h.harness + ' flag_rate=' + h.flag_rate + ' ' + (h.pass ? 'PASS' : 'FAIL') + ': ' + h.detail);
    if (g.judge_stage.required) for (const m of g.judge_stage.models) console.log('JUDGE_STAGE model=' + m.model + ' ' + (m.pass ? 'PASS' : 'FAIL') + ': ' + m.detail + (m.pass ? '' : '; no counted session may start'));
    console.log('PILOT_GATE_RESULT ' + (g.pass ? 'PASS' : 'FAIL failing=' + g.failing.join(',')));
    process.exit(g.pass ? 0 : 1);
  } catch (e) { console.error((e as Error).message.startsWith('HE-') ? (e as Error).message : 'HE-SCALE-PILOT-000 ' + (e as Error).message); process.exit(2); }
}
