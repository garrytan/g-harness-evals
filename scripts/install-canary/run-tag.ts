#!/usr/bin/env bun
// internal-task: run one gbrain release (or the stable channel) through the install canary. For each harness it reads the route
// INSTALL_FOR_AGENTS.md gives at that ref (routes.ts), runs it through the runner's own install trial on the harness's
// install-mode image against the scripted model (fake-model.ts), and writes result.json: pass, fail, incomplete or
// harness_or_env per harness and step, with the refused line and the guard's message, or gbrain's error code. Keyless: the
// metering proxy holds dummy keys and forwards only to the in-process fake.
//
//   bun scripts/install-canary/run-tag.ts --out <dir> --tag <vX.Y.Z.W> [--prerelease true|false] [--harness h1,h2]
//       [--attribute-to <previous passing tag>] [--doc <file>]
//   bun scripts/install-canary/run-tag.ts --out <dir> --stable [--harness ...]
//
// Exit 0 when result.json was written (whatever the verdict), 2 on a usage error, 3 (CANARY_RUN_FAILED) when no result could
// be written. Build the images first: scripts/install-canary/run.sh does, or docker build -t harness-eval/<h>:dev harnesses/<h>.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TrialRecord } from '../../runner/contracts.ts';
import { buildManifest, loadPrereg } from '../../runner/run.ts';
import { gbrainLsRemote, tagCommit } from '../../runner/trial/install.ts';
import { executeRun } from '../../runner/trial/run.ts';
import { DUMMY_KEYS } from '../gbrain-install/real-image-check.ts';
import { type FakeState, type LineResult, newFakeState, startCanaryFake } from './fake-model.ts';
import { type Channel, type Harness, HARNESSES, type Route, type RouteLine, resolveRoute } from './routes.ts';

export const SCHEMA = 'gbrain-install-canary/1';
export type Status = 'pass' | 'fail' | 'incomplete' | 'harness_or_env' | 'skipped';
export type StepStatus = 'pass' | 'fail' | 'refused' | 'skipped' | 'infra' | 'incomplete';
export interface StepResult { status: StepStatus; command: string | null; guard: { kind: string; message: string } | null; gbrain_code: string | null; exit_code: number | null; evidence: string }
export const STEPS = ['doc_route', 'bun', 'binary', 'setup', 'mcp_listed', 'remember', 'recall'] as const;

/** The model route each harness's fake answers on; only its API shape matters (Messages or Responses). */
export const CASE_MODEL: Record<Harness, string> = { 'claude-code': 'anthropic:claude-opus-5-5', codex: 'openai:gpt-6.1-sol', openclaw: 'anthropic:claude-opus-5-5', hermes: 'anthropic:claude-opus-5-5' };
/** The guard mode each harness runs with in its install-mode image (docs/install-canary.md, "Guard modes"). */
export const GUARD_MODE: Record<Harness, string> = {
  'claude-code': 'claude -p --permission-mode bypassPermissions (the install eval\'s unattended mode)',
  codex: 'approval_policy=never, sandbox_mode=danger-full-access (the install eval\'s unattended mode)',
  openclaw: 'shipped exec defaults (openclaw agent, no exec approvals configured)',
  hermes: 'shipped defaults: hermes chat --oneshot, approvals.single_query_mode=deny, Tirith pinned and offline',
};

const EVIDENCE_CAP = 600;
const cap = (s: string, n = EVIDENCE_CAP) => (s.length > n ? s.slice(0, n) + ' [cut]' : s);
const readJsonLines = (path: string): Array<Record<string, any>> => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];
const readJson = (path: string): any => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };

/** The last error code in a gbrain output: a JSON "code", the way scripts/gbrain-install/classify.ts reads it, or gbrain's
 *  human form "Error [code]:". */
export function gbrainCode(output: string): string | null {
  const all = [...output.matchAll(/"code"\s*:\s*"([A-Za-z0-9_.-]+)"|Error \[([a-z0-9_.-]+)\]:/g)].map((m) => [m[0], m[1] ?? m[2]]);
  return all.length ? all[all.length - 1]![1]! : null;
}

export interface CaseEvidence {
  route: Route; state: FakeState; record: TrialRecord | null; thrown: string | null;
  probes: Array<Record<string, any>>; watch: Array<Record<string, any>>; security: Array<{ kind: string; message: string }>;
  rateLimited: boolean;
}

