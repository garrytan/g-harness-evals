#!/usr/bin/env bun
// Builds new review arms from plain review sessions, for internal-task (does gstack's code review catch real bugs better than a
// plain review prompt?; plan "Arms", Big decision E). Input and output are arms in gstack-evals' noloss arm contract v1,
// as the review rig writes them (src/trial/review/run.ts and cost.ts at gstack-evals 91d76421): arm.json,
// findings/<unit>.jsonl and cost.tsv, no judgments.
//
//   bun scripts/review-bugs/merge-arms.ts --id <arm id> --label <text> --out <dir> --rule pass|window [--window <n>]
//       --source <arm dir>[:<first pass>-<last pass>] [--source ...] [--date <YYYY-MM-DD>]
//
// Each --source contributes its passes first to last (all of them when no range is given), in the order given. One
// source pass is one review session per unit. The merged arm has its own passes:
//
// - --rule pass: every source gives the same number of passes P, and merged pass k is the union of every source's k-th
//   pass. plain-2fam is --rule pass --source <Opus plain arm>:1-2 --source <Sol plain arm>:1-2, so pass 1 is Opus pass
//   1 plus Sol pass 1, and pass 2 is Opus pass 2 plus Sol pass 2.
// - --rule window --window <n>: the sources' passes are numbered as sessions 1, 2, ... in order, and merged pass j is
//   the union of sessions (j-1)n+1 to jn. The session count must be a multiple of n. For plain-N the plan buys 8
//   plain sessions per unit: the plain arm's 2 passes (sessions 1 and 2) and the plain-8 arm's 6 (sessions 3 to 8), so
//   the sources are always --source <plain arm>:1-2 --source <plain-8 arm>:1-6, cut to the sessions a window needs:
//     plain-1: --window 1, sessions 1-2. Pass 1 = session 1, pass 2 = session 2 (the plain arm itself).
//     plain-2: --window 2, sessions 1-4. Pass 1 = sessions 1-2, pass 2 = sessions 3-4.
//     plain-4: --window 4, sessions 1-8. Pass 1 = sessions 1-4, pass 2 = sessions 5-8.
//     plain-8: --window 8, sessions 1-8. One pass: sessions 1-8. Two passes of 8 would need 16 sessions per unit and
//       the plan buys 8, so plain-8 is scored on 1 pass while every other arm has 2.
//   The windows of plain-1, plain-2 and plain-4 are disjoint, so each keeps 2 passes.
//
// What the merged arm holds:
// - Findings: every finding of the merged sessions, with every original field kept. pass becomes the merged pass, id
//   becomes s<source number>.<source arm id>.p<source pass>.<original id> (unique, and traceable to its session), and
//   merged_from records the source number, arm id, pass and original id.
// - Coverage: a merged unit-pass is a coverage gap when any of its sessions is a gap in its source, or did not run (no
//   all-scope row in the source's cost.tsv). Its gap reads "<unit> pass <j>: source <n> (<arm id>) pass <k>: <reason>",
//   the form noloss derive --drop-gaps reads. status is stopped when there is any gap or any source is stopped.
// - Cost: one row per unit, merged pass and scope, summing each column over the merged sessions' rows of that scope; a
//   column is unavailable when any summed row has it unknown, and an all row is unavailable when a session has no all
//   row. Rows of one scope must share a meter_source, which is kept. sessions counts the rows summed.
// - arm.json: contract_version 1, the sources' suite (and suite_sha256), the union of their models and severity maps,
//   and merge: the rule, each source (dir relative to the output's parent, arm id, the passes used, and the sha256 of its
//   arm.json, cost.tsv and every findings file) and the merged pass map.
//
// Refusals exit 2 with a stable code and the file: E_MERGE_SOURCE (not a raw arm contract v1 directory),
// E_MERGE_UNIT (a source has no findings file for a unit another source has, or that its own cost.tsv or coverage gaps
// name), E_MERGE_PASS (a pass out of range,
// sessions that do not fill the rule), E_MERGE_SUITE (sources on different suites), E_MERGE_COST, E_MERGE_GAP,
// E_MERGE_SEVMAP (two sources map one label differently) and E_MERGE_ARGS.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ARM_ID, ArmError, COST_NUMBERS, MAX_PASSES, readArm, unitRefs, type Arm, type ArmJson, type CostNumber, type CostRow, type SeverityEntry } from './arm.ts';

export interface SourceSpec {
  dir: string;
  first?: number;
  last?: number;
}

export interface MergeOptions {
  id: string;
  label: string;
  out: string;
  rule: 'pass' | 'window';
  window?: number;
  sources: SourceSpec[];
  date?: string;
}

