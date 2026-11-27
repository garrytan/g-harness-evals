// One tiny request per (provider, model) a shard will call, before it launches (docs/cost-projection.md, "Provider check").
//
// A free endpoint answers 200 on an account that is out of credit and says nothing about access to a preview model, so each
// probe is a real completion with the smallest output the provider accepts, on the exact model the shard uses. Probes go
// through the ledger's paid-request guard on their own lease in a preflight ledger, sized from the guard's own reservation
// for each probe body (xAI's reasoning ceiling included), so a probe is never refused for lease and its spend is metered.
// OpenRouter's key limit is read from its free key endpoint, unguarded. Only status, error.type and error.code ever leave
// this module: a provider's message or body can echo part of the key.
import { existsSync } from 'node:fs';
import { BudgetExceededError, BudgetRun, initLedger, installPaidRequestGuard, ledgerPaths, ledgerStatus, priceRequest, reservationUsd, setProgramCap, unguardedFetch } from '../ledger/budget-ledger.ts';
import { canonicalLookup, priceOnDate } from '../pricing/model-pricing.ts';
import { KEY_ENV, OPENROUTER_MODELS, UPSTREAM, type ProviderName } from '../proxy/metering-proxy.ts';
import { RunnerError } from '../errors.ts';
import { creditRefusal } from './provider-stop.ts';

export type ProbeCode = 'HE-PROVIDER-001' | 'HE-PROVIDER-002' | 'HE-PROVIDER-003' | 'HE-PROVIDER-004' | 'HE-PROVIDER-005';
const PROBED = ['anthropic', 'openai', 'xai', 'google', 'openrouter', 'particle'] as const;
type Probed = typeof PROBED[number];

export const BILLING: Record<Probed, string> = {
  anthropic: 'https://console.anthropic.com/settings/billing',
  openai: 'https://platform.openai.com/settings/organization/billing',
  xai: 'https://console.x.ai (the team\'s billing page)',
  google: 'https://console.cloud.google.com/billing (the AI Studio key\'s project)',
  openrouter: 'https://openrouter.ai/settings/credits',
  particle: 'the Particle dashboard\'s billing page',
};

const MEANING: Record<ProbeCode, string> = {
  'HE-PROVIDER-001': 'key missing, rejected or without access',
  'HE-PROVIDER-002': 'out of credit or past a spending limit',
  'HE-PROVIDER-003': 'model not available to this key, or the probe was rejected',
  'HE-PROVIDER-004': 'rate limited twice',
  'HE-PROVIDER-005': 'not answering',
};

export interface ProbeTarget { provider: Probed; model: string }

export interface ProbeAnswer {
  provider: string;
  model: string;
  ok: boolean;
  status: number | null;
  code?: ProbeCode;
  error_type?: string;
  error_code?: string;
  attempts: number;
  reason: string;
}

export interface KeyLimit { checked: boolean; limit_remaining_usd: number | null; lease_usd: number | null; ok: boolean; code?: ProbeCode; reason: string }

/** The distinct (provider, model) pairs of provider:model ids. A provider the probe cannot reach is bad input. */
export function probeTargets(models: string[]): ProbeTarget[] {
  const seen = new Map<string, ProbeTarget>();
  for (const id of models) {
    const i = id.indexOf(':');
    const provider = id.slice(0, i) as Probed;
    const model = id.slice(i + 1);
    if (i < 1 || !model) throw new RunnerError('HE-BUDGET-007', `model ${JSON.stringify(id)} is not a provider:model id`);
    if (!PROBED.includes(provider)) throw new RunnerError('HE-BUDGET-007', `no provider check for ${provider} (model ${id}); the check covers ${PROBED.join(', ')}`);
    seen.set(`${provider}:${model}`, { provider, model });
  }
  return [...seen.values()];
}

const PROMPT = 'Reply with OK.';

