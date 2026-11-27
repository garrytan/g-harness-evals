// The provider stop (internal-task): a shard stops once a provider has refused PROVIDER_STOP_AFTER trials in a row for want of
// credit, instead of turning every trial after it into a $0 infrastructure record (about 100 trials went that
// way when xAI credit ran out mid-shard in 2026-11). The launch check (scripts/launch-preflight.ts) asks each provider once
// before a shard starts; this watches the trials while it runs, with the same credit rule (creditRefusal).
//
// A trial counts against a provider when that provider answered it, through the metering proxy, with a forwarded 402 at any
// point (the rule internal-task's skills-at-scale analysis uses for a provider stop, scripts/skills-at-scale/analyze.ts), or when
// the provider's last answer in the trial was a 400, 401 or 403 whose body speaks of credit, balance, quota, billing or a
// spending limit, or a 429 that names credit, billing, a spending limit or insufficient_quota (a bare "quota" or "resource
// exhausted" on a 429 is a rate limit: Google answers every rate limit that way). A trial that called the provider and does not count resets that provider's run; a trial that never
// called it leaves the run as it was. Proxy refusals (outcome refused: the lease, the allowlist) are ours, not the
// provider's, and never count.
//
// Two consumers: the runner's trial loop (runner/trial/run.ts, every runner/run.ts shard) stops the run with exit 8 and writes
// provider-stop.json in the run directory; scripts/frontier-harbor/vm-run.sh runs `watch` beside Harbor, which reads the
// proxy's usage log every --every seconds, writes the same file and signals the shard to stop. The log outlives a stop (a
// --resume or a later --stage appends to it), so watch counts only lines from its own start on; and it reads trials while
// they run, so it judges a trial only once that trial has logged nothing for --quiet seconds, by when its last answer is its
// final one (a harness retrying a refusal keeps logging).
//
//   bun runner/cost/provider-stop.ts scan --usage <proxy-usage.ndjson> [--out <provider-stop.json>]   exit 8 on a stop, else 0
//   bun runner/cost/provider-stop.ts watch --usage <file> --out <file> --signal-pid <pid> [--every 60] [--quiet 300]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Trials in a row one provider may refuse before the shard stops. Three: a stray refusal in one or two trials (a provider's
 *  passing 403, a rate limit worded like a quota) does not stop a shard, and a provider that is really out of credit costs
 *  at most three $0 trials, each of which fails in seconds, before the shard stops and its VM is freed. */
export const PROVIDER_STOP_AFTER = 3;

/** runner/trial/run.ts RUN_EXIT.providerStop, and this script's exit on a stop. */
export const PROVIDER_STOP_EXIT = 8;

export const PROVIDER_STOP_FILE = 'provider-stop.json';

const CREDIT = /credit|balance|quota|billing|spending[ _-]?limit|insufficient_quota|payment|exhausted|monthly limit/i;
const CREDIT_429 = /credit|billing|spending[ _-]?limit|insufficient_quota|payment|monthly limit/i;
const PLAN_AND_BILLING = /check your plan and billing details/gi;

/** A provider's answer that says the account cannot pay or may not call: 402, a 400, 401 or 403 with credit wording, or a 429
 *  with credit wording beyond "quota", "exhausted" and "check your plan and billing details" (Google's and OpenAI's rate-limit
 *  text; OpenAI's out-of-credit 429 still counts by its insufficient_quota code). The launch check (runner/cost/provider-probe.ts classify) reads it as
 *  HE-PROVIDER-002. */
export function creditRefusal(status: number | undefined | null, text: string): boolean {
  if (status === 402) return true;
  if (status === 429) return CREDIT_429.test(text.replace(PLAN_AND_BILLING, ''));
  return (status === 400 || status === 401 || status === 403) && CREDIT.test(text);
}

export interface StopLine { at?: string; key: string; provider: string; outcome: string; status?: number; error_code?: string; error_type?: string; error_body?: unknown; error_text?: string }
export interface ProviderStop { schema: 'provider-stop/1'; at: string; provider: string; after: number; trials: string[]; last: { status: number; error_code?: string; error_type?: string } }

const wording = (l: StopLine) => [l.error_code, l.error_type, l.error_text, l.error_body === undefined ? '' : JSON.stringify(l.error_body)].filter(Boolean).join(' ');

/** One trial's forwarded answers, by provider: refused (counts against it, with the answer that did) or answered (resets it). */
export function trialVerdicts(lines: ReadonlyArray<StopLine>): Map<string, { refused: StopLine | null }> {
  const out = new Map<string, { refused: StopLine | null }>();
  const forwarded = lines.filter((l) => l.outcome === 'forwarded');
  for (const provider of new Set(forwarded.map((l) => l.provider))) {
    const mine = forwarded.filter((l) => l.provider === provider);
    const paid = mine.find((l) => l.status === 402);
    const last = mine.at(-1)!;
    out.set(provider, { refused: paid ?? (creditRefusal(last.status, wording(last)) ? last : null) });
  }
  return out;
}