export interface Slot {
  /** 1-based source number. */
  source: number;
  pass: number;
}

export const COST_COLUMNS = ['pr', 'scope', 'pass', 'total_tokens', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'usd', 'wall_seconds', 'meter_source', 'requests', 'refused', 'unknown_calls', 'sessions'] as const;

const fail = (kind: string, where: string, detail: string): never => {
  throw new ArmError('E_MERGE_' + kind, where, detail);
};

/** The merged pass map: entry j-1 lists the sessions of merged pass j, in order. */
export function passMap(rule: 'pass' | 'window', window: number | undefined, ranges: ReadonlyArray<{ source: number; first: number; last: number; where: string }>): Slot[][] {
  const passesOf = (r: (typeof ranges)[number]) => Array.from({ length: r.last - r.first + 1 }, (_, i) => ({ source: r.source, pass: r.first + i }));
  if (rule === 'pass') {
    if (window !== undefined) fail('ARGS', '--window', 'takes --rule window');
    const n = ranges[0]!.last - ranges[0]!.first + 1;
    for (const r of ranges) if (r.last - r.first + 1 !== n) fail('PASS', r.where, 'gives ' + (r.last - r.first + 1) + ' passes; --rule pass needs every source to give the same number (' + n + ')');
    return Array.from({ length: n }, (_, k) => ranges.map((r) => ({ source: r.source, pass: r.first + k })));
  }
  if (window === undefined || !Number.isSafeInteger(window) || window < 1) return fail('ARGS', '--window', '--rule window needs --window <n>, a whole number from 1');
  const sessions = ranges.flatMap(passesOf);
  if (sessions.length % window) fail('PASS', ranges.at(-1)!.where, 'the sources give ' + sessions.length + ' sessions per unit, not a multiple of --window ' + window);
  return Array.from({ length: sessions.length / window }, (_, j) => sessions.slice(j * window, (j + 1) * window));
}

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (k: CostNumber, v: number) => (k === 'usd' ? v.toFixed(6) : k === 'wall_seconds' ? String(Math.round(v * 10) / 10) : String(v));

