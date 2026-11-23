#!/usr/bin/env bun
// internal-task: the install canary's controller side. run.sh calls it to take the lock, choose which gbrain releases to test,
// and publish the results to the folder gbrain's release checks read. Never runs a harness itself (run-tag.ts does, on the VM).
//
//   bun scripts/install-canary/canary.ts lock    --dest <dir> --run-id <id> [--ttl-min 240]
//   bun scripts/install-canary/canary.ts unlock  --dest <dir> --run-id <id>
//   bun scripts/install-canary/canary.ts select  --dest <dir> --out <plan.json> [--max 4] [--candidate <tag>] [--tag <tag>]...
//   bun scripts/install-canary/canary.ts publish --dest <dir> --plan <plan.json> --results <dir> --run-id <id> [--vm-error <code>]
//   bun scripts/install-canary/canary.ts status  --dest <dir> --run-id <id> [--tag <tag>]...
//   bun scripts/install-canary/canary.ts status  --pending --plan <plan.json> --run-id <id> --watch <vm.log> --stop <file>
//
// status posts the gbrain/install-canary commit status on each tested release's commit, which gbrain's stable promotion requires
// (docs/install-canary.md, "Commit status"). Exit 7 when any post failed; each failure prints a CANARY_STATUS line.
//
// dest holds latest.json, index.jsonl, runs/<tag>/, and runs/stable-<tag>/ (docs/install-canary.md, "Where results go").
// Every failure prints one stable error code from ERRORS with its fix line; exit 0 means the step did what it says.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gbrainLsRemote, tagCommit } from '../../runner/trial/install.ts';
import { HARNESSES } from './routes.ts';
import { SCHEMA, type Status, type TagResult, stableRelease } from './run-tag.ts';

export const ERRORS = {
  CANARY_LOCKED: { fix: 'another canary run holds dest/.lock; wait for it, or delete the lock once its expires_at has passed', retry: 'next trigger' },
  CANARY_GITHUB: { fix: 'the GitHub releases call failed (rate limit or outage); nothing was published, the next trigger retries', retry: 'next trigger' },
  CANARY_LS_REMOTE: { fix: 'git ls-remote against github.com/garrytan/gbrain failed; check network, the next trigger retries', retry: 'next trigger' },
  CANARY_DOC_FETCH: { fix: 'INSTALL_FOR_AGENTS.md could not be read at the tag; the job is published incomplete and retried', retry: '3 incomplete tries per tag' },
  CANARY_VM: { fix: 'the Ubicloud VM could not be created or reached; the jobs are published incomplete and retried', retry: '3 incomplete tries per tag' },
  CANARY_IMAGE_BUILD: { fix: 'a harness image did not build on the VM (log build-<h>.log); infrastructure, not a gbrain result', retry: '3 incomplete tries per tag' },
  CANARY_DRIVE_WRITE: { fix: 'writing to the drive folder failed; the pulled results stay under ~/.capy/work/install-canary/<run id>; rerun publish', retry: 'by hand' },
  CANARY_VM_LEFT: { fix: 'a VM with owner installcanary was still up after the run; run.sh took it down, check ubi-runner.sh list --mine', retry: 'none needed' },
  CANARY_RUN_FAILED: { fix: 'run-tag.ts wrote no result.json for a job (log <job>.log in the pulled results); published incomplete', retry: '3 incomplete tries per tag' },
  CANARY_STATUS: { fix: 'the gbrain/install-canary commit status did not land as an allowed poster, so gbrain stable waits on this release; the published results stand. Repost with: bun scripts/install-canary/canary.ts status --dest <dir> --run-id <id>', retry: 'by hand' },
} as const;
export type ErrorCode = keyof typeof ERRORS;
export const errorLine = (code: ErrorCode, msg: string) => code + ': ' + msg + '\nfix: ' + ERRORS[code].fix + ' (retry: ' + ERRORS[code].retry + ')';

export const MAX_TAGS = 4;
export const INCOMPLETE_TRIES = 3;
export const ASSET = 'gbrain-linux-x64';
export const ASSET_GRACE_MS = 2 * 3600 * 1000;
export type Channel = 'tag' | 'stable';
const SEVERITY: Record<Status, number> = { fail: 4, harness_or_env: 3, incomplete: 2, skipped: 1, pass: 0 };