const emptyStep = (status: StepStatus, evidence: string): StepResult => ({ status, command: null, guard: null, gbrain_code: null, exit_code: null, evidence: cap(evidence) });

/** One route step from its lines: the first refused or failed line decides it; a line never sent (the route stopped earlier) is
 *  skipped; a timed-out line is incomplete. A step whose lines all passed, or printed no exit code, is confirmed by the probe. */
export function lineStep(step: string, lines: RouteLine[], results: LineResult[], security: CaseEvidence['security'], confirm: { ok: boolean; why: string } | null): StepResult {
  const idx = lines.map((l, i) => (l.step === step ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return emptyStep('skipped', 'the route has no ' + step + ' line');
  const rs = idx.map((i) => results.find((r) => r.index === i) ?? null);
  for (const [k, r] of rs.entries()) {
    if (!r) return { ...emptyStep('skipped', 'line ' + (idx[k]! + 1) + ' was never sent (the route stopped before it)'), command: lines[idx[k]!]!.command };
    if (r.status === 'refused' || (r.status !== 'pass' && security.length)) {
      const g = security[0] ?? { kind: 'output', message: r.guard ?? r.output };
      return { status: 'refused', command: r.command, guard: { kind: g.kind, message: cap(g.message) }, gbrain_code: null, exit_code: r.exit_code, evidence: cap(r.output) };
    }
    if (r.status === 'fail') return { status: 'fail', command: r.command, guard: null, gbrain_code: gbrainCode(r.output), exit_code: r.exit_code, evidence: cap(r.output) };
    if (r.status === 'timeout') return { status: 'incomplete', command: r.command, guard: null, gbrain_code: null, exit_code: null, evidence: 'the tool call was still running at its timeout: ' + cap(r.output) };
  }
  if (confirm && !confirm.ok) return { status: 'fail', command: lines[idx[idx.length - 1]!]!.command, guard: null, gbrain_code: gbrainCode(rs.map((r) => r!.output).join('\n')), exit_code: null, evidence: cap(confirm.why) };
  return { status: 'pass', command: null, guard: null, gbrain_code: null, exit_code: null, evidence: idx.length + ' line(s) ran' + (confirm ? '; ' + confirm.why : '') };
}

/** One harness's verdict from a case's evidence. */
export function evaluateCase(harness: Harness, e: CaseEvidence): { status: Status; steps: Record<string, StepResult> } {
  const steps: Record<string, StepResult> = {};
  const changed = e.route.resolved.filter((r) => r.changed).map((r) => r.selector);
  steps.doc_route = e.route.missing.length
    ? emptyStep('incomplete', 'the doc at this ref has no ' + e.route.missing.join(', ') + ' route part (its marker is gone)')
    : emptyStep('pass', e.route.resolved.map((r) => r.selector + ' ' + (r.sha256 ?? '').slice(0, 12)).join(', ') + (changed.length ? '; changed since v0.60.761.0: ' + changed.join(', ') : ''));
  if (e.route.missing.length) {
    for (const s of STEPS.slice(1)) steps[s] = emptyStep('skipped', 'not run: the route could not be read from the doc');
    return { status: 'incomplete', steps };
  }
  const probesAll = [...e.probes, ...e.watch];
  const lastProbe = e.probes[e.probes.length - 1] ?? {};
  const binaryOk = probesAll.some((p) => p.binary);
  const wiredOk = probesAll.some((p) => p.ok === true);
  steps.bun = lineStep('bun', e.route.lines, e.state.results, e.security, null);
  steps.binary = lineStep('binary', e.route.lines, e.state.results, e.security, { ok: binaryOk, why: binaryOk ? 'the probe found gbrain at ' + (probesAll.find((p) => p.binary)?.binary ?? '?') : 'the probe never found gbrain on PATH, in ~/.bun/bin or in ~/.local/bin' });
  steps.setup = lineStep('setup', e.route.lines, e.state.results, e.security, { ok: wiredOk, why: wiredOk ? 'the probe found a brain and the harness wired to gbrain' : 'the probe never saw binary, brain and wiring together (last: brain=' + !!lastProbe.brain + ' mcp=' + !!lastProbe.mcp + ')' });
  const offered = Object.entries(e.state.toolNames).filter(([k]) => k === 'save' || k === 'recall').flatMap(([, v]) => v).filter((n) => /gbrain/i.test(n));
  const mcpProbe = probesAll.some((p) => p.mcp === true);
  const found = Object.values(e.state.found ?? {});
  const listed = offered.length > 0 || found.length > 0 || mcpProbe || /CALLED /.test(e.state.remember?.output ?? '');
  const routeBroke = ['bun', 'binary', 'setup'].some((s) => ['fail', 'refused', 'skipped'].includes(steps[s]!.status) && steps[s]!.command !== null);
  steps.mcp_listed = listed ? emptyStep('pass', offered.length ? 'gbrain tools offered: ' + offered.slice(0, 6).join(', ') : found.length ? 'the harness tool search found ' + found.join(', ') : 'a harness config registers gbrain (probe)')
    : emptyStep(routeBroke ? 'skipped' : 'fail', routeBroke ? 'not reached: the install route broke first' : 'no gbrain tool was offered in the save or recall conversation and no config registers gbrain');
  const rem = e.state.remember;
  steps.remember = routeBroke ? emptyStep('skipped', 'not reached: the install route broke first')
    : !rem || rem.via === 'none'
    ? emptyStep(routeBroke ? 'skipped' : listed ? 'incomplete' : 'fail', routeBroke ? 'not reached' : 'no gbrain remember tool could be called; tools offered: ' + (e.state.toolNames.save ?? []).slice(0, 30).join(', '))
    : { status: rem.is_error ? 'fail' : 'pass', command: rem.tool ?? rem.via, guard: null, gbrain_code: rem.output ? gbrainCode(rem.output) : null, exit_code: null, evidence: cap(rem.output ?? 'no result') };
  const outcome = e.record?.install?.outcome ?? null;
  const nonce = e.state.nonce;
  const toolRecalled = !!nonce && !!e.state.recall?.output?.includes(nonce) && e.state.recall.is_error === false && e.record?.install?.finish?.brain === true;
  steps.recall = outcome === 'recalled' ? emptyStep('pass', 'the install trial scored the recall as recalled (reply, gbrain call and brain all hold the nonce)')
    : toolRecalled ? emptyStep('pass', 'gbrain\'s recall result, called through ' + (e.state.recall?.tool ?? e.state.recall?.via) + ', holds the nonce and the brain holds it (the install trial scored ' + outcome + ': its transcript reader does not see a call made through a generic tool_call)')
    : emptyStep(routeBroke ? 'skipped' : 'fail', 'install trial outcome ' + (outcome ?? 'none') + (e.state.recall?.output ? '; recall returned: ' + e.state.recall.output : ''));
  const refused = Object.values(steps).some((s) => s.status === 'refused');
  if (e.thrown || (e.rateLimited && !refused) || (!e.record && !routeBroke)) {
    const why = e.thrown ? 'runner error: ' + e.thrown : e.rateLimited ? 'GitHub answered 403 or 429 (rate limit)' : 'no trial record was written';
    return { status: 'incomplete', steps: { ...steps, [routeBroke ? 'recall' : 'binary']: emptyStep('infra', why) } };
  }
  const vals = Object.values(steps);
  if (vals.some((s) => s.status === 'fail' || s.status === 'refused')) return { status: 'fail', steps };
  if (vals.some((s) => s.status === 'incomplete' || s.status === 'infra')) return { status: 'incomplete', steps };
  return { status: 'pass', steps };
}

/** Hermes's refusals for the trial: every "Security scan" (Tirith), dangerous-pattern or approval-card decision the adapter wrote. */
export function hermesSecurity(trialDir: string | null): CaseEvidence['security'] {
  const dir = trialDir ? join(trialDir, 'logs', 'turns') : null;
  if (!dir || !existsSync(dir)) return [];
  const out: CaseEvidence['security'] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.security.json')).sort()) {
    const j = readJson(join(dir, f));
    for (const d of j?.decisions ?? []) if (d?.kind && d.kind !== 'other') out.push({ kind: d.kind, message: [d.tool, ...(d.findings ?? d.titles ?? [])].filter(Boolean).join(': ') || d.kind });
  }
  return out;
}

export interface CaseOptions { harness: Harness; route: Route; tag: string; commit: string; outDir: string; label: string; repoRoot: string; log: (l: string) => void }

/** One install trial of a harness against its own fake, as scripts/gbrain-install/real-image-check.ts runs one. */
export async function runCase(o: CaseOptions): Promise<CaseEvidence> {
  const state = newFakeState(o.route.lines);
  const fake = startCanaryFake(() => state);
  const base = 'http://127.0.0.1:' + fake.port;
  const runId = 'install-canary-' + o.label;
  const dir = join(o.outDir, runId);
  const runDir = join(dir, 'run');
  mkdirSync(runDir, { recursive: true });
  const preregPath = join(dir, 'prereg.json');
  writeFileSync(preregPath, JSON.stringify({ schema_version: 1, run_id: runId, question: 'gbrain install canary (internal-task)', tasks: {}, spend_cap_usd: 100,
    wall_clock_s: { 'gbrain-install': 900 }, drop_order: [], minimum_v01: [],
    cells: [{ id: 'canary', harness: o.harness, model: CASE_MODEL[o.harness], slice: 'gbrain-install', split: 'dev', repetitions: 1, ceiling: { input_tokens: 10000000, output_tokens: 1000000 }, network: 'install', install: { arm: 'bare', tag: o.tag, commit: o.commit, seed: 'install-canary' } }] }, null, 1));
  const { prereg, sha256 } = loadPrereg(preregPath);
  const manifestPath = join(runDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(buildManifest(prereg, sha256), null, 1));
  let thrown: string | null = null;
  try {
    await executeRun(JSON.parse(readFileSync(manifestPath, 'utf8')), manifestPath, {
      harnessMode: 'docker', repoRoot: o.repoRoot, leaseUsd: 100, newLease: true, maxOutputTokens: 128000, throwOnNotStarted: true,
      proxyEnv: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', ...DUMMY_KEYS },
      proxyUpstream: { anthropic: base, openai: base, particle: base + '/particle' },
      installKeyEnv: { ...DUMMY_KEYS }, log: (l) => o.log('[' + o.label + '] ' + l),
    });
  } catch (e) { thrown = (e as Error).message; } finally { fake.stop(true); }
  const record = (readJsonLines(join(runDir, 'trials.jsonl'))[0] as TrialRecord | undefined) ?? null;
  const trialDir = record?.paths?.dir ?? null;
  const turnsDir = trialDir ? join(trialDir, 'logs', 'turns') : null;
  const probes = turnsDir && existsSync(turnsDir) ? readdirSync(turnsDir).filter((f) => f.endsWith('.probe.json')).sort().map((f) => readJson(join(turnsDir, f))).filter(Boolean) : [];
  const watch = trialDir ? readJsonLines(join(trialDir, 'logs', 'install-watch.ndjson')) : [];
  const egress = readJsonLines(join(runDir, 'install-egress.ndjson'));
  const rateLimited = egress.some((l) => /github/.test(String(l.host)) && [403, 429].includes(Number(l.status)));
  writeFileSync(join(dir, 'fake-state.json'), JSON.stringify(state, null, 1));
  return { route: o.route, state, record, thrown: thrown ?? record?.error ?? null, probes, watch, security: o.harness === 'hermes' ? hermesSecurity(trialDir) : [], rateLimited };
}

function harnessVersion(repoRoot: string, h: Harness): string | null {
  const pin = readJson(join(repoRoot, 'harnesses', h, 'pin.json'));
  return pin?.version ?? null;
}

async function fetchDoc(ref: string): Promise<string> {
  const url = 'https://raw.githubusercontent.com/garrytan/gbrain/' + ref + '/INSTALL_FOR_AGENTS.md';
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url).catch(() => null);
    if (r?.ok) return await r.text();
    await Bun.sleep(5000 * (i + 1));
  }
  throw new Error('CANARY_DOC_FETCH: ' + url + ' did not answer 200 after 4 tries');
}