export function mergeArms(o: MergeOptions): { dir: string; arm: ArmJson; findings: number; gaps: string[] } {
  if (!ARM_ID.test(o.id)) fail('ARGS', '--id', JSON.stringify(o.id) + ' does not match ' + ARM_ID);
  if (!o.label) fail('ARGS', '--label', 'missing');
  if (!o.sources.length) fail('ARGS', '--source', 'give at least one source arm');
  if (o.rule !== 'pass' && o.rule !== 'window') fail('ARGS', '--rule', JSON.stringify(o.rule) + ' is not pass or window');
  const date = o.date ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('ARGS', '--date', JSON.stringify(date) + ' is not YYYY-MM-DD');
  const out = resolve(o.out);
  if (existsSync(out) && readdirSync(out).length) fail('ARGS', out, 'is not empty; write each merged arm to a new directory');

  const arms: Arm[] = o.sources.map((s) => readArm(resolve(s.dir), 'E_MERGE'));
  const first = arms[0]!;
  for (const a of arms.slice(1)) {
    if (a.arm.suite !== first.arm.suite) fail('SUITE', join(a.dir, 'arm.json'), 'suite ' + a.arm.suite + ' is not ' + first.arm.suite + ', the suite of ' + join(first.dir, 'arm.json'));
  }
  const digests = [...new Set(arms.map((a) => a.arm.suite_sha256).filter((d): d is string => typeof d === 'string'))];
  if (digests.length > 1) fail('SUITE', join(arms.find((a) => a.arm.suite_sha256 === digests[1])!.dir, 'arm.json'), 'suite_sha256 ' + digests[1] + ' is not ' + digests[0] + '; the sources ran on different revisions of suite ' + first.arm.suite);

  const units = [...new Set(arms.flatMap((a) => [...a.findings.keys()]))].sort();
  for (const a of arms) for (const u of units) if (!a.findings.has(u)) fail('UNIT', join(a.dir, 'findings', u + '.jsonl'), 'missing: another source has unit ' + u + ', and every source must cover the same units');

  const ranges = o.sources.map((s, i) => {
    const a = arms[i]!;
    const where = join(a.dir, 'arm.json');
    const r = { source: i + 1, first: s.first ?? 1, last: s.last ?? a.arm.passes, where };
    if (!Number.isSafeInteger(r.first) || !Number.isSafeInteger(r.last) || r.first < 1 || r.last < r.first) fail('PASS', where, 'pass range ' + r.first + '-' + r.last + ' is not first-last with 1 <= first <= last');
    if (r.last > a.arm.passes) fail('PASS', where, 'pass ' + r.last + ' is out of range: arm ' + a.arm.id + ' has passes 1 to ' + a.arm.passes);
    return r;
  });
  const seen = new Set<string>();
  for (const r of ranges)
    for (let p = r.first; p <= r.last; p++) {
      const key = arms[r.source - 1]!.dir + ' ' + p;
      if (seen.has(key)) fail('PASS', r.where, 'pass ' + p + ' is given twice; each session may be merged once');
      seen.add(key);
    }
  const map = passMap(o.rule, o.window, ranges);
  if (map.length > MAX_PASSES) fail('PASS', '--source', 'the merged arm would have ' + map.length + ' passes; arm contract v1 allows ' + MAX_PASSES);

  const severity: SeverityEntry = {};
  const put = (target: Record<string, string>, label: string, value: string, where: string) => {
    if (label in target && target[label] !== value) fail('SEVMAP', where, 'maps ' + JSON.stringify(label) + ' to ' + value + ', and an earlier source maps it to ' + target[label]);
    target[label] = value;
  };
  for (const a of arms) {
    const m = a.arm.severity_map;
    if (!m) continue;
    const where = join(a.dir, 'arm.json');
    for (const [label, v] of Object.entries(m.default ?? {})) put((severity.default ??= {}), label, v, where);
    for (const [reader, entries] of Object.entries(m.by_reader ?? {})) for (const [label, v] of Object.entries(entries)) put(((severity.by_reader ??= {})[reader] ??= {}), label, v, where);
  }

  const refs = unitRefs(arms);
  const gaps: string[] = [];
  const findingLines = new Map<string, string[]>();
  const costRows: string[][] = [];
  let count = 0;
  for (const u of units) {
    const ref = refs.get(u) ?? u;
    const lines: string[] = [];
    map.forEach((slots, j) => {
      const pass = j + 1;
      for (const s of slots) {
        const a = arms[s.source - 1]!;
        for (const g of a.gaps) if (g.unit === u && g.pass === s.pass) gaps.push(ref + ' pass ' + pass + ': source ' + s.source + ' (' + a.arm.id + ') pass ' + s.pass + ': ' + g.reason);
        if (!a.cost.some((r) => r.unit === u && r.pass === s.pass && r.scope === 'all')) gaps.push(ref + ' pass ' + pass + ': source ' + s.source + ' (' + a.arm.id + ') pass ' + s.pass + ' did not run (no all-scope row in its cost.tsv)');
        for (const f of a.findings.get(u)!) {
          if (f.pass !== s.pass) continue;
          lines.push(JSON.stringify({ ...f.fields, pass, id: 's' + s.source + '.' + a.arm.id + '.p' + s.pass + '.' + f.id, merged_from: { source: s.source, arm: a.arm.id, pass: s.pass, id: f.id } }));
          count++;
        }
      }
      const scopes = [...new Set(slots.flatMap((s) => arms[s.source - 1]!.cost.filter((r) => r.unit === u && r.pass === s.pass).map((r) => r.scope)))];
      scopes.sort((x, y) => (x === 'all' ? -1 : y === 'all' ? 1 : x < y ? -1 : x > y ? 1 : 0));
      if (!scopes.includes('all')) scopes.unshift('all');
      for (const scope of scopes) {
        const rows: CostRow[] = [];
        let missing = false;
        for (const s of slots) {
          const row = arms[s.source - 1]!.cost.find((r) => r.unit === u && r.pass === s.pass && r.scope === scope);
          if (row) rows.push(row);
          else if (scope === 'all') missing = true;
        }
        const meters = [...new Set(rows.map((r) => r.meter_source))];
        if (meters.length > 1) {
          const odd = rows.find((r) => r.meter_source !== meters[0])!;
          fail('COST', join(arms.find((a) => a.cost.includes(odd))!.dir, 'cost.tsv') + ' line ' + odd.line, 'meter_source ' + odd.meter_source + ' differs from ' + meters[0] + ' in another session of ' + ref + ' merged pass ' + pass + ' scope ' + scope + '; a summed row keeps one meter source');
        }
        const sum = (k: CostNumber) => {
          if (missing || !rows.length) return 'unavailable';
          let total = 0;
          for (const r of rows) {
            const v = r.values[k];
            if (v === null || v === undefined) return 'unavailable';
            total += v;
          }
          return fmt(k, total);
        };
        const cells: Record<string, string> = { pr: ref, scope, pass: String(pass), meter_source: meters[0] ?? (arms.flatMap((a) => a.cost).find((r) => r.scope === 'all')?.meter_source ?? 'estimate'), sessions: String(rows.length) };
        for (const k of COST_NUMBERS) cells[k] = sum(k);
        costRows.push(COST_COLUMNS.map((c) => cells[c]!));
      }
    });
    findingLines.set(u, lines);
  }

  const models: NonNullable<ArmJson['models']> = [];
  for (const a of arms) for (const m of a.arm.models ?? []) if (!models.some((x) => JSON.stringify(x) === JSON.stringify(m))) models.push(m);
  const status = gaps.length || arms.some((a) => a.arm.status === 'stopped') ? 'stopped' : 'complete';
  const ruleText = o.rule === 'pass'
    ? 'merged pass k is the union of every source\'s k-th pass'
    : 'the sources\' passes are sessions 1 to ' + map.length * o.window! + ' in source order, and merged pass j is the union of sessions (j-1)*' + o.window + '+1 to j*' + o.window;
  const arm: ArmJson = {
    contract_version: 1,
    id: o.id,
    label: o.label,
    suite: first.arm.suite,
    ...(digests.length ? { suite_sha256: digests[0] } : {}),
    date,
    passes: map.length,
    provenance: 'live',
    status,
    ...(gaps.length ? { coverage_gaps: gaps } : {}),
    ...(models.length ? { models } : {}),
    ...(severity.default || severity.by_reader ? { severity_map: severity } : {}),
    merge: {
      tool: 'harness-evals scripts/review-bugs/merge-arms.ts',
      rule: o.rule,
      ...(o.rule === 'window' ? { window: o.window } : {}),
      rule_text: ruleText,
      sources: arms.map((a, i) => ({
        source: i + 1,
        dir: relative(dirname(out), a.dir),
        arm_id: a.arm.id,
        label: a.arm.label,
        status: a.arm.status ?? 'complete',
        passes_used: [ranges[i]!.first, ranges[i]!.last],
        arm_json_sha256: a.armJsonSha256,
        cost_sha256: a.costSha256,
        findings_sha256: a.findingsSha256,
      })),
      pass_map: map.map((slots, j) => ({ pass: j + 1, sessions: slots.map((s) => ({ source: s.source, arm_id: arms[s.source - 1]!.arm.id, pass: s.pass })) })),
    },
  };

  mkdirSync(join(out, 'findings'), { recursive: true });
  for (const [u, lines] of findingLines) writeFileSync(join(out, 'findings', u + '.jsonl'), lines.map((l) => l + '\n').join(''));
  writeFileSync(join(out, 'cost.tsv'), [COST_COLUMNS.join('\t'), ...costRows.map((r) => r.join('\t'))].join('\n') + '\n');
  writeFileSync(join(out, 'arm.json'), JSON.stringify(arm, null, 2) + '\n');
  return { dir: out, arm, findings: count, gaps };
}