export interface Release { tag: string; prerelease: boolean; published_at: string; assets: string[] }
export interface IndexLine {
  schema: string; tag: string; channel: Channel; run_id: string; status: Status; failed: string[];
  blocks_stable: boolean; tested: boolean; promotable: boolean; stable_channel: boolean; prerelease: boolean | null;
  commit: string | null; finished_at: string; result: string | null; reason: string | null;
}
export interface Job { id: string; tag: string; channel: Channel; args: string[] }
export interface Plan { jobs: Job[]; skipped: Array<{ tag: string; prerelease: boolean; reason: string }>; deferred: Array<{ tag: string; reason: string }> }
const dirOf = (tag: string, channel: Channel) => (channel === 'tag' ? tag : channel + '-' + tag);

export const versionKey = (tag: string) => tag.replace(/^v/, '').split('.').map((n) => n.padStart(8, '0')).join('.');
const byNewest = (a: { tag: string }, b: { tag: string }) => (versionKey(a.tag) < versionKey(b.tag) ? 1 : versionKey(a.tag) > versionKey(b.tag) ? -1 : 0);

export function readIndex(dest: string): IndexLine[] {
  const p = join(dest, 'index.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as IndexLine]; } catch { return []; } }) : [];
}

/** Which releases this run tests, newest first. A tag is done once a line says pass, fail, harness_or_env or skipped; incomplete
 * is retried up to INCOMPLETE_TRIES. The candidate (gbrain's next stable candidate) is never skipped and goes first. A release whose
 * linux-x64 binary isn't up yet is deferred for ASSET_GRACE_MS, since the binary route would fail on an upload in progress. */
export function selectJobs(o: { releases: Release[]; index: IndexLine[]; stable: { tag: string; commit: string } | null; now: number; max?: number; candidate?: string | null; only?: string[] }): Plan {
  const max = o.max ?? MAX_TAGS;
  const lines = (tag: string, ch: Channel) => o.index.filter((l) => l.tag === tag && l.channel === ch);
  const done = (tag: string, ch: Channel) => { const ls = lines(tag, ch); return ls.some((l) => l.status !== 'incomplete') || ls.length >= INCOMPLETE_TRIES; };
  const lastPass = o.index.filter((l) => l.channel === 'tag' && l.status === 'pass').sort(byNewest)[0]?.tag ?? null;
  const plan: Plan = { jobs: [], skipped: [], deferred: [] };
  const fresh: Release[] = [];
  for (const r of [...o.releases].sort(byNewest)) {
    if (o.only ? !o.only.includes(r.tag) : done(r.tag, 'tag')) continue;
    if (!r.assets.includes(ASSET) && o.now - Date.parse(r.published_at) < ASSET_GRACE_MS) { plan.deferred.push({ tag: r.tag, reason: 'no ' + ASSET + ' asset yet, published under 2h ago' }); continue; }
    fresh.push(r);
  }
  const cand = o.candidate ? fresh.find((r) => r.tag === o.candidate) : undefined;
  const chosen = [...(cand ? [cand] : []), ...fresh.filter((r) => r !== cand)].slice(0, max);
  for (const r of fresh) {
    if (chosen.includes(r)) continue;
    if (versionKey(r.tag) > versionKey(chosen[chosen.length - 1]?.tag ?? 'v0')) continue;
    plan.skipped.push({ tag: r.tag, prerelease: r.prerelease, reason: 'older than the ' + max + ' newest untested releases in this run' });
  }
  for (const r of chosen) {
    const prev = lastPass && lastPass !== r.tag ? lastPass : null;
    plan.jobs.push({ id: r.tag, tag: r.tag, channel: 'tag', args: ['--tag', r.tag, '--prerelease', String(r.prerelease), ...(prev ? ['--attribute-to', prev] : [])] });
  }
  if (o.stable && !o.only && !done(o.stable.tag, 'stable')) plan.jobs.push({ id: 'stable-' + o.stable.tag, tag: o.stable.tag, channel: 'stable', args: ['--stable'] });
  return plan;
}

/** Why a result line reads the way it does, when that isn't plain from status and failed. */
export function resultReason(r: TagResult): string | null {
  const ran = Object.keys(r.harnesses);
  const why = [
    ...(r.stable_version_mismatch?.length ? ['the stable channel installed ' + r.stable_version_mismatch.map((m) => m.harness + ' ' + (m.seen ?? 'no version') + ' instead of ' + m.expected).join(', ')] : []),
    ...(ran.length < HARNESSES.length ? ['only ' + ran.join(', ') + ' ran (a by-hand --harness check), so it is not promotable'] : []),
  ];
  return why.length ? why.join('; ') : null;
}
export function indexLineFrom(r: TagResult, resultPath: string): IndexLine {
  return { schema: SCHEMA, tag: r.tag, channel: r.stable_channel ? 'stable' : 'tag', run_id: r.run_id, status: r.status, failed: r.failed, blocks_stable: r.blocks_stable,
    tested: r.tested, promotable: r.promotable, stable_channel: r.stable_channel, prerelease: r.prerelease, commit: r.commit, finished_at: r.finished_at, result: resultPath, reason: resultReason(r) };
}
const bareLine = (tag: string, channel: Channel, run_id: string, status: Status, reason: string, prerelease: boolean | null, now: string): IndexLine =>
  ({ schema: SCHEMA, tag, channel, run_id, status, failed: [], blocks_stable: false, tested: status !== 'skipped', promotable: false, stable_channel: channel === 'stable', prerelease, commit: null, finished_at: now, result: null, reason });

const atomicWrite = (path: string, body: string) => { writeFileSync(path + '.tmp', body); renameSync(path + '.tmp', path); };

/** The lines this run adds, given what the VM produced. A job with no result.json becomes an incomplete line naming why. */
export function runLines(plan: Plan, resultsDir: string, runId: string, vmError: ErrorCode | null, now: string): Array<{ line: IndexLine; result: TagResult | null; dir: string }> {
  const out: Array<{ line: IndexLine; result: TagResult | null; dir: string }> = [];
  for (const j of plan.jobs) {
    let r: TagResult | null = null;
    try { r = JSON.parse(readFileSync(join(resultsDir, j.id, 'result.json'), 'utf8')); } catch { /* missing or unreadable */ }
    if (r && r.schema !== SCHEMA) r = null;
    const dir = dirOf(r?.tag ?? j.tag, j.channel);
    if (r) { r.run_id = runId; out.push({ line: indexLineFrom(r, 'runs/' + dir + '/result.json'), result: r, dir }); continue; }
    const code: ErrorCode = vmError ?? 'CANARY_RUN_FAILED';
    out.push({ line: bareLine(j.tag, j.channel, runId, 'incomplete', code + ': ' + ERRORS[code].fix, j.args.includes('--prerelease') ? j.args[j.args.indexOf('--prerelease') + 1] === 'true' : null, now), result: null, dir });
  }
  for (const s of plan.skipped) out.push({ line: bareLine(s.tag, 'tag', runId, 'skipped', s.reason, s.prerelease, now), result: null, dir: s.tag });
  return out;
}

/** latest.json: this run's most severe line that isn't pass; else the newest line still blocking stable (the most recent verdict
 *  for its release and channel says fail) for a release at or after the stable channel's tag, so a failed candidate stays in view
 *  after a newer release passes; else the newest release line. An incomplete line or a --harness subset pass (pass, not promotable)
 *  is no verdict on the whole release, so it never clears an earlier fail. */
export function latestOf(index: IndexLine[], added: IndexLine[]): IndexLine | null {
  const severest = (ls: IndexLine[]) => [...ls].sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status] || byNewest(a, b))[0] ?? null;
  const bad = added.filter((l) => l.status !== 'pass' && l.status !== 'skipped');
  if (bad.length) return severest(bad);
  const current = new Map<string, IndexLine>();
  for (const l of index) if (l.status !== 'skipped' && l.status !== 'incomplete' && !(l.status === 'pass' && !l.promotable)) current.set(l.tag + ' ' + l.channel, l);
  const floor = index.filter((l) => l.channel === 'stable').sort(byNewest)[0]?.tag ?? 'v0';
  const blocking = [...current.values()].filter((l) => l.blocks_stable && versionKey(l.tag) >= versionKey(floor));
  if (blocking.length) return severest(blocking);
  return index.filter((l) => l.channel === 'tag' && l.status !== 'skipped').sort((a, b) => byNewest(a, b) || (a.finished_at < b.finished_at ? 1 : -1))[0] ?? null;
}

