// Keyless dry run of the gbrain time-to-first-wow eval: every cell of the plan, every fixture seed, scripted stand-in agents in place of
// the models, real transcript parsing, the scorer, the interim look and the decision rules. No model, no network, no key. The stand-ins
// search the real fixture files (and, in the gbrain arms, a stand-in import of them) and behave by fixed rules, so their scores carry
// no claim about gbrain or any harness: the run shows that the fixtures can be answered, that the scorer separates right from wrong,
// and that the analysis runs end to end.
//
//   bun scripts/gbrain-first-wow/dry-run.ts [--out <dir>]    (default docs/benchmarks/2026-11-24-gbrain-first-wow/dry-run)
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseClaude, parseCodex, type NEvent } from '../gbrain-install/transcript.ts';
import { buildFixture, personaFor, questionPrompt, writeFixture, NO_HISTORY_SEED_BASE, type Fixture, type Home, type PlantedQuestion } from './fixtures.ts';
import { scoreNoHistory, scoreTrial, type Arm, type BrainPage } from './score.ts';
import { contrast, contrastMarkdown, contrastsFor, decide, interimCall, mddFromDiscordance, noHistorySummary, plainMatches, type Row } from './verdict.ts';
import { INTERIM_SEEDS, STATED_DIFFERENCE } from './prereg.ts';

export interface Cell { harness: 'claude-code' | 'codex' | 'qm'; model: string; arms: Arm[]; format: Home }
export const CELLS: Cell[] = [
  { harness: 'claude-code', model: 'anthropic:claude-opus-5-5', arms: ['defaults', 'pr1', 'full', 'plain'], format: 'claude-code' },
  { harness: 'codex', model: 'openai:gpt-6.2-sol', arms: ['defaults', 'pr1', 'full', 'plain'], format: 'codex' },
  { harness: 'qm', model: 'anthropic:claude-opus-5-5', arms: ['qm-native', 'plain'], format: 'claude-code' },
  { harness: 'qm', model: 'openai:gpt-6.2-sol', arms: ['qm-native', 'plain'], format: 'claude-code' },
  { harness: 'qm', model: 'particle:particle-1', arms: ['qm-native', 'plain'], format: 'claude-code' },
];
export const VERDICT_SEEDS = Array.from({ length: 100 }, (_, i) => i);
export const NO_HISTORY_SEEDS = Array.from({ length: 10 }, (_, i) => NO_HISTORY_SEED_BASE + i);
export const DRY_RUN_FALLBACK_MARKER = 'HE-DRYRUN-FALLBACK';
export const PLANNING_MDD = mddFromDiscordance(0.3, 30);

interface Message { ref: string; ts: string; text: string }

/** Every message text in the fixture's session files, with its file and time. */
export function messages(f: Fixture): Message[] {
  const out: Message[] = [];
  for (const s of f.manifest.sessions) {
    for (const line of f.files.get(s.path)!.split('\n')) {
      if (!line.trim()) continue;
      const o = JSON.parse(line);
      const texts: string[] = [];
      if (o.message) { const c = o.message.content; if (typeof c === 'string') texts.push(c); else for (const b of c ?? []) if (b.type === 'text') texts.push(b.text); }
      if (o.type === 'response_item' && o.payload?.type === 'message') for (const b of o.payload.content ?? []) texts.push(b.text);
      for (const t of texts) out.push({ ref: s.path, ts: o.timestamp, text: t });
    }
  }
  return out;
}

/** A stand-in import: one page per session, as a real import might write it. The real page layout comes from gbrain's build. */
export function standInImport(f: Fixture): BrainPage[] {
  const by = new Map<string, string[]>();
  for (const m of messages(f)) by.set(m.ref, [...(by.get(m.ref) ?? []), m.text]);
  return f.manifest.sessions.map(s => ({ slug: 'conversations/' + s.harness + '/' + s.started_at.slice(0, 10) + '-' + s.id.slice(0, 8), text: (by.get(s.path) ?? []).join('\n') }));
}