/** Parses <dir>[:<first>-<last>]. */
export function parseSource(spec: string): SourceSpec {
  const m = /^(.+?):(\d+)-(\d+)$/.exec(spec);
  return m ? { dir: m[1]!, first: Number(m[2]), last: Number(m[3]) } : { dir: spec };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flags = new Map<string, string[]>();
  try {
    for (let i = 0; i < args.length; i += 2) {
      const k = args[i]!;
      if (!['--id', '--label', '--out', '--rule', '--window', '--source', '--date'].includes(k) || args[i + 1] === undefined) fail('ARGS', k, 'unknown flag or missing value; usage: --id <arm id> --label <text> --out <dir> --rule pass|window [--window <n>] --source <arm dir>[:<first>-<last>]... [--date <YYYY-MM-DD>]');
      flags.set(k, [...(flags.get(k) ?? []), args[i + 1]!]);
    }
    const one = (k: string) => flags.get(k)?.at(-1);
    const r = mergeArms({
      id: one('--id') ?? fail('ARGS', '--id', 'missing'),
      label: one('--label') ?? fail('ARGS', '--label', 'missing'),
      out: one('--out') ?? fail('ARGS', '--out', 'missing'),
      rule: (one('--rule') ?? fail('ARGS', '--rule', 'missing')) as 'pass' | 'window',
      ...(one('--window') !== undefined ? { window: Number(one('--window')) } : {}),
      sources: (flags.get('--source') ?? []).map(parseSource),
      ...(one('--date') ? { date: one('--date') } : {}),
    });
    console.log('merge-arms: wrote ' + r.arm.id + ' (' + r.arm.passes + ' passes, ' + r.findings + ' findings, ' + r.gaps.length + ' coverage gaps, status ' + r.arm.status + ') to ' + r.dir);
  } catch (e) {
    if (!(e instanceof ArmError)) throw e;
    console.error(e.message);
    process.exit(2);
  }
}