/** The probe for one target: the smallest output each provider accepts, on the shard's exact model. */
export function probeRequest(t: ProbeTarget, key: string, at = new Date()): { url: string; body: Record<string, unknown>; headers: Record<string, string> } {
  const json = { 'content-type': 'application/json' };
  const bearer = { ...json, authorization: `Bearer ${key}` };
  const chat = [{ role: 'user', content: PROMPT }];
  switch (t.provider) {
    case 'anthropic':
      return { url: `${UPSTREAM.anthropic}/v1/messages`, headers: { ...json, 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: { model: t.model, max_tokens: 1, messages: chat } };
    case 'openai':
      return { url: `${UPSTREAM.openai}/v1/responses`, headers: bearer, body: { model: t.model, input: PROMPT, max_output_tokens: 16, reasoning: { effort: 'low' }, store: false } };
    case 'xai':
      return { url: `${UPSTREAM.xai}/v1/chat/completions`, headers: bearer, body: { model: t.model, messages: chat, max_completion_tokens: 1 } };
    case 'google':
      return { url: `${UPSTREAM.google}/v1beta/models/${t.model}:generateContent`, headers: { ...json, 'x-goog-api-key': key },
        body: { contents: [{ role: 'user', parts: [{ text: PROMPT }] }], generationConfig: { maxOutputTokens: 16, thinkingConfig: { thinkingBudget: 128 } } } };
    case 'particle':
      return { url: `${UPSTREAM.particle}/v1/chat/completions`, headers: bearer, body: { model: t.model, messages: chat, max_tokens: 16 } };
    case 'openrouter': {
      const pin = OPENROUTER_MODELS[t.model];
      const row = canonicalLookup(`openrouter:${t.model}`);
      if (!pin || !row) throw new RunnerError('HE-BUDGET-007', `openrouter:${t.model} has no endpoint pin or price row in the metering proxy, so the shard's own calls would be refused too`);
      const price = priceOnDate(row, at);
      return { url: `${UPSTREAM.openrouter}/v1/chat/completions`, headers: bearer, body: { model: t.model, messages: chat, max_tokens: 16,
        provider: { only: [pin.only], allow_fallbacks: false, max_price: { prompt: price.input, completion: price.output } }, ...(pin.service_tier ? { service_tier: pin.service_tier } : {}) } };
    }
  }
}

const SAFE = /^[A-Za-z0-9_.-]{1,64}$/;

/** status, error.type and error.code from an error body, kept only when they are short identifiers. */
function errorFields(text: string, key: string): { error_type?: string; error_code?: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return {}; }
  const root = Array.isArray(parsed) ? parsed[0] : parsed;
  const e = root && typeof root === 'object' ? (root as Record<string, unknown>).error : undefined;
  const o = (e && typeof e === 'object' ? e : root && typeof root === 'object' ? root : {}) as Record<string, unknown>;
  const safe = (v: unknown) => typeof v === 'string' && SAFE.test(v) && !(v.length >= 6 && key.includes(v)) && !v.includes(key);
  const type = [o.type, o.status].find(safe) as string | undefined;
  const code = [o.code].find(v => safe(v) || typeof v === 'number');
  return { ...(type ? { error_type: type } : {}), ...(code !== undefined ? { error_code: String(code) } : {}) };
}

/** One answer's verdict. retry names the one retry an answer earns: a plain rate limit, or a server error or timeout. */
export function classify(status: number | null, text: string): { ok: boolean; code?: ProbeCode; retry?: 'rate' | 'server' } {
  if (status === null || status >= 500) return { ok: false, code: 'HE-PROVIDER-005', retry: 'server' };
  if (status >= 200 && status < 300) {
    try {
      const body = JSON.parse(text) as unknown;
      if (body && typeof body === 'object' && !(body as { error?: unknown }).error) return { ok: true };
    } catch { /* not a completion */ }
    return { ok: false, code: 'HE-PROVIDER-003' };
  }
  if (creditRefusal(status, text)) return { ok: false, code: 'HE-PROVIDER-002' };
  if (status === 401 || status === 403) return { ok: false, code: 'HE-PROVIDER-001' };
  if (status === 429) return { ok: false, code: 'HE-PROVIDER-004', retry: 'rate' };
  return { ok: false, code: 'HE-PROVIDER-003' };
}