const EXTRACT: Record<PlantedQuestion['kind'], RegExp> = {
  flag: /\bff_[a-z]+_[a-z]+\b/,
  port: /(?:listens on|port|uses port)\s+(\d{5})\b/,
  vendor: /(?:go with|uses)\s+([A-Z][a-z]+)\b/,
};
const CUE: Record<PlantedQuestion['kind'], RegExp> = { flag: /feature flag|flag is/i, port: /staging/i, vendor: /provider|uses [A-Z]/ };

/** The careful stand-in: the newest message that names the project, the topic word and the cue, and the value in it. */
export function findAnswer<T extends { ts: string; text: string }>(items: T[], q: PlantedQuestion, naive = false): { hit: T; value: string } | null {
  const project = new RegExp('\\b' + q.project + '\\b(?!-)');
  const pool = items.filter(m => (naive || (project.test(m.text) && m.text.toLowerCase().includes(q.topic.toLowerCase()))) && CUE[q.kind].test(m.text) && EXTRACT[q.kind].test(m.text));
  if (!pool.length) return null;
  const hit = naive ? pool[0]! : [...pool].sort((a, b) => a.ts < b.ts ? 1 : -1)[0]!;
  const m = EXTRACT[q.kind].exec(hit.text)!;
  return { hit, value: m[1] ?? m[0] };
}

interface Stand { reply: string; events: Array<{ tool: 'shell' | 'gbrain'; input: string; output: string }> }

function standIn(f: Fixture, arm: Arm, brain: BrainPage[], seed: number): Stand {
  const qs = f.manifest.questions;
  const events: Stand['events'] = [];
  const lines: string[] = [];
  const msgs = messages(f);
  const gbrainArm = arm !== 'plain';
  const fallsBackToFiles = arm === 'defaults' && seed % 4 === 0;
  const dropsCitation = arm === 'pr1' && seed % 5 === 1;
  qs.forEach((q, i) => {
    if (gbrainArm) {
      const pages = brain.map(p => ({ ...p, ts: p.slug.split('/').pop()!.slice(0, 10) }));
      const hits = f.manifest.persona === 'no-history' ? null : findAnswer(pages.flatMap(p => p.text.split('\n').map(text => ({ ...p, text }))), q);
      events.push({ tool: 'gbrain', input: JSON.stringify({ query: q.project + ' ' + q.topic }), output: hits ? JSON.stringify({ results: [{ slug: hits.hit.slug, snippet: hits.hit.text }] }) : JSON.stringify({ results: [] }) });
      if (hits) { lines.push((i + 1) + '. ' + hits.value + '. Source: ' + (dropsCitation ? 'my notes from an earlier session.' : 'gbrain page ' + hits.hit.slug + '.')); return; }
      if (!fallsBackToFiles) { lines.push((i + 1) + '. I could not find any record of that.'); return; }
    }
    const hit = f.manifest.persona === 'no-history' ? null : findAnswer(msgs, q);
    events.push({ tool: 'shell', input: 'rg -n -i "' + q.project + '" ~/.claude/projects ~/.codex/sessions', output: hit ? f.manifest.home_dir + '/' + hit.hit.ref + ':1:' + hit.hit.text : '' });
    lines.push((i + 1) + '. ' + (hit ? hit.value + '. Source: ~/' + hit.hit.ref : 'I could not find any record of that in your files.'));
  });
  return { reply: lines.join('\n'), events };
}

/** The stand-in session as the harness's own stream format, so the dry run goes through the real parsers. */
function asTranscript(format: Home, s: Stand): string {
  const out: string[] = [];
  s.events.forEach((e, i) => {
    const id = 'toolu_dry' + i;
    if (format === 'claude-code') {
      const name = e.tool === 'gbrain' ? 'mcp__gbrain__search' : 'Bash';
      const input = e.tool === 'gbrain' ? JSON.parse(e.input) : { command: e.input };
      out.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }));
      out.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: e.output }] } }));
    } else if (e.tool === 'gbrain') {
      out.push(JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'gbrain', tool: 'search', arguments: JSON.parse(e.input), result: { content: [{ type: 'text', text: e.output }] }, status: 'completed' } }));
    } else {
      out.push(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: e.input, aggregated_output: e.output, exit_code: 0, status: 'completed' } }));
    }
  });
  out.push(format === 'claude-code' ? JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: s.reply }] } }) : JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: s.reply } }));
  return out.join('\n') + '\n';
}