/** Which added lines gbrain's maintainers are told about: fail, harness_or_env, and an incomplete whose previous line for that tag was incomplete. */
export function notifications(before: IndexLine[], added: IndexLine[]): IndexLine[] {
  return added.filter((l) => {
    if (l.status === 'fail' || l.status === 'harness_or_env') return true;
    if (l.status !== 'incomplete') return false;
    const prev = before.filter((b) => b.tag === l.tag && b.channel === l.channel).pop();
    return prev?.status === 'incomplete';
  });
}

export function summaryMd(l: IndexLine, r: TagResult | null): string {
  const head = '# gbrain install canary: ' + (l.channel === 'stable' ? 'stable channel at ' : '') + l.tag + '\n\n**' + l.status.toUpperCase() + '**' + (l.failed.length ? ': ' + l.failed.join(', ') : '') + (l.reason ? '\n\n' + l.reason : '') + '\n\n';
  if (!r) return head;
  const rows = Object.entries(r.harnesses).map(([h, x]) => {
    const bad = Object.entries(x.steps).find(([, s]) => s.status !== 'pass' && s.status !== 'skipped');
    const what = bad ? bad[0] + ' ' + bad[1].status + (bad[1].command ? ': \`' + bad[1].command.replace(/\|/g, '\\|').slice(0, 160) + '\`' : '') + (bad[1].guard ? ' (guard: ' + bad[1].guard.message.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 200) + ')' : '') + (bad[1].gbrain_code ? ' (gbrain code ' + bad[1].gbrain_code + ')' : '') : 'all steps passed';
    return '| ' + h + ' | ' + (x.version ?? '?') + ' | ' + x.status + ' | ' + what + ' |';
  });
  return head + '| Harness | Version | Status | First problem |\n|---|---|---|---|\n' + rows.join('\n') + '\n\n' +
    (r.attribution ? 'Attribution: the failing harnesses were re-run on ' + r.attribution.tag + ', which ' + (r.attribution.status === 'fail' ? 'failed the same way, so this is marked harness_or_env, not a gbrain regression' : 'passed, so the failure is new in ' + l.tag) + '.\n\n' : '') +
    'Commit ' + (r.commit ?? '?') + ', run ' + l.run_id + ', harness-evals ' + (r.harness_evals_commit ?? '?') + '. Full result: result.json.\n';
}