function reasonFor(t: { provider: string; model: string }, code: ProbeCode | undefined, status: number | null, f: { error_type?: string; error_code?: string }): string {
  if (!code) return `${t.provider}:${t.model} answered ${status}`;
  const detail = [status === null ? 'no answer' : `status ${status}`, f.error_type && `type ${f.error_type}`, f.error_code && `code ${f.error_code}`].filter(Boolean).join(', ');
  const next = code === 'HE-PROVIDER-002' ? `a person tops up or raises the limit at ${BILLING[t.provider as Probed]}, then reruns the preflight`
    : code === 'HE-PROVIDER-001' ? `check that ${KEY_ENV[t.provider as ProviderName]} is the project's key for ${t.provider} and has access to ${t.model}, then rerun`
    : code === 'HE-PROVIDER-003' ? `check the model id against the provider's model list and the plan; a model this key cannot call will fail every trial`
    : 'rerun the preflight in a few minutes';
  return `${code} ${t.provider}:${t.model} ${MEANING[code]} (${detail}); next: ${next}`;
}

export interface ProbeOptions {
  env: Record<string, string | undefined>;
  /** Where probe spend is metered (<dest>/preflight-ledger.sqlite). */
  ledgerPath: string;
  /** The transport behind the guard; tests route the real provider URLs to a fake. */
  fetchImpl?: typeof fetch;
  /** OpenRouter's free key read, outside the guard. */
  rawFetch?: typeof fetch;
  /** The shard's lease, compared with OpenRouter's limit_remaining. */
  leaseUsd?: number | null;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  now?: Date;
}

export interface ProbeReport { answers: ProbeAnswer[]; key_limit: KeyLimit | null; lease_usd: number; spent_usd: number; ledger: string }

/** Probe every target once (one retry where classify allows), metered in the preflight ledger. */
export async function runProbes(targets: ProbeTarget[], o: ProbeOptions): Promise<ProbeReport> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const timeoutMs = o.timeoutMs ?? 60_000;
  const answers: ProbeAnswer[] = [];
  const planned: Array<{ t: ProbeTarget; key: string; req: ReturnType<typeof probeRequest> }> = [];
  for (const t of targets) {
    const key = o.env[KEY_ENV[t.provider]];
    if (!key) { answers.push({ ...t, ok: false, status: null, code: 'HE-PROVIDER-001', attempts: 0, reason: `HE-PROVIDER-001 ${t.provider}:${t.model} key missing: ${KEY_ENV[t.provider]} is not set on this machine; next: run the preflight where the launch's keys are` }); continue; }
    planned.push({ t, key, req: probeRequest(t, key, o.now) });
  }
  let lease = 0;
  for (const { t, req } of planned) {
    let price;
    try { price = priceRequest(req.url, req.body, { now: o.now }); } catch (e) {
      if (e instanceof BudgetExceededError) throw new RunnerError('HE-BUDGET-007', `the ledger cannot price the ${t.provider}:${t.model} probe: ${e.message}`);
      throw e;
    }
    if (!price) throw new RunnerError('HE-BUDGET-007', `the ledger does not meter ${req.url}; the probe would go unmetered`);
    lease += 2 * reservationUsd(price);
  }
  lease = Math.ceil(lease * 100) / 100 + 0.01;
  const ledger = ledgerPaths(o.ledgerPath).ledger;
  if (!existsSync(ledger)) initLedger({ ledgerPath: ledger, programCapUsd: lease, reason: 'launch preflight provider probes' });
  else {
    const s = ledgerStatus({ ledgerPath: ledger });
    const committed = s.totals.committed_usd;
    if ((s.totals.program_cap_usd ?? 0) - committed < lease) setProgramCap({ ledgerPath: ledger, programCapUsd: Math.ceil((committed + lease) * 100) / 100, reason: 'launch preflight provider probes: room for one more probe pass' });
  }
  const run = BudgetRun.open({ runner: 'launch-preflight', budgetUsd: lease, ledgerPath: ledger });
  const guard = installPaidRequestGuard(run, o.fetchImpl ? { fetchImpl: o.fetchImpl } : {});
  try {
    for (const { t, key, req } of planned) {
      let status: number | null = null, text = '', attempts = 0, verdict: ReturnType<typeof classify> = { ok: false };
      for (;;) {
        attempts++;
        let retryAfter = 5;
        try {
          const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: AbortSignal.timeout(timeoutMs) });
          status = res.status;
          text = await res.text();
          const ra = Number(res.headers.get('retry-after'));
          if (Number.isFinite(ra) && ra > 0) retryAfter = ra;
        } catch (e) {
          if (e instanceof BudgetExceededError) throw new RunnerError('HE-BUDGET-007', `the preflight lease refused the ${t.provider}:${t.model} probe: ${e.message}`);
          status = null;
          text = '';
        }
        verdict = classify(status, text);
        if (verdict.ok || !verdict.retry || attempts > 1) break;
        await sleep(verdict.retry === 'rate' ? Math.min(retryAfter, 30) * 1000 : 2000);
      }
      const f = verdict.ok ? {} : errorFields(text, key);
      answers.push({ ...t, ok: verdict.ok, status, ...(verdict.code ? { code: verdict.code } : {}), ...f, attempts, reason: reasonFor(t, verdict.code, status, f) });
    }
  } finally {
    guard.uninstall();
  }
  const spent = run.close().actual_usd;
  const key_limit = targets.some(t => t.provider === 'openrouter') ? await openrouterKeyLimit(o) : null;
  return { answers, key_limit, lease_usd: lease, spent_usd: spent, ledger };
}