/** Fixture checks: every answer sits in its source files and in no project file; no decoy sits in a target-project message. */
export function fixtureProblems(f: Fixture): string[] {
  const problems: string[] = [];
  for (const q of f.manifest.questions) {
    if (q.answer === null) continue;
    for (const [path, body] of f.files) {
      if (path.startsWith('src/') && body.includes(q.answer)) problems.push(q.id + ' answer ' + q.answer + ' is in project file ' + path);
    }
    for (const src of q.source_files) if (!f.files.get(src)?.includes(q.answer)) problems.push(q.id + ' answer missing from ' + src);
    if (q.cross_harness && q.source_harness === f.manifest.home) problems.push(q.id + ' is marked cross-harness but sits in the home harness');
  }
  return problems;
}

export interface DryRun { rows: Row[]; fixtures: number; fixture_problems: string[]; trials: number }

export function runDryRun(workDir: string): DryRun {
  const rows: Row[] = [];
  const problems: string[] = [];
  let fixtures = 0;
  for (const cell of CELLS) {
    const home: Home = cell.harness === 'codex' ? 'codex' : 'claude-code';
    for (const seed of [...VERDICT_SEEDS, ...NO_HISTORY_SEEDS]) {
      const f = buildFixture(seed, personaFor(seed), home);
      fixtures++;
      problems.push(...fixtureProblems(f).map(p => cell.harness + ' seed ' + seed + ': ' + p));
      const dir = join(workDir, cell.harness + '-' + home + '-' + seed);
      if (!existsSync(join(dir, 'fixture.json'))) writeFixture(f, join(dir, 'home'), join(dir, 'fixture.json'));
      const readFile = (rel: string) => { const p = join(dir, 'home', rel); return existsSync(p) ? readFileSync(p, 'utf8') : null; };
      const prompt = questionPrompt(f.manifest);
      if (/gbrain|claude|codex|memory|brain/i.test(prompt)) problems.push('seed ' + seed + ': the question prompt names a tool');
      for (const arm of cell.arms) {
        const brain = arm === 'plain' || arm === 'defaults' ? [] : standInImport(f);
        const s = standIn(f, arm, brain, seed);
        const raw = asTranscript(cell.format, s);
        const events: NEvent[] = cell.format === 'claude-code' ? parseClaude(raw, 's1', 1) : parseCodex(raw, 's1', 1);
        const reply = events.filter(e => e.kind === 'text').map(e => e.output).join('\n');
        const toolEvents = events.filter(e => e.kind !== 'text');
        const setupOutput = arm === 'plain' ? undefined : arm === 'defaults' ? 'setup ok' : f.manifest.persona === 'no-history' ? 'setup ok\n' + DRY_RUN_FALLBACK_MARKER : 'setup ok\nimported ' + f.manifest.sessions.length + ' sessions';
        const input = { manifest: f.manifest, arm, reply, events: toolEvents, brain, readFile, setupOutput, fallbackMarkers: [DRY_RUN_FALLBACK_MARKER] };
        const time_ms = (arm === 'plain' ? 95000 : 50000) + (seed * 7919 % 30000);
        const base = { harness: cell.harness + '/' + cell.model.split(':')[1], model: cell.model, arm, seed, time_ms, timed_out: false, commands: toolEvents.length, person_needed: 0 };
        if (f.manifest.persona === 'no-history') {
          const n = scoreNoHistory(input);
          rows.push({ ...base, persona: 'no-history', finish: null, correct_abstention: n.correct_abstention, fallback_shown: n.fallback_shown });
        } else {
          const t = scoreTrial(input);
          rows.push({ ...base, persona: f.manifest.persona, finish: t.finish_any });
        }
      }
    }
  }
  return { rows, fixtures, fixture_problems: problems, trials: rows.length };
}