/** Writes per-tag files, then the index, then latest.json, each by rename. Idempotent on (tag, channel, run_id). */
export function publish(dest: string, plan: Plan, resultsDir: string, runId: string, vmError: ErrorCode | null, now = new Date().toISOString()): { added: IndexLine[]; notify: IndexLine[]; latest: IndexLine | null } {
  mkdirSync(join(dest, 'runs'), { recursive: true });
  const before = readIndex(dest);
  const seen = new Set(before.map((l) => l.tag + ' ' + l.channel + ' ' + l.run_id));
  const fresh = runLines(plan, resultsDir, runId, vmError, now).filter((x) => !seen.has(x.line.tag + ' ' + x.line.channel + ' ' + x.line.run_id));
  for (const x of fresh) {
    if (x.line.status === 'skipped') continue;
    const d = join(dest, 'runs', x.dir);
    mkdirSync(d, { recursive: true });
    if (x.result) atomicWrite(join(d, 'result.json'), JSON.stringify(x.result, null, 1) + '\n');
    atomicWrite(join(d, 'summary.md'), summaryMd(x.line, x.result));
  }
  const added = fresh.map((x) => x.line);
  const index = [...before, ...added];
  atomicWrite(join(dest, 'index.jsonl'), index.map((l) => JSON.stringify(l)).join('\n') + (index.length ? '\n' : ''));
  const latest = latestOf(index, added);
  if (latest) atomicWrite(join(dest, 'latest.json'), JSON.stringify(latest, null, 1) + '\n');
  return { added, notify: notifications(before, added), latest };
}

export function takeLock(dest: string, runId: string, ttlMin: number, now = Date.now()): { ok: true } | { ok: false; holder: string } {
  mkdirSync(dest, { recursive: true });
  const p = join(dest, '.lock');
  const body = JSON.stringify({ run_id: runId, taken_at: new Date(now).toISOString(), expires_at: new Date(now + ttlMin * 60000).toISOString() }) + '\n';
  try { writeFileSync(p, body, { flag: 'wx' }); return { ok: true }; }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  try {
    const l = JSON.parse(readFileSync(p, 'utf8'));
    if (l.run_id !== runId && Date.parse(l.expires_at) > now) return { ok: false, holder: l.run_id + ' until ' + l.expires_at };
  } catch { /* unreadable lock: treat as expired */ }
  atomicWrite(p, body);
  try { const l = JSON.parse(readFileSync(p, 'utf8')); if (l.run_id !== runId) return { ok: false, holder: l.run_id + ' until ' + l.expires_at }; } catch { return { ok: false, holder: 'unreadable lock' }; }
  return { ok: true };
}
export function dropLock(dest: string, runId: string): boolean {
  const p = join(dest, '.lock');
  try { if (JSON.parse(readFileSync(p, 'utf8')).run_id !== runId) return false; } catch { return false; }
  rmSync(p, { force: true });
  return true;
}