/** The stable tag's commit and the version of the stable-v* tag on that commit. */
export function stableRelease(lsRemoteTags: string): { commit: string; tag: string } | null {
  const refs = lsRemoteTags.split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 2);
  const peeled = (name: string) => refs.find(([, r]) => r === 'refs/tags/' + name + '^{}')?.[0] ?? refs.find(([, r]) => r === 'refs/tags/' + name)?.[0] ?? null;
  const commit = peeled('stable');
  if (!commit) return null;
  const names = [...new Set(refs.map(([, r]) => r!.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '')))];
  const v = names.find((n) => /^stable-v\d/.test(n) && peeled(n) === commit) ?? names.find((n) => /^v\d+(\.\d+){2,3}$/.test(n) && peeled(n) === commit);
  return v ? { commit, tag: v.replace(/^stable-/, '') } : null;
}

export interface TagResult {
  schema: string; tag: string; commit: string; prerelease: boolean | null; stable_channel: boolean; run_id: string; harness_evals_commit: string | null;
  started_at: string; finished_at: string; status: Status; failed: string[]; blocks_stable: boolean; tested: boolean; promotable: boolean;
  doc_route: 'same' | 'changed' | 'missing'; attribution: { tag: string; status: Status; harnesses: string[] } | null;
  stable_version_mismatch: Array<{ harness: string; expected: string; seen: string | null }>;
  harnesses: Record<string, { status: Status; version: string | null; guard_mode: string; route: RouteLine[]; steps: Record<string, StepResult>; probe: { refused: boolean; status: Status; command: string | null; guard: string | null } | null }>;
}