if (import.meta.main) {
  const outIdx = process.argv.indexOf('--out');
  const out = outIdx > 0 ? process.argv[outIdx + 1]! : 'docs/benchmarks/2026-11-24-gbrain-first-wow/dry-run';
  const work = mkdtempSync(join(tmpdir(), 'fw-dry-'));
  try {
    const d = runDryRun(work);
    const harnesses = [...new Set(d.rows.map(r => r.harness))];
    const half = new Set(INTERIM_SEEDS);
    const results = harnesses.flatMap(h => contrastsFor(h, [...new Set(d.rows.filter(r => r.harness === h).map(r => r.arm))]).map(c => ({ final: contrast(d.rows, c), interim: contrast(d.rows, c, half) })));
    const finals = results.map(r => r.final!).filter(Boolean);
    const decisions = harnesses.map(h => {
      const primary = results.find(r => r.final?.harness === h && (r.final.label.startsWith('primary') || r.final.b === 'qm-native'));
      if (!primary?.final || !primary.interim) return { harness: h, decision: 'no primary contrast' };
      const call = interimCall(primary.interim);
      const plain = finals.find(r => r.harness === h && r.a === 'plain' && r.b === 'full');
      const mdd = STATED_DIFFERENCE[h];
      if (mdd === undefined) throw new Error('no stated difference for ' + h);
      return { harness: h, stated_difference: mdd, interim: call, decision: decide(primary.final, mdd, call), plain_matches: plain ? plainMatches(plain, mdd) : null };
    });
    const receipt = {
      schema: 'gbrain-first-wow-dry-run/1',
      claim: 'none: scripted stand-in agents, no model; shows the fixtures, scorer and analysis run end to end',
      cells: CELLS.map(c => ({ harness: c.harness, model: c.model, arms: c.arms })),
      verdict_seeds: VERDICT_SEEDS.length, no_history_seeds: NO_HISTORY_SEEDS.length,
      fixtures: d.fixtures, trials: d.trials, fixture_problems: d.fixture_problems,
      planning_mdd_points: Number((PLANNING_MDD * 100).toFixed(1)),
      stated_difference_points: Object.fromEntries(Object.entries(STATED_DIFFERENCE).map(([h, x]) => [h, Math.round(x * 100)])),
      contrasts: finals.map(r => ({ harness: r.harness, a: r.a, b: r.b, n_pairs: r.n_pairs, rate_a: r.rate_a, rate_b: r.rate_b, delta: r.delta, ci95: r.ci95, wins: r.mcnemar.wins, losses: r.mcnemar.losses, p: r.mcnemar.p_two_sided })),
      decisions,
      no_history: noHistorySummary(d.rows),
    };
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    const md = ['# Dry run (keyless, stand-in agents, no claim)', '', 'Generated by \x60bun scripts/gbrain-first-wow/dry-run.ts\x60. ' + d.fixtures + ' fixtures, ' + d.trials + ' scored stand-in trials, ' + d.fixture_problems.length + ' fixture problems. The stand-ins follow fixed rules (the plan lists them), so these numbers say nothing about gbrain or any harness.', '', contrastMarkdown(finals), '| Harness | Interim call | Decision | Plain agent matches |', '|---|---|---|---|', ...decisions.map(x => '| ' + x.harness + ' | ' + ('interim' in x ? x.interim : '') + ' | ' + x.decision + ' | ' + ('plain_matches' in x ? String(x.plain_matches) : '') + ' |'), '', '| Harness | Arm | No-history trials | Correct abstention | Fallback shown |', '|---|---|---|---|---|', ...receipt.no_history.map(s => '| ' + s.harness + ' | ' + s.arm + ' | ' + s.n + ' | ' + s.correct_abstention + ' | ' + (s.fallback_shown ?? 'n/a') + ' |'), ''].join('\n');
    writeFileSync(join(out, 'README.md'), md);
    console.log('DRY_RUN: fixtures=' + d.fixtures + ' trials=' + d.trials + ' fixture_problems=' + d.fixture_problems.length + ' out=' + out);
    if (d.fixture_problems.length) { console.error(d.fixture_problems.slice(0, 20).join('\n')); process.exit(1); }
  } finally { rmSync(work, { recursive: true, force: true }); }
}