/** OpenRouter's free key endpoint: refuse when limit_remaining is below the shard's lease. A null limit is no limit. */
export async function openrouterKeyLimit(o: Pick<ProbeOptions, 'env' | 'rawFetch' | 'leaseUsd' | 'timeoutMs'>): Promise<KeyLimit> {
  const key = o.env[KEY_ENV.openrouter];
  const lease = o.leaseUsd ?? null;
  if (!key) return { checked: false, limit_remaining_usd: null, lease_usd: lease, ok: false, code: 'HE-PROVIDER-001', reason: 'HE-PROVIDER-001 openrouter key missing: OPENROUTER_API_KEY is not set on this machine' };
  type KeyBody = { data?: { limit_remaining?: number | null } } | null;
  let status: number | null = null;
  let body: KeyBody = null as KeyBody;
  try {
    const res = await (o.rawFetch ?? unguardedFetch)(`${UPSTREAM.openrouter}/v1/key`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(o.timeoutMs ?? 60_000) });
    status = res.status;
    body = res.ok ? await res.json() as KeyBody : null;
  } catch { status = null; }
  if (status !== 200 || !body?.data) {
    const code: ProbeCode = status === 401 || status === 403 ? 'HE-PROVIDER-001' : 'HE-PROVIDER-005';
    return { checked: true, limit_remaining_usd: null, lease_usd: lease, ok: false, code, reason: `${code} openrouter key limit unreadable (${status === null ? 'no answer' : `status ${status}`}); next: rerun, and check OPENROUTER_API_KEY if it repeats` };
  }
  const left = body.data.limit_remaining;
  if (typeof left !== 'number') return { checked: true, limit_remaining_usd: null, lease_usd: lease, ok: true, reason: 'openrouter key has no credit limit set' };
  if (lease !== null && left < lease) {
    return { checked: true, limit_remaining_usd: left, lease_usd: lease, ok: false, code: 'HE-PROVIDER-002', reason: `HE-PROVIDER-002 openrouter key has $${left.toFixed(2)} left, below the shard's $${lease.toFixed(2)} lease; next: a person raises the key's limit or adds credit at ${BILLING.openrouter}, then reruns the preflight` };
  }
  return { checked: true, limit_remaining_usd: left, lease_usd: lease, ok: true, reason: `openrouter key has $${left.toFixed(2)} left${lease === null ? '' : ` for a $${lease.toFixed(2)} lease`}` };
}