/** The run's verdict over harnesses: fail beats incomplete beats pass. */
export function overall(hs: TagResult['harnesses']): { status: Status; failed: string[] } {
  const failed = Object.entries(hs).flatMap(([h, r]) => Object.entries(r.steps).filter(([, s]) => s.status === 'fail' || s.status === 'refused').map(([s]) => h + '/' + s));
  const st = Object.values(hs).map((r) => r.status);
  const status: Status = st.includes('fail') ? 'fail' : st.includes('incomplete') ? 'incomplete' : st.includes('harness_or_env') ? 'harness_or_env' : 'pass';
  return { status, failed };
}

export const verdictFields = (status: Status) => ({ blocks_stable: status === 'fail', tested: status !== 'skipped', promotable: status === 'pass' });

async function main(argv: string[]): Promise<number> {
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const out = flag('--out');
  const stable = argv.includes('--stable');
  let tag = flag('--tag');
  if (!out || (!tag && !stable) || (tag && !/^v\d+(\.\d+){2,3}$/.test(tag))) { console.error('usage: run-tag.ts --out <dir> (--tag vX.Y.Z.W | --stable) [--harness h1,h2] [--attribute-to <tag>] [--prerelease true|false] [--doc <file>]'); return 2; }
  const only = flag('--harness')?.split(',') as Harness[] | undefined;
  const harnesses = HARNESSES.filter((h) => !only || only.includes(h));
  const repoRoot = resolve(import.meta.dir, '..', '..');
  process.chdir(repoRoot);
  const outDir = resolve(out);
  mkdirSync(outDir, { recursive: true });
  const log = (l: string) => console.log(l);
  const started = new Date().toISOString();
  let commit: string | null = null;
  let channel: Channel;
  let docRef: string;
  if (stable) {
    const ls = execFileSync('git', ['ls-remote', '--tags', 'https://github.com/garrytan/gbrain.git'], { encoding: 'utf8', timeout: 120000 });
    const s = stableRelease(ls);
    if (!s) { console.error('CANARY_LS_REMOTE: no stable tag with a stable-v* or v* tag on its commit'); return 3; }
    commit = s.commit; tag = s.tag; channel = { kind: 'stable' }; docRef = 'master';
  } else {
    const r = gbrainLsRemote(tag!);
    commit = r.status === 0 ? tagCommit(r.stdout, tag!) : null;
    if (!commit) { console.error('CANARY_LS_REMOTE: git ls-remote found no gbrain tag ' + tag); return 3; }
    channel = { kind: 'tag', tag: tag! }; docRef = tag!;
  }
  const doc = flag('--doc') ? readFileSync(flag('--doc')!, 'utf8') : await fetchDoc(docRef);
  writeFileSync(join(outDir, 'INSTALL_FOR_AGENTS.md'), doc);
  const runId = (stable ? 'stable-' : '') + tag + '-' + started.replace(/[-:]/g, '').slice(0, 15);
  const hs: TagResult['harnesses'] = {};
  for (const h of harnesses) {
    const { route, probe } = resolveRoute(h, doc, channel);
    log('== ' + h + ': ' + route.lines.length + ' route line(s)' + (route.missing.length ? ', missing ' + route.missing.join(',') : '') + (probe ? ', plus a ' + probe.lines.length + '-line probe' : ''));
    const e = route.missing.length ? { route, state: newFakeState([]), record: null, thrown: null, probes: [], watch: [], security: [], rateLimited: false }
      : await runCase({ harness: h, route, tag: tag!, commit, outDir, label: h, repoRoot, log });
    const v = evaluateCase(h, e);
    let probeOut: TagResult['harnesses'][string]['probe'] = null;
    if (probe && !probe.missing.length) {
      const pe = await runCase({ harness: h, route: probe, tag: tag!, commit, outDir, label: h + '-bun-probe', repoRoot, log });
      const r = pe.state.results.find((x) => x.status === 'refused' || x.status === 'fail') ?? null;
      probeOut = { refused: r?.status === 'refused' || pe.security.length > 0, status: r ? 'fail' : 'pass', command: r?.command ?? null, guard: pe.security[0]?.message ?? r?.guard ?? null };
    }
    hs[h] = { status: v.status, version: harnessVersion(repoRoot, h), guard_mode: GUARD_MODE[h], route: route.lines, steps: v.steps, probe: probeOut };
    log('== ' + h + ': ' + v.status + ' ' + Object.entries(v.steps).map(([k, s]) => k + '=' + s.status).join(' '));
  }
  let { status, failed } = overall(hs);
  let attribution: TagResult['attribution'] = null;
  const prev = flag('--attribute-to');
  if (status === 'fail' && prev && prev !== tag) {
    const failing = Object.entries(hs).filter(([, r]) => r.status === 'fail').map(([h]) => h as Harness);
    const pr = gbrainLsRemote(prev);
    const pc = pr.status === 0 ? tagCommit(pr.stdout, prev) : null;
    if (pc) {
      try {
        const pdoc = await fetchDoc(prev);
        const again: Harness[] = [];
        for (const h of failing) {
          const { route } = resolveRoute(h, pdoc, { kind: 'tag', tag: prev });
          const e = await runCase({ harness: h, route, tag: prev, commit: pc, outDir, label: h + '-attribution-' + prev, repoRoot, log });
          if (evaluateCase(h, e).status === 'fail') again.push(h);
        }
        attribution = { tag: prev, status: again.length === failing.length ? 'fail' : 'pass', harnesses: again };
        if (again.length === failing.length) { for (const h of failing) hs[h]!.status = 'harness_or_env'; status = 'harness_or_env'; }
      } catch (err) { log('== attribution against ' + prev + ' could not run, keeping the fail: ' + (err as Error).message.slice(0, 200)); }
    }
  }
  const mismatch: TagResult['stable_version_mismatch'] = [];
  if (stable) {
    const want = tag!.replace(/^v/, '');
    for (const h of harnesses) {
      const dir = join(outDir, 'install-canary-' + h, 'run');
      const rec = readJsonLines(join(dir, 'trials.jsonl'))[0] as TrialRecord | undefined;
      const turns = rec?.paths?.dir ? join(rec.paths.dir, 'logs', 'turns') : null;
      const seen = turns && existsSync(turns) ? readdirSync(turns).filter((f) => f.endsWith('.probe.json')).map((f) => readJson(join(turns, f))?.version).filter(Boolean).pop() ?? null : null;
      if (hs[h]?.status === 'pass' && seen !== want) { mismatch.push({ harness: h, expected: want, seen }); hs[h]!.status = 'fail'; failed.push(h + '/stable_version'); status = 'fail'; }
    }
  }
  let headCommit: string | null = null;
  try { headCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  const pre = flag('--prerelease');
  const docState = Object.values(hs).some((r) => r.steps.doc_route?.status === 'incomplete') ? 'missing' : Object.values(hs).some((r) => /changed since/.test(r.steps.doc_route?.evidence ?? '')) ? 'changed' : 'same';
  const result: TagResult = { schema: SCHEMA, tag: tag!, commit, prerelease: pre === undefined ? null : pre === 'true', stable_channel: stable, run_id: runId, harness_evals_commit: headCommit,
    started_at: started, finished_at: new Date().toISOString(), status, failed, ...verdictFields(status), ...(harnesses.length < HARNESSES.length ? { promotable: false } : {}), doc_route: docState, attribution, stable_version_mismatch: mismatch, harnesses: hs };
  writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 1) + '\n');
  console.log('install canary ' + (stable ? 'stable ' : '') + tag + ': ' + status + (failed.length ? ' (' + failed.join(', ') + ')' : '') + '; ' + join(outDir, 'result.json'));
  return 0;
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2)).catch((e: Error) => { console.error('CANARY_RUN_FAILED: ' + e.message); return 3; });
  process.exit(code);
}