export const STATUS_CONTEXT = 'gbrain/install-canary';
export const STATUS_REPO = 'garrytan/gbrain';
/** The poster gbrain's stable promotion accepts (internal-task, 2026-11-23): Capy machines post through Capy's GitHub app. */
export const STATUS_LOGINS = ['capy-ai[bot]'];
export const STATUS_MAX = 140;
export type StatusState = 'success' | 'failure' | 'pending';
export interface StatusPost { sha: string; tag: string; state: StatusState; description: string }

/** success when tested and promotable; failure when tested and it blocks stable or isn't promotable; nothing when untested. */
export function statusState(l: Pick<IndexLine, 'tested' | 'promotable' | 'blocks_stable'>): 'success' | 'failure' | null {
  if (!l.tested) return null;
  return l.promotable && !l.blocks_stable ? 'success' : 'failure';
}

/** `v<V> run <id>: pass`, `v<V> run <id>: fail <harness,...>` or `v<V> run <id>: testing`, at most STATUS_MAX characters. A failure
 *  that names no harness (incomplete, a partial run) names its status instead; a list too long to fit ends in +<n>. */
export function statusDescription(tag: string, runId: string, state: StatusState, failed: string[], status: Status): string {
  const head = (tag.startsWith('v') ? tag : 'v' + tag) + ' run ' + runId + ': ';
  if (state !== 'failure') return (head + (state === 'success' ? 'pass' : 'testing')).slice(0, STATUS_MAX);
  const names = failed.length ? failed : [status === 'pass' ? 'partial' : status];
  for (let n = names.length; n > 0; n--) {
    const d = head + 'fail ' + names.slice(0, n).join(',') + (n < names.length ? ',+' + (names.length - n) : '');
    if (d.length <= STATUS_MAX) return d;
  }
  return (head + 'fail +' + names.length).slice(0, STATUS_MAX);
}

/** One post per commit for a run's lines: failure when any tested line on that commit fails, else success. Lines need a commit. */
export function statusPosts(lines: Array<IndexLine & { commit: string }>): StatusPost[] {
  const by = new Map<string, Array<IndexLine & { commit: string }>>();
  for (const l of lines) if (statusState(l)) by.set(l.commit, [...(by.get(l.commit) ?? []), l]);
  return [...by].map(([sha, ls]) => {
    const bad = ls.filter((l) => statusState(l) === 'failure');
    const state = bad.length ? 'failure' : 'success';
    const failed = [...new Set(bad.flatMap((l) => l.failed))];
    return { sha, tag: ls[0]!.tag, state, description: statusDescription(ls[0]!.tag, ls[0]!.run_id, state, failed, (bad[0] ?? ls[0]!).status) };
  });
}

/** The lines run runId posts for. An incomplete line is no verdict on its release (as in latestOf), so when the release has an
 *  earlier verdict on either channel (both share the commit's one status), that verdict is posted again, restoring what this
 *  run's pending replaced. */
export function statusLines(index: IndexLine[], runId: string, only: string[] = []): IndexLine[] {
  const verdict = (l: IndexLine) => l.status !== 'incomplete' && l.status !== 'skipped' && !(l.status === 'pass' && !l.promotable);
  return index.filter((l) => l.run_id === runId && (!only.length || only.includes(l.tag)) && statusState(l))
    .map((l) => (l.status !== 'incomplete' ? l : [...index].reverse().find((b) => b.run_id !== runId && b.tag === l.tag && verdict(b)) ?? l));
}