/** Counts each provider's refused trials in a row; observe returns the stop once one provider reaches `after`. */
export class ProviderStopWatch {
  private runs = new Map<string, string[]>();
  constructor(readonly after = PROVIDER_STOP_AFTER) {}

  /** A trial still running: each provider it called has no verdict yet, so that provider's run is broken, not carried past it. */
  unsettled(lines: ReadonlyArray<StopLine>): void {
    for (const l of lines) if (l.outcome === 'forwarded') this.runs.delete(l.provider);
  }

  observe(trial: string, lines: ReadonlyArray<StopLine>, at = new Date()): ProviderStop | null {
    for (const [provider, v] of trialVerdicts(lines)) {
      if (!v.refused) { this.runs.delete(provider); continue; }
      const run = [...(this.runs.get(provider) ?? []), trial];
      this.runs.set(provider, run);
      if (run.length >= this.after) {
        const l = v.refused;
        return { schema: 'provider-stop/1', at: at.toISOString(), provider, after: this.after, trials: run.slice(-this.after),
          last: { status: l.status!, ...(l.error_code ? { error_code: l.error_code } : {}), ...(l.error_type ? { error_type: l.error_type } : {}) } };
      }
    }
    return null;
  }
}

/** A whole usage log: its lines grouped by trial key (slot: keys, the proxy's refusals of an unknown token, are no trial), each
 *  trial's lines in log order, the trials in the order of their first line. With since (ms), lines logged before it are left
 *  out; with settledBefore (ms), a trial whose last line is later is still running and is left out until it settles, and it
 *  breaks the run of each provider it called, so refusals on either side of it are not counted as in a row. */
export function scanUsage(lines: ReadonlyArray<StopLine>, after = PROVIDER_STOP_AFTER, at = new Date(),
  window: { since?: number; settledBefore?: number } = {}): ProviderStop | null {
  const ms = (l: StopLine) => (l.at === undefined ? NaN : Date.parse(l.at));
  const trials = new Map<string, StopLine[]>();
  for (const l of lines) {
    if (!l.key || l.key.startsWith('slot:')) continue;
    if (window.since !== undefined && !(ms(l) >= window.since)) continue;
    trials.set(l.key, [...(trials.get(l.key) ?? []), l]);
  }
  const watch = new ProviderStopWatch(after);
  for (const [key, ls] of trials) {
    if (window.settledBefore !== undefined && !(ms(ls.at(-1)!) <= window.settledBefore)) { watch.unsettled(ls); continue; }
    const stop = watch.observe(key, ls, at);
    if (stop) return stop;
  }
  return null;
}

function readUsage(file: string): StopLine[] {
  if (!existsSync(file)) return [];
  const out: StopLine[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as StopLine); } catch { /* a line still being written */ }
  }
  return out;
}

export const stopLine = (s: ProviderStop, file: string) => `HE-PROVIDER-006 ${s.provider} refused ${s.after} trials in a row for want of credit (last answer HTTP ${s.last.status}${s.last.error_code ? ' ' + s.last.error_code : ''}; trials ${s.trials.join(', ')}); the shard stops so no more trials become $0 infra records. Stop reason in ${file}. Recovery: a person tops up or fixes access for ${s.provider}, the launch check passes again, then the shard resumes`;

if (import.meta.main) {
  const [mode, ...rest] = process.argv.slice(2);
  const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  const usage = flag('--usage'), out = flag('--out'), pid = Number(flag('--signal-pid')), every = Number(flag('--every') ?? 60);
  const quiet = Number(flag('--quiet') ?? 300), started = Date.now();
  if (!usage || (mode !== 'scan' && mode !== 'watch') || (mode === 'watch' && (!out || !Number.isInteger(pid) || pid <= 1 || !(every > 0) || !(quiet >= 0)))) {
    console.error('usage: bun runner/cost/provider-stop.ts scan --usage <proxy-usage.ndjson> [--out <file>] | watch --usage <file> --out <file> --signal-pid <pid> [--every 60] [--quiet 300]');
    process.exit(2);
  }
  const check = () => {
    const stop = scanUsage(readUsage(usage), PROVIDER_STOP_AFTER, new Date(), mode === 'watch' ? { since: started, settledBefore: Date.now() - quiet * 1000 } : {});
    if (!stop) return false;
    if (out) writeFileSync(out, JSON.stringify(stop, null, 1) + '\n');
    console.error(stopLine(stop, out ?? usage));
    return true;
  };
  if (mode === 'scan') process.exit(check() ? PROVIDER_STOP_EXIT : 0);
  while (!check()) await Bun.sleep(every * 1000);
  process.kill(pid, 'SIGUSR1');
  process.exit(PROVIDER_STOP_EXIT);
}