/** Posts one status through gh (the machine's GitHub credential) and returns who GitHub says posted it; one retry. */
export function postStatus(p: StatusPost): string {
  let last: unknown;
  for (let i = 0; i < 2; i++) {
    try {
      return execFileSync('gh', ['api', '-X', 'POST', 'repos/' + STATUS_REPO + '/statuses/' + p.sha, '-f', 'state=' + p.state, '-f', 'context=' + STATUS_CONTEXT, '-f', 'description=' + p.description, '--jq', '.creator.login'],
        { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (e) { last = e; if (i === 0) Bun.sleepSync(5000); }
  }
  const err = last as { stderr?: string; message?: string };
  throw new Error(String(err.stderr || err.message || last).trim().split('\n').pop()!.slice(0, 200));
}

/** Posts each status and prints one line per post; returns how many did not land as an allowed poster. */
export function sendStatuses(posts: StatusPost[], post: (p: StatusPost) => string = postStatus): number {
  let bad = 0;
  for (const p of posts) {
    const what = p.tag + ' ' + p.state + ' on ' + p.sha.slice(0, 12);
    let login: string;
    try { login = post(p); } catch (e) { bad++; console.log(errorLine('CANARY_STATUS', what + ' not posted: ' + (e as Error).message)); continue; }
    if (STATUS_LOGINS.includes(login)) { console.log('status ' + what + ' posted as ' + login + ': ' + p.description); continue; }
    bad++;
    console.log(errorLine('CANARY_STATUS', what + ' posted as ' + (login || 'nobody') + ', which gbrain does not accept (allowed: ' + STATUS_LOGINS.join(', ') + ')'));
  }
  return bad;
}

async function releases(): Promise<Release[]> {
  const url = 'https://api.github.com/repos/garrytan/gbrain/releases?per_page=30';
  let body: any;
  const res = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'harness-evals-install-canary' } }).catch(() => null);
  if (res?.ok) body = await res.json();
  else body = JSON.parse(execFileSync('gh', ['api', url.replace('https://api.github.com/', '')], { encoding: 'utf8', timeout: 60000 }));
  return (body as any[]).filter((r) => !r.draft && /^v\d+(\.\d+){2,3}$/.test(r.tag_name)).map((r) => ({ tag: r.tag_name, prerelease: !!r.prerelease, published_at: r.published_at, assets: (r.assets ?? []).map((a: any) => a.name) }));
}

const commitOf = (tag: string) => { const r = gbrainLsRemote(tag); return r.status === 0 ? tagCommit(r.stdout, tag) : null; };

/** The status subcommand. --pending watches vm.log and posts pending for each job as its "[vm] job <id>:" line appears, until the
 *  stop file exists (one last read after it does). Otherwise it posts the final status for each tested line of the run. */
async function status(argv: string[], dest: string | undefined, runId: string | undefined): Promise<number> {
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const only = argv.flatMap((a, i) => (a === '--tag' && argv[i + 1] ? [argv[i + 1]!] : []));
  if (!runId) { console.error('status needs --run-id'); return 2; }
  let bad = 0;
  if (argv.includes('--pending')) {
    const planPath = flag('--plan');
    const watch = flag('--watch');
    const stop = flag('--stop');
    if (!planPath || !watch || !stop) { console.error('status --pending needs --plan, --watch and --stop'); return 2; }
    const plan: Plan = JSON.parse(readFileSync(planPath, 'utf8'));
    const started = new Set<string>();
    for (;;) {
      const last = existsSync(stop);
      for (const m of (existsSync(watch) ? readFileSync(watch, 'utf8') : '').matchAll(/^\[vm\] job (\S+):/gm)) {
        const job = plan.jobs.find((j) => j.id === m[1]);
        if (!job || started.has(job.id)) continue;
        started.add(job.id);
        const sha = commitOf(job.tag);
        if (!sha) { bad++; console.log(errorLine('CANARY_STATUS', job.tag + ' pending not posted: git ls-remote found no commit for the tag')); continue; }
        bad += sendStatuses([{ sha, tag: job.tag, state: 'pending', description: statusDescription(job.tag, runId, 'pending', [], 'incomplete') }]);
      }
      if (last) return bad ? 7 : 0;
      await Bun.sleep(5000);
    }
  }
  if (!dest) { console.error('status needs --dest (or --pending)'); return 2; }
  const lines = statusLines(readIndex(dest), runId, only);
  if (!lines.length) { console.log('status: run ' + runId + ' has no tested line' + (only.length ? ' for ' + only.join(' ') : '') + ', so nothing is posted'); return only.length ? 2 : 0; }
  const ready: Array<IndexLine & { commit: string }> = [];
  for (const l of lines) {
    const sha = l.commit ?? commitOf(l.tag);
    if (sha) ready.push({ ...l, commit: sha });
    else { bad++; console.log(errorLine('CANARY_STATUS', l.tag + ' not posted: git ls-remote found no commit for the tag')); }
  }
  bad += sendStatuses(statusPosts(ready));
  return bad ? 7 : 0;
}

async function main(argv: string[]): Promise<number> {
  const [cmd] = argv;
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const all = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]!] : []));
  const dest = flag('--dest');
  const runId = flag('--run-id');
  if (cmd === 'status') return await status(argv, dest, runId);
  if (!dest) { console.error('usage: canary.ts lock|unlock|select|publish|status --dest <dir> ...'); return 2; }
  if (cmd === 'lock' || cmd === 'unlock') {
    if (!runId) { console.error('--run-id is required'); return 2; }
    if (cmd === 'unlock') { console.log(dropLock(dest, runId) ? 'unlocked' : 'no lock of ours'); return 0; }
    const r = takeLock(dest, runId, Number(flag('--ttl-min') ?? 240));
    if (!r.ok) { console.error(errorLine('CANARY_LOCKED', 'held by ' + r.holder)); return 4; }
    console.log('locked ' + runId);
    return 0;
  }
  if (cmd === 'select') {
    const out = flag('--out');
    if (!out) { console.error('--out is required'); return 2; }
    let rel: Release[];
    try { rel = await releases(); } catch (e) { console.error(errorLine('CANARY_GITHUB', (e as Error).message.slice(0, 200))); return 5; }
    let stable: { tag: string; commit: string } | null;
    try { stable = stableRelease(execFileSync('git', ['ls-remote', '--tags', 'https://github.com/garrytan/gbrain.git'], { encoding: 'utf8', timeout: 120000 })); }
    catch (e) { console.error(errorLine('CANARY_LS_REMOTE', (e as Error).message.slice(0, 200))); return 5; }
    const only = all('--tag');
    const plan = selectJobs({ releases: rel, index: readIndex(dest), stable, now: Date.now(), max: Number(flag('--max') ?? MAX_TAGS), candidate: flag('--candidate') ?? null, only: only.length ? only : undefined });
    writeFileSync(out, JSON.stringify(plan, null, 1) + '\n');
    console.log('jobs: ' + (plan.jobs.map((j) => j.id).join(' ') || 'none') + (plan.skipped.length ? '; skipped ' + plan.skipped.map((s) => s.tag).join(' ') : '') + (plan.deferred.length ? '; deferred ' + plan.deferred.map((s) => s.tag).join(' ') : ''));
    return 0;
  }
  if (cmd === 'publish') {
    const planPath = flag('--plan');
    const results = flag('--results');
    if (!planPath || !results || !runId) { console.error('publish needs --plan, --results and --run-id'); return 2; }
    const vmError = (flag('--vm-error') ?? null) as ErrorCode | null;
    if (vmError && !(vmError in ERRORS)) { console.error('unknown --vm-error ' + vmError); return 2; }
    let r: ReturnType<typeof publish>;
    try { r = publish(dest, JSON.parse(readFileSync(planPath, 'utf8')), results, runId, vmError); }
    catch (e) { console.error(errorLine('CANARY_DRIVE_WRITE', (e as Error).message.slice(0, 200))); return 6; }
    for (const l of r.added) console.log('published ' + (l.channel === 'tag' ? '' : l.channel + ' ') + l.tag + ': ' + l.status + (l.failed.length ? ' (' + l.failed.join(', ') + ')' : ''));
    console.log('latest.json: ' + (r.latest ? r.latest.tag + ' ' + r.latest.status : 'none'));
    if (r.notify.length) {
      console.log('CANARY_NOTIFY_BEGIN');
      for (const l of r.notify) console.log('- ' + (l.channel === 'stable' ? 'stable channel ' : '') + l.tag + ' ' + l.status.toUpperCase() + (l.failed.length ? ': ' + l.failed.join(', ') : '') + (l.reason ? ': ' + l.reason : '') + ' (' + join(dest, 'runs', dirOf(l.tag, l.channel), 'summary.md') + ')');
      console.log('CANARY_NOTIFY_END');
    }
    return 0;
  }
  console.error('unknown command ' + cmd);
  return 2;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
