/**
 * Metering proxy: the only network exit for provider calls a memory system
 * (or a gbrain subprocess) makes. Requests arrive at
 * `/<slot>/<provider>/<path>` (or `/<provider>/<path>`, slot `default`) and
 * are forwarded to the provider after they are priced.
 *
 * Every mode fails closed on price: a request to a paid provider that the
 * budget ledger cannot price (unknown model, no model) is refused with HTTP
 * 402 and never forwarded.
 *
 * Two modes:
 *   in-process (Cat 40, chronicle, P4 stream, P8): the client is a gbrain
 *     child process of this harness. Its credentials are forwarded and the
 *     process-wide paid-request guard (or a slot allowance) reserves each
 *     request, as before the extraction. A 4xx answer without usage is
 *     metered at $0, as in lease mode.
 *   lease (the shootout cell, `policy` set): the proxy holds a lease run in
 *     its own ledger (`BudgetRun.openLease`) and enforces it itself. It strips
 *     inbound credentials and injects the real key from its own environment,
 *     allows only listed provider routes and priced models, bounds input
 *     tokens by request bytes (a token covers at least one byte), injects or
 *     enforces an output-token cap so the provider enforces the bound,
 *     reserves the worst case before forwarding (concurrent requests serialize
 *     on the ledger, so they cannot overspend the lease), meters streamed
 *     responses from their final usage events (a stream that ended before
 *     them, by truncation, an error event or a lost connection, is charged
 *     the larger of its reservation and the partial usage it reported, and
 *     its usage line says why), settles an error answer without usage at $0
 *     when the provider does not bill it (any 4xx, and the 5xx answers
 *     runner/ledger/budget-ledger.ts unbilledAnswer lists with each
 *     provider's docs; any other 5xx, a timeout or a lost connection keeps
 *     the reservation, and its usage line carries usage_unknown with the
 *     reported_usd the provider's usage did report), refuses
 *     bodies carrying a forbidden marker (the sanitizer's leak tripwire), and
 *     appends one usage line per request (never a body or a key).
 *
 * Attribution across processes (lease mode): the harness binds a slot (the
 * path segment a shim's base URL carries) to a key around each question or
 * namespace ingest and reads the key's meter afterwards, through
 * `POST /__proxy/bind {slot, key, token?, models?, ablation?, max_requests?, collect_requests?, install?}`, `POST /__proxy/unbind {slot}`,
 * `POST /__proxy/finalize {key}` and `POST /__proxy/requests {key}` (internal-task Phase B, SlotLimits). With `--control-token` (or
 * SHOOTOUT_PROXY_CONTROL_TOKEN) these need the `x-proxy-control` header, so a
 * vendor container cannot move charges.
 *
 * In lease mode a provider request is forwarded only for a bound slot: an
 * unbound slot is refused (403, logged under `slot:<id>` as refused) so a
 * host that reaches the port cannot spend the lease through the proxy's key.
 * A slot bound with a `token` also requires the request to present that token
 * as its credential (x-api-key or Authorization: Bearer), and a request without
 * it is refused and logged under `slot:<id>` too, never under the trial's meter
 * (a request nobody authenticated is nobody's usage); the runner binds each
 * trial's slot with a random per-trial token and hands only the token to the
 * harness, and the gbrain sidecar's slot with its own token. A slot bound
 * without a token (the embedded image build) accepts any credential while bound.
 * In lease mode a slot bound with `models` (a list of provider:model ids;
 * in-process mode ignores it) forwards only requests for those models: any other priced model, or a free count_tokens request for one, is refused 403 before
 * reserving or forwarding, logged with its model and the reason, at $0, inside the run-wide
 * `--allow-models` bound, which still applies. A bind without `models` adds no
 * per-slot limit.
 *
 * Prompt archaeology: a lease proxy started with `--ablation-log <file>` accepts a bind with
 * `ablation: {map, map_sha256, layers}`. It recomputes the map file's sha256 and refuses the bind (400) on a
 * mismatch or a layer the map does not name. Every generation request on that slot then has those layers cut out by
 * runner/proxy/ablate.ts after it is parsed and before the output cap is injected and the request priced and
 * reserved, and each forwarded request appends one receipt line to the file (spans' sha256, never text). A slot bound
 * without `ablation` is forwarded exactly as before. Usage lines carry `cache_write_tokens` (usage-line schema v1,
 * below).
 *
 * The proxy never listens on a wildcard address (0.0.0.0, ::, or an empty
 * host): the runner binds it to the loopback, or to the docker bridge gateway
 * when containers must reach it, and `start()` throws on anything else.
 *
 * Standalone (lease mode):
 *   bun runner/proxy/metering-proxy.ts --listen 172.17.0.1:8787 --budget-ledger <file> --lease-usd <n> --run-id <id>
 *     [--usage-log <file>] [--allow-models openai:gpt-4.1-mini,...] [--max-output-tokens 32768] [--free-count-tokens]
 *     [--forbidden-markers <file>] [--streaming meter|refuse] [--upstream openai=http://...] [--new-run] [--control-token <t>] [--ablation-log <file>] [--log-sections]
 *     [--route-texts <file.json>] [--refuse-hosted-tools] [--capture-bodies <dir> [--capture-max-bytes <n>]] [--google-via openrouter]
 *   bun runner/proxy/metering-proxy.ts summary --budget-ledger <file> --run-id <id> [--usage-log <file>]
 *
 * One lease ledger can hold a cell's reruns: each run id is its own lease, the
 * output cap is recorded with the lease, and `--new-run` closes a lease still
 * open in the file before opening the next one.
 *
 * Usage-line schema v1 (internal-task): every forwarded line carries cache_write_tokens, cache_write_1h_tokens and
 * reasoning_tokens (0 when the provider reported none), read after the request was charged. With --log-sections a
 * forwarded Anthropic /v1/messages, OpenAI /v1/responses or /v1/chat/completions line also carries `sections` (the
 * request's byte partition and digests, read before the proxy changes the body) and `tools_called`, or
 * `sections_error` when they could not be read (runner/proxy/sections.ts). Neither changes what is forwarded, reserved
 * or charged, and neither writes request or response text.
 *
 * Route copies (internal-task, H10): with `--route-texts <file.json>` ({copies: [text, ...], listing: [text, ...]}) a slot bound
 * with `routes: true` gets two more fields on each forwarded or failed usage line: `route_copies`, the occurrences of the
 * `copies` texts (the rule and the placebo) in the request by where they sit (routeCopies), plus `listing`, the occurrences
 * of the `listing` texts (skill descriptions) outside tool results; and `housekeeping: true` on a request for a model other
 * than the slot's first bound model (a harness's own utility model), which carries no route_copies. count_tokens and
 * refused lines never carry either. Counts only: no text from the request reaches the log. Without the flag, or on a slot
 * bound without `routes`, every line is byte-identical to the proxy before this change.
 *
 * Effort (internal-task): every forwarded or failed line records the effort fields the request set, each as sent
 * (runner/proxy/effort.ts): `reasoning_effort`, `output_config_effort`, `thinking_type`, `thinking_budget_tokens`, and
 * `unrecognized_effort_fields` for a field whose value is not a known one. Record only: no request is refused or changed
 * for its effort. `effortCounts` turns a trial's lines into calls per effort setting.
 *
 * Hosted web tools (internal-task): with `--refuse-hosted-tools` a request that declares a provider-hosted search or fetch tool
 * (runner/proxy/hosted-tools.ts) is refused with HTTP 400 and HE-PROXY-006 before it is priced or forwarded, and its
 * refused line names the declarations in its reason. Without the flag nothing changes.
 *
 * Request-body capture (internal-task): a lease proxy started with `--capture-bodies <root>` accepts a bind with `capture: "<dir>"`,
 * a directory under the root (the trial's directory). Every request the proxy then sends upstream for that slot is appended to
 * `<root>/<dir>/proxy-requests.ndjson` first, hash-chained and capped at `--capture-max-bytes` (256 MiB by default), with no
 * header and no query string (runner/proxy/capture.ts). Finalizing the slot's key closes the file. A capture that cannot be
 * written refuses the request (HE-PROXY-007) and releases its reservation. Without the flag, or on a slot bound without
 * `capture`, nothing is written.
 *
 * Output cap: `--max-output-tokens` sets the cap for one proxy start (and its lease); set it to the harness's own
 * max output, since a request naming more is refused. Without it the cap is DEFAULT_MAX_OUTPUT_TOKENS.
 *
 * Google and xAI (internal-task): `/<slot>/google/v1beta/models/<model>:generateContent` and `:streamGenerateContent?alt=sse`
 * go to the Gemini API, the model read from the path. The per-trial token arrives in x-goog-api-key (Gemini CLI's header)
 * and GEMINI_API_KEY leaves in x-goog-api-key, never as a Bearer or a `key` query parameter, which the proxy drops. The
 * output cap is `generationConfig.maxOutputTokens`, at most the model's own limit (GEMINI_MAX_OUTPUT), and a request asking
 * for a candidateCount other than 1 is refused (HE-PROXY-013); a stream settles from its last usageMetadata (budget-ledger.ts
 * streamUsageCost) and counts as unfinished until a candidate reports a finishReason. A stream request without alt=sse is
 * refused (HE-PROXY-013). countTokens is answered by a local estimate (countTokensEstimate), never forwarded or charged,
 * and logged with the outcome `estimated`, which no reader counts as a model request or response. Gemini CLI reaches
 * Gemini this way by default (scripts/frontier-harbor/vm-run.sh), and so do Hermes, OpenClaw and Pi on Gemini 4 Carbon and
 * Hydrogen (amendment 2 of frontier-shootout-2026-11). The google route also takes GOOGLE_HOST_SEGMENT, exactly once, in
 * front of the API version (`/<slot>/google/generativelanguage.googleapis.com/v1beta/...`) and drops it: Hermes v0.23.1
 * uses its native Gemini client only for a base URL that contains that host name.
 *
 * Every forwarded line records the answer's finish reason (`finish_reason`, stops.ts finishReason), and a line whose
 * answer was not 2xx records its Retry-After header and its error body (`retry_after`, `error_body` or `error_text`,
 * errorFacts), every credential masked: logging only, on every route (amendment 2, rulings B and C).
 *
 * `/<slot>/xai/v1/chat/completions` and `/v1/responses` go to api.x.ai with XAI_API_KEY as a
 * Bearer; reasoning tokens bill as output beside completion tokens, and each forwarded line records xAI's own
 * `usage.cost_in_usd_ticks` (1e-10 USD) when the answer carries it. A Responses request is sent with `store: false`,
 * and one naming `previous_response_id` is refused (HE-PROXY-013). On both routes a provider-hosted tool (grounding,
 * code execution, URL context, xAI's server-side search) is refused with HE-PROXY-006 with or without
 * --refuse-hosted-tools, since the proxy cannot price its per-call fees.
 *
 * Muse Code (internal-task): `/<slot>/openrouter/v1/responses` forwards OpenRouter's Responses API for the models in
 * MUSE_CODE_CATALOG only (any other OpenRouter model there is refused 403), pinned, priced and capped
 * (`max_output_tokens`) like a Chat Completions request; one naming `previous_response_id` is refused (HE-PROXY-013). Muse
 * Code reads its model catalog from `GET /muse-code/models` at the root of its base URL's origin, outside any slot; the
 * proxy answers that itself with MUSE_CODE_CATALOG, never forwarded or metered. OpenRouter's Responses bodies name no
 * served provider in its docs, so on that route `served_elsewhere` is set only when a body names a provider other than
 * the pinned one.
 *
 * Google via OpenRouter (internal-task), Gemini CLI's named fallback (vm-run.sh --gemini-cli-route openrouter-fallback, never the
 * default): with `--google-via openrouter` the google route keeps its Gemini API face, but each
 * generateContent or streamGenerateContent request is translated to OpenRouter's Chat Completions for `google/<model>`
 * (runner/proxy/gemini-openrouter.ts), then pinned, priced, keyed (OPENROUTER_API_KEY) and checked for its served provider
 * exactly as an OpenRouter request; the answer, streamed or not, goes back to the harness as Gemini's, thought signatures
 * included. GEMINI_API_KEY is not read. Every google line in this mode carries `upstream: "openrouter"`, and a request the
 * translation cannot carry (cachedContent, file URIs, non-image media, multimodal tool results, other tool kinds) is refused
 * with HE-PROXY-012.
 *
 * Install slots (internal-task, the gbrain install eval): a lease-mode bind with `install: true` (it needs `token` and `models`, and
 * is refused on a proxy started with --refuse-hosted-tools) writes one usage line for every request that reaches the slot,
 * forwarded or refused, with `kind: "install_slot"`, `method`, `endpoint` (endpointClass), the model it names, `token_presented`,
 * a sanitized `user_agent`, the `status` the proxy answered and `non_harness`. A request is the harness's own model call only
 * when it presents the token and is a generation or count_tokens call for a bound model, or a GET /v1/models metadata read
 * (forwarded free as before). A tool that inherits the harness's environment presents the token too (the Claude Code and
 * Hermes adapters export it there today), so a same-model call from such a tool counts as the harness's own. Any other
 * request (no token, an embeddings call, another route, another model) is `non_harness: true` and refused 403 at $0
 * (HE-PROXY-010), logged under `slot:<id>` when it lacks the token, as before. Provider-hosted web tools stay allowed:
 * a forwarded generation line carries `web_search_calls`, `web_search_usd`, `web_fetch_calls` and `web_fetch_usd`, read from the
 * response (runner/proxy/hosted-tools.ts webToolUse) and priced from the price table's `tool_fees`, and the fees are charged to
 * the key and the lease on top of tokens. The reservation adds each declared tool's fee times its `max_uses`, or times 20 calls
 * when the request sets none (webToolAllowance), and the request settles at the calls the response reports, as overshoot when
 * it ran more. A hosted web tool with no fee row (OpenAI web_search_preview, Chat Completions web_search_options) is refused 400
 * on an install slot (HE-PROXY-011). `summary` adds per-key install totals (installTotals). A slot bound without `install`
 * behaves exactly as before.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { BudgetExceededError, BudgetRun, geminiStreamIncomplete, jsonOrNull, ledgerStatus, priceRequest, readBody, reservationUsd, sseIncomplete, sseUsage, streamUsageCost, unbilledAnswer, usageCost, type BudgetAllowance } from '../ledger/budget-ledger.ts';

export { sseIncomplete, sseUsage };
import { findLeaks } from './sanitize.ts';
import type { RouteCopies } from '../contracts.ts';
import type { AblationBinding, AblationReceipt, AblationSpec } from './ablate.ts';
import { requestSections, responseExtras, sectionRoute, type RequestSections } from './sections.ts';
import { effortFields } from './effort.ts';
import { hostedWebTools, unpricedWebTools, webToolAllowance, webToolUse } from './hosted-tools.ts';
import { finishReason, safetyStop } from './stops.ts';
import { countTokensEstimate, fromChat, GeminiStream, geminiError, SignatureStore, toChat, TranslationRefused, VIA_OPENROUTER } from './gemini-openrouter.ts';
import { BodyCapture, CAPTURE_FILE, DEFAULT_CAPTURE_MAX_BYTES } from './capture.ts';
import { canonicalLookup, priceOnDate } from '../pricing/model-pricing.ts';

export { effortCounts, effortFields, REASONING_EFFORTS, THINKING_LEVELS, THINKING_TYPES } from './effort.ts';

export const UPSTREAM: Record<string, string> = { anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com', voyage: 'https://api.voyageai.com', particle: 'https://api.particle.ai', openrouter: 'https://openrouter.ai/api',
  google: 'https://generativelanguage.googleapis.com', xai: 'https://api.x.ai' };
export type ProviderName = 'anthropic' | 'openai' | 'voyage' | 'particle' | 'openrouter' | 'google' | 'xai';

/**
 * The OpenRouter models a lease proxy forwards, each pinned to one endpoint: `only` is the provider slug the proxy sends in
 * `provider.only`, `served` the name OpenRouter reports in the response's `provider` field when that endpoint answered.
 * The proxy also sends `allow_fallbacks: false` and `max_price` at the model's price-table row (`openrouter:<id>`, the
 * endpoint's peak rates), and refuses a request naming any other model, a variant suffix, a `models` list, `route` or
 * `plugins` (HE-PROXY-008). A pin with `service_tier` also sends that tier (`default`, OpenRouter's standard tier, which keeps
 * the provider's flex and priority endpoints out of the pool) and refuses a request that sets another `service_tier` or
 * `speed`. A 2xx answer that names another provider, or none, or another tier than the pinned one, is marked
 * `served_elsewhere` (HE-PROXY-009), which makes the trial infra_error (runner/trial/trial.ts trialTermination).
 */
export interface OpenRouterPin { only: string; served: string; service_tier?: 'default' }
export const OPENROUTER_MODELS: Record<string, OpenRouterPin> = {
  'deepseek/deepseek-v4.1-flash-1017': { only: 'deepseek', served: 'DeepSeek' },
  // openrouter.ai/api/v1/models/<id>/endpoints, read 2026-11-15: each maker's own endpoint. Gemini goes to Google AI Studio's
  // standard endpoint (tag google-ai-studio, service_tier null; read 2026-11-16), never google-vertex/* or AI Studio's flex
  // or priority endpoints, under the provider-terms ruling of 2026-11-16.
  'google/gemini-4-carbon': { only: 'google-ai-studio', served: 'Google AI Studio', service_tier: 'default' },
  'google/gemini-4-hydrogen': { only: 'google-ai-studio', served: 'Google AI Studio', service_tier: 'default' },
  'meta/muse-wonder': { only: 'meta', served: 'Meta' },
  'moonshotai/kimi-k3.1-pro': { only: 'moonshotai', served: 'Moonshot AI' },
  // GLM 5.3 goes to Baidu's fp8 endpoint (tag baidu/fp8, service_tier null; read 2026-11-16), not Z.AI's own, under the same
  // ruling. Baidu lists tools, tool_choice auto and none (not required), reasoning, include_reasoning, reasoning_effort and
  // max_tokens, with max_completion_tokens 131,072 at Z.AI's rates.
  'z-ai/glm-5.3': { only: 'baidu/fp8', served: 'Baidu', service_tier: 'default' },
};
/**
 * Gemini CLI's housekeeping models (frontier_settings.py GEMINI_CLI_HOUSEKEEPING), each pinned to one endpoint like the
 * models above. Only the google route's via-OpenRouter mode forwards them, for a slot that lists them as google:<model>;
 * the openrouter route refuses them. openrouter.ai/api/v1/models/<id>/endpoints, read 2026-11-16: Google AI Studio's
 * standard endpoint serves both (for gemini-3.1-pro-preview-customtools it is the only one), pinned at its standard tier
 * like the cell models above.
 */
export const GEMINI_HOUSEKEEPING_MODELS: Record<string, OpenRouterPin> = {
  'google/gemini-3-flash-preview': { only: 'google-ai-studio', served: 'Google AI Studio', service_tier: 'default' },
  'google/gemini-3.1-pro-preview-customtools': { only: 'google-ai-studio', served: 'Google AI Studio', service_tier: 'default' },
};
const OPENROUTER_PINS: Record<string, OpenRouterPin> = { ...OPENROUTER_MODELS, ...GEMINI_HOUSEKEEPING_MODELS };
/** The catalog Muse Code reads at startup (GET <origin>/muse-code/models, Meta's shape {data: [{id}]}): the one OpenRouter
 *  model it runs on here, by OpenRouter's id, which is the id it then sends. */
export const MUSE_CODE_CATALOG = { data: [{ id: 'meta/muse-wonder' }] };
/**
 * The output cap of a Gemini model on OpenRouter, below the run's cap: Google's standard output limit of 65,536 tokens
 * (ai.google.dev/gemini-api/docs/models), which Google AI Studio's endpoint lists too. Vertex's global endpoint lists more for Gemini 4, its long-decode mode;
 * the translation does not carry long-decode continuations (gemini-openrouter.ts), so a request is held to 65,536.
 */
export const OPENROUTER_MAX_OUTPUT: Record<string, number> = {
  'google/gemini-4-carbon': 65_536, 'google/gemini-4-hydrogen': 65_536,
  'google/gemini-3-flash-preview': 65_536, 'google/gemini-3.1-pro-preview-customtools': 65_536,
};
/** The same output caps on the google route's native mode, by Gemini model id: Google's standard output limit, so a request
 *  that states none is sent with 65,536, not the run's larger cap, which Google would refuse. */
export const GEMINI_MAX_OUTPUT: Record<string, number> = Object.fromEntries(Object.entries(OPENROUTER_MAX_OUTPUT).map(([m, n]) => [m.replace(/^google\//, ''), n]));
type Send = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Anthropic's token counter. Providers do not bill it. Only a lease proxy started with --free-count-tokens (the Lane B
 *  bridge, docs/gstack-laneb.md) forwards it, for a bound slot (with the slot's token) and an allowed model, without a
 *  price, a reservation or a charge, logging one line at $0. The Lane B proxy calls it before every request to bound that
 *  request's worst case. Every other lease proxy refuses it (403) as before, so harness lanes and their receipts are
 *  unchanged. */
export const COUNT_TOKENS_ROUTE = '/v1/messages/count_tokens';

/** The Gemini generation routes; the model is the path segment before the method. */
const GOOGLE_ROUTE = /^\/v1(beta)?\/models\/([A-Za-z0-9._-]+):(generateContent|streamGenerateContent)$/;
/** The one path segment the google route takes in front of the API version and drops (amendment 2 of frontier-shootout-2026-11):
 *  Hermes v0.23.1 picks its native Gemini client only when its base URL contains this host name
 *  (agent/gemini_native_adapter.py is_native_gemini_base_url, a substring test), so its base URL is <slot>/google/<this>/v1beta. */
export const GOOGLE_HOST_SEGMENT = '/generativelanguage.googleapis.com/';
/** Gemini's token counter, answered by the proxy itself on the google route (countTokensEstimate) and never forwarded. */
const GOOGLE_COUNT_ROUTE = /^\/v1(beta)?\/models\/([A-Za-z0-9._-]+):countTokens$/;

/** Lease mode forwards only these routes (and COUNT_TOKENS_ROUTE under freeCountTokens). GET model listings are free metadata reads. */
const ROUTES: Record<ProviderName, Array<{ method: string; path: RegExp }>> = {
  openai: [
    { method: 'POST', path: /^\/v1\/chat\/completions$/ }, { method: 'POST', path: /^\/v1\/responses$/ }, { method: 'POST', path: /^\/v1\/embeddings$/ },
    { method: 'GET', path: /^\/v1\/models(\/[^/]+)?$/ },
  ],
  anthropic: [{ method: 'POST', path: /^\/v1\/messages$/ }],
  voyage: [{ method: 'POST', path: /^\/v1\/embeddings$/ }, { method: 'POST', path: /^\/v1\/rerank$/ }],
  // Particle serves OpenAI Chat Completions over HTTP and nothing else a harness needs: no Responses over HTTP, no embeddings.
  particle: [{ method: 'POST', path: /^\/v1\/chat\/completions$/ }],
  // OpenRouter: Chat Completions, and the Responses API for Muse Code's catalog only (OPENROUTER_MODELS pins the endpoint on both).
  openrouter: [{ method: 'POST', path: /^\/v1\/chat\/completions$/ }, { method: 'POST', path: /^\/v1\/responses$/ }],
  // Gemini: generation only; countTokens, caches, files and model listings are not forwarded.
  google: [{ method: 'POST', path: GOOGLE_ROUTE }],
  xai: [{ method: 'POST', path: /^\/v1\/chat\/completions$/ }, { method: 'POST', path: /^\/v1\/responses$/ }],
};
/** scripts/ubicloud/provider-keys.sh lists the same keys, VOYAGE_API_KEY aside (tests/provider-keys.test.ts). */
export const KEY_ENV: Record<ProviderName, string> = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', voyage: 'VOYAGE_API_KEY', particle: 'PARTICLE_API_KEY', openrouter: 'OPENROUTER_API_KEY', google: 'GEMINI_API_KEY', xai: 'XAI_API_KEY' };
const CREDENTIAL_HEADERS = ['authorization', 'x-api-key', 'x-goog-api-key', 'api-key', 'openai-organization', 'openai-project', 'cookie', 'proxy-authorization'];
export const DEFAULT_MAX_OUTPUT_TOKENS = 32_768;
/** A provider call may run this long (Bun's own 300-second fetch timeout is off; long reasoning calls exceed it). */
export const UPSTREAM_DEADLINE_MS = 900_000;
/** internal-task: how long an install slot waits for a token-bearing request's body before it refuses the request (408). */
export const INSTALL_BODY_DEADLINE_MS = 120_000;

export interface Meter {
  usd: number;
  requests: number;
  /** Requests whose cost came from their reservation because the response reported no usage (charged, not free). */
  unpriced: number;
  /** Requests still in flight when the meter was finalized after its timeout (their cost is missing here, not in the ledger). */
  undrained?: number;
  byModel: Record<string, { usd: number; requests: number }>;
  /** Lease mode: what the provider answered (HTTP status counts, connection failures, 200 bodies that were not JSON), so a report can tell provider outages from product bugs. */
  upstream?: { statuses: Record<string, number>; failed: number; unparseable: number };
}
export const newMeter = (): Meter => ({ usd: 0, requests: 0, unpriced: 0, byModel: {} });

/** True when the provider itself misbehaved during a meter's requests: a 5xx, a lost connection, or a 200 that was not JSON. */
export const upstreamTrouble = (m: Meter | null | undefined) => !!m?.upstream && (m.upstream.failed > 0 || m.upstream.unparseable > 0 || Object.keys(m.upstream.statuses).some(s => Number(s) >= 500));

export interface LeasePolicy {
  /** The lease this proxy spends; every request is reserved against it before it is forwarded. */
  lease: BudgetRun;
  /** Where real keys come from (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /** When set, only these `provider:model` ids may be called (they must also be priced). */
  allowModels?: string[] | null;
  /** Output-token cap injected when a request names none; a request naming more is refused. */
  maxOutputTokens?: number;
  /** Strings that must never leave the cell (raw dataset ids, labels); a body containing one is refused. */
  forbiddenMarkers?: string[];
  streaming?: 'meter' | 'refuse';
  /** Append-only per-request usage log (ndjson). */
  usageLog?: string;
  /** Forward POST /anthropic/v1/messages/count_tokens free (COUNT_TOKENS_ROUTE); off by default. */
  freeCountTokens?: boolean;
  /** internal-task (H10): the texts whose copies a slot bound with `routes` counts (routeCopies). Unset, nothing is counted. */
  routeTexts?: RouteTexts;
  /** Append-only per-request layer-filter receipts (ndjson, runner/proxy/ablate.ts); a bind with an ablation map is refused without it. */
  ablationLog?: string;
  /** internal-task: write sections and tools_called on forwarded chat lines (--log-sections); off by default. */
  logSections?: boolean;
  /** internal-task: refuse a request that declares a provider-hosted web tool (--refuse-hosted-tools, HE-PROXY-006); off by default. */
  refuseHostedTools?: boolean;
  /** internal-task: the directory a bind's `capture` names a trial directory under (--capture-bodies); unset, a bind with `capture` is refused. */
  captureRoot?: string;
  /** internal-task: the size cap of one capture file (--capture-max-bytes), DEFAULT_CAPTURE_MAX_BYTES when unset. */
  captureMaxBytes?: number;
  /** internal-task: `openrouter` (--google-via openrouter) sends the google route's Gemini requests to OpenRouter's Chat Completions
   *  (runner/proxy/gemini-openrouter.ts), pinned, priced and keyed as the OpenRouter route; unset, they go to the Gemini API. */
  googleVia?: typeof VIA_OPENROUTER;
}

/** internal-task (H10): `copies` are the rule and placebo bytes (harnesses/routes/instruction.md, placebo.md); `listing` the skill
 *  descriptions a skill route lists (discovery). */
export interface RouteTexts { copies: string[]; listing: string[] }

/** internal-task Phase B, per bind: max_requests refuses the slot's request for its first model once that many were forwarded
 *  (HTTP 400, error kind and usage-line reason prefix REQUEST_CAP); collect_requests keeps each forwarded body in memory for
 *  POST /__proxy/requests {key}, and apart from them the first body the request cap refused: it carries the tool calls of the
 *  agent's last step, which no forwarded body does. */
export interface SlotLimits { max_requests?: number; collect_requests?: boolean }
export const REQUEST_CAP = 'request_cap';
type SlotBinding = { key: string; token: string | null; models: string[] | null; ablation: AblationBinding | null; routes?: boolean; maxRequests?: number; sent?: number; collect?: boolean; capture?: string; install?: boolean };

export interface UsageLine {
  at: string; key: string; provider: string; route: string; model: string | null;
  /** `estimated`: a countTokens request the proxy answered itself with a local estimate (internal-task); nothing reached a provider,
   *  so it is neither a model request nor a model response. */
  outcome: 'forwarded' | 'refused' | 'failed' | 'estimated';
  reason?: string; status?: number; reserved_usd?: number; actual_usd?: number; input_tokens?: number; output_tokens?: number; cached_tokens?: number; charged_reservation?: boolean; streamed?: boolean;
  /** internal-task (H10), on a slot bound with `routes` under --route-texts: copies of the rule or placebo in the forwarded request by
   *  location, plus `listing`, copies of a skill description outside tool results (routeCopies). Counts only. */
  route_copies?: RouteCopies & { listing: number };
  /** internal-task (H10), same slots: a request for a model other than the slot's first bound model, a harness housekeeping call
   *  (shipped default model, metered, never scored). It carries no route_copies. */
  housekeeping?: boolean;
  /** Usage-line schema v1, on every forwarded line: Anthropic cache_creation_input_tokens plus OpenAI input or prompt
   *  tokens detail cache_write_tokens, 0 when the provider reported none. The ablation tables read it as the cache write. */
  cache_write_tokens?: number;
  /** What the request asked for (runner/proxy/effort.ts): OpenAI `reasoning.effort` (or chat-completions `reasoning_effort`), Anthropic `output_config.effort`,
   *  `thinking.type` and `thinking.budget_tokens`, Gemini `thinkingConfig.thinkingLevel` (thinking_level) and `thinkingBudget` (thinking_budget_tokens),
   *  each only when its value is a known one; `unrecognized_effort_fields` names the request paths set to anything else. */
  reasoning_effort?: string; output_config_effort?: string; thinking_type?: string; thinking_budget_tokens?: number; thinking_level?: string; unrecognized_effort_fields?: string[];
  /** Particle and OpenRouter: the model id the response echoed (particle-ai/particle-1 for a request naming particle-1). Recorded, never checked or priced. */
  served_model?: string;
  /** OpenRouter only: the provider the response names (`provider`, DeepSeek on the pinned endpoint), the generation id (`id`,
   *  gen-...) and OpenRouter's own usage.cost in USD, recorded beside actual_usd (the price-table row) for reconciliation. */
  served_provider?: string; generation_id?: string; openrouter_cost_usd?: number;
  /** OpenRouter only: the service tier the response names (`service_tier`), when it names one. */
  served_tier?: string;
  /** OpenRouter only: a 2xx answer that names a provider other than the pinned endpoint's, or none, or for a tier-pinned model
   *  a tier other than the standard one (HE-PROXY-009). The trial is infra_error. */
  served_elsewhere?: boolean;
  /** OpenRouter only, on a non-2xx answer: `error.metadata.limit_source` when OpenRouter refused the request for a spend limit
   *  (`openrouter_key_limit`, `openrouter_guardrail_budget`, `openrouter_workspace_budget`, `openrouter_in_flight_budget`), HE-PROXY-014. */
  openrouter_limit_source?: string;
  /** internal-task (R95): the provider's safety-filter stop in the answer, `<field>:<value>` (runner/proxy/stops.ts), on forwarded lines only. */
  safety_stop?: string;
  /** xAI only (internal-task): the answer's own `usage.cost_in_usd_ticks` (1 tick is 1e-10 USD), recorded beside actual_usd (the price-table row) for reconciliation. */
  cost_in_usd_ticks?: number;
  /** Usage-line schema v1 (internal-task), on every forwarded line beside cache_write_tokens: its 1-hour part and reasoning tokens, 0 when absent. */
  cache_write_1h_tokens?: number; reasoning_tokens?: number;
  /** With --log-sections, on forwarded chat lines: the request's sections and the tools the response called, or why they could not be read. */
  tools_called?: string[]; sections?: RequestSections; sections_error?: string;
  /** On a request whose usage is unknown (charged_reservation): the lease holds actual_usd, and reported_usd is what the
   *  provider's usage did report (a cut stream's partial usage, else 0). Real spend lies between the two. */
  usage_unknown?: true; reported_usd?: number;
  /** Particle only, on a non-2xx answer: its JSON `error.code` and `error.type` when each is a short token; the body itself goes only to error_body or error_text (ruling C of amendment 2). runner/trial/trial.ts `trialTermination` reads `error_code` (internal-task plan decision 12); `error_type` is for the reader of the log. */
  error_code?: string; error_type?: string;
  /** Amendment 2 of frontier-shootout-2026-11 (ruling B), on forwarded lines: the answer's finish reason as the provider
   *  spells it (Gemini finishReason, Chat Completions finish_reason, Anthropic stop_reason, Responses status or
   *  incomplete_details.reason), the last one a stream reported (stops.ts finishReason). */
  finish_reason?: string;
  /** Same amendment (ruling C), on a forwarded line whose answer was not 2xx: its Retry-After header, and its body, parsed when
   *  it is JSON (error_body) or else cut text (error_text), with every credential masked (errorFacts). Logging only. */
  retry_after?: string; error_body?: unknown; error_text?: string;
  /** internal-task, the google route in the via-OpenRouter mode (Gemini CLI's fallback route): on every google line, forwarded,
   *  failed, refused or estimated; a forwarded request went to OpenRouter's Chat Completions, translated
   *  (runner/proxy/gemini-openrouter.ts); `translation_dropped` names request fields with no Chat Completions counterpart
   *  that were left out. `local_estimate` marks a countTokens answer the proxy computed itself (outcome `estimated`), never
   *  forwarded or charged. */
  upstream?: 'openrouter'; translation_dropped?: string[]; local_estimate?: true;
  /** internal-task, on every line of an install slot and nowhere else: the request's method and endpoint class, whether it presented
   *  the slot's token, its user agent (sanitizeUserAgent) and whether it was not the harness's own model call (refused, HE-PROXY-010).
   *  `status` is then always the HTTP status the proxy answered (502 on a failed line). */
  kind?: 'install_slot'; method?: string; endpoint?: EndpointClass; token_presented?: boolean; user_agent?: string; non_harness?: boolean;
  /** internal-task, on a forwarded generation line of an install slot: the provider-hosted web tool calls the response reported and
   *  their fees, which are part of actual_usd (hosted-tools.ts webToolUse). */
  web_search_calls?: number; web_search_usd?: number; web_fetch_calls?: number; web_fetch_usd?: number;
}

/** internal-task: what an install-slot request is, by method and route. `probe` is a harness's startup probe of what serves its base
 *  URL: Hermes's POST /api/show and its GETs of /api/tags, /props, /v1/props, /version, /models and /api/v1/models, and Claude
 *  Code's HEAD /api/hello (seen under QM). */
export type EndpointClass = 'generation' | 'models' | 'embeddings' | 'count_tokens' | 'probe' | 'other';
const PROBE_ROUTES: ReadonlyArray<{ method: string; route: string }> = [
  { method: 'POST', route: '/api/show' }, { method: 'HEAD', route: '/api/hello' },
  ...['/api/tags', '/props', '/v1/props', '/version', '/models', '/api/v1/models'].flatMap((route) => [{ method: 'GET', route }, { method: 'HEAD', route }]),
];
export function endpointClass(method: string, route: string): EndpointClass {
  if (route === COUNT_TOKENS_ROUTE) return 'count_tokens';
  if (method === 'GET' && /^\/v1\/models(\/[^/]+)?$/.test(route)) return 'models';
  if (PROBE_ROUTES.some((p) => p.method === method && p.route === route)) return 'probe';
  if (/^\/v1\/embeddings$/.test(route)) return 'embeddings';
  if (method === 'POST' && /^\/v1\/(messages|chat\/completions|responses)$/.test(route)) return 'generation';
  return 'other';
}

/** internal-task: a user agent fit for the usage log: printable ASCII only, the slot's token and anything token-like (an sk-, pk- or
 *  rk- key, or a run of 20 or more letters, digits, -, _, + or =) replaced by [masked], at most 120 characters. */
export function sanitizeUserAgent(ua: string | null, token: string | null): string {
  let s = (ua ?? '').replace(/[^\x20-\x7e]/g, ' ');
  if (token) s = s.split(token).join('[masked]');
  return s.replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{6,}/g, '[masked]').replace(/[A-Za-z0-9_+=-]{20,}/g, '[masked]').slice(0, 120);
}

type InstallTag = Required<Pick<UsageLine, 'kind' | 'method' | 'endpoint' | 'token_presented' | 'user_agent' | 'non_harness'>> & { model: string | null };

export interface InstallTotals {
  requests: number;
  non_harness: Record<EndpointClass, number>;
  web_search_calls: number; web_search_usd: number; web_fetch_calls: number; web_fetch_usd: number;
}

/** internal-task: install-slot totals per usage-line key (a trial's key, or `slot:<id>` for requests without its token), from usage lines. */
export function installTotals(lines: UsageLine[]): Record<string, InstallTotals> {
  const out: Record<string, InstallTotals> = {};
  for (const l of lines) {
    if (l.kind !== 'install_slot') continue;
    const t = out[l.key] ??= { requests: 0, non_harness: { generation: 0, models: 0, embeddings: 0, count_tokens: 0, probe: 0, other: 0 }, web_search_calls: 0, web_search_usd: 0, web_fetch_calls: 0, web_fetch_usd: 0 };
    t.requests++;
    if (l.non_harness) t.non_harness[l.endpoint ?? 'other']++;
    t.web_search_calls += l.web_search_calls ?? 0; t.web_search_usd += l.web_search_usd ?? 0;
    t.web_fetch_calls += l.web_fetch_calls ?? 0; t.web_fetch_usd += l.web_fetch_usd ?? 0;
  }
  return out;
}

/** The internal-task fields of a line that reported no usage worth reading (a count_tokens call). */
const NO_EXTRAS = { cache_write_tokens: 0, cache_write_1h_tokens: 0, reasoning_tokens: 0 };

/** The tail of the reason the proxy writes on a 5xx it settled at $0 (scripts/gsta-135/lease.ts reads it). Which 5xx
 *  answers qualify, with each provider's docs, is in runner/ledger/budget-ledger.ts `unbilledAnswer`. */
export const PROVIDER_ERROR_NOT_BILLED = 'a provider error envelope that is not billed, settled at $0';
const NOTHING_USED = { usd: 0, input_tokens: 0, output_tokens: 0 };
const unbilledReason = (status: number, type?: string) => (type ? `HTTP ${status} ${type}: ${PROVIDER_ERROR_NOT_BILLED}` : undefined);

/** Cache-read tokens a provider reported (Anthropic cache_read_input_tokens, OpenAI prompt/input_tokens_details.cached_tokens,
 *  Gemini usageMetadata cachedContentTokenCount), for the usage line. */
function cachedTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, any>;
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  return n(u.cache_read_input_tokens) + n(u.prompt_tokens_details?.cached_tokens) + n(u.input_tokens_details?.cached_tokens) + n(u.cachedContentTokenCount);
}

/** The last usageMetadata of a Gemini SSE body (each chunk carries one; the last is final). */
const lastUsageMetadata = (text: string): unknown => text.split('\n').filter(l => l.startsWith('data:'))
  .map(l => (jsonOrNull(l.slice(5).trim()) as { usageMetadata?: unknown } | null)?.usageMetadata).filter(Boolean).at(-1);

/** Non-overlapping occurrences of each text in every string under `value` (strings, arrays and object values, recursively). */
function occurrences(value: unknown, texts: readonly string[]): number {
  if (typeof value === 'string') {
    let n = 0;
    for (const t of texts) { if (!t) continue; for (let i = value.indexOf(t); i >= 0; i = value.indexOf(t, i + t.length)) n++; }
    return n;
  }
  if (Array.isArray(value)) return value.reduce((s: number, v) => s + occurrences(v, texts), 0);
  if (value && typeof value === 'object') return Object.values(value).reduce((s: number, v) => s + occurrences(v, texts), 0);
  return 0;
}

/** Whether a message's content holds a tool result (an Anthropic tool_result block). */
const holdsToolResult = (content: unknown) => Array.isArray(content) && content.some((b) => (b as { type?: unknown } | null)?.type === 'tool_result');

/**
 * internal-task (H10): copies of the route texts in one request body, by where they sit. Anthropic Messages (`system`, `messages`),
 * OpenAI Responses (`instructions`, `input`) and Chat Completions (`messages`) are read; any other body counts nothing.
 *  - system: the system prompt (`system`, `instructions`, a system or developer message);
 *  - tool_result: a tool's answer anywhere in the request (Anthropic tool_result blocks, a Responses `*_output` item, a Chat
 *    Completions tool message);
 *  - user: the current member turn, the trailing run of user messages that hold text and no tool result (the last such run
 *    in the request), so a tool-call follow-up still reads the turn's own message as current;
 *  - history: everything else, earlier user turns and assistant output;
 *  - listing: copies of the listing texts in system, user and history (a skill description in the skills list).
 */
export function routeCopies(body: Record<string, unknown> | undefined, texts: RouteTexts): RouteCopies & { listing: number } {
  const out = { system: 0, user: 0, tool_result: 0, history: 0, listing: 0 };
  if (!body) return out;
  const add = (where: 'system' | 'user' | 'tool_result' | 'history', value: unknown) => {
    out[where] += occurrences(value, texts.copies);
    if (where !== 'tool_result') out.listing += occurrences(value, texts.listing);
  };
  add('system', body.system);
  add('system', body.instructions);
  type Item = { role?: unknown; type?: unknown; content?: unknown };
  const items: Item[] = typeof body.input === 'string' ? [{ role: 'user', content: body.input }]
    : Array.isArray(body.input) ? body.input as Item[] : Array.isArray(body.messages) ? body.messages as Item[] : [];
  const isUserText = (m: Item) => m?.role === 'user' && !holdsToolResult(m.content) && (typeof m.content === 'string' || Array.isArray(m.content));
  let last = -1;
  for (let i = items.length - 1; i >= 0 && last < 0; i--) if (isUserText(items[i]!)) last = i;
  let first = last;
  while (first > 0 && isUserText(items[first - 1]!)) first--;
  items.forEach((m, i) => {
    if (!m || typeof m !== 'object') return;
    if (m.role === 'system' || m.role === 'developer') return add('system', m.content);
    if (m.role === 'tool' || (typeof m.type === 'string' && m.type.endsWith('_output'))) return add('tool_result', m);
    if (m.role === 'user' && holdsToolResult(m.content)) {
      const blocks = m.content as Array<{ type?: unknown }>;
      add('tool_result', blocks.filter((b) => b?.type === 'tool_result'));
      return add('history', blocks.filter((b) => b?.type !== 'tool_result'));
    }
    add(i >= first && i <= last && last >= 0 ? 'user' : 'history', m);
  });
  return out;
}

/** The model id a Chat Completions response echoed (the body's `model`, or the last streamed chunk's), when it is a plain id. */
function echoedModel(text: string, streamed: boolean): string | undefined {
  const pick = (v: unknown) => { const m = (v as { model?: unknown } | null)?.model; return typeof m === 'string' && /^[A-Za-z0-9._:/-]{1,200}$/.test(m) ? m : undefined; };
  if (!streamed) { try { return pick(JSON.parse(text)); } catch { return undefined; } }
  let last: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try { last = pick(JSON.parse(line.slice(5).trim())) ?? last; } catch { /* [DONE] or a broken line */ }
  }
  return last;
}

/** Why a lease proxy refuses an OpenRouter request before pricing it (HE-PROXY-008), or null: a `models` list, `route` or
 *  `plugins` would let OpenRouter pick another model, endpoint or tool; an `openrouter:` server tool or `web_search_options`
 *  runs a tool on OpenRouter's servers, with or without --refuse-hosted-tools; a variant suffix (`:online`, `:nitro`, `:floor`, any
 *  `:<tag>`) selects another endpoint set or adds a tool; and only OPENROUTER_MODELS ids are forwarded. */
export function openrouterRefusal(body: Record<string, unknown> | undefined, model: string | null, allowed: Record<string, unknown> = OPENROUTER_MODELS): string | null {
  const routing = ['models', 'route', 'plugins'].filter((k) => body?.[k] !== undefined);
  if (routing.length) return `the request sets ${routing.join(', ')}, which would let OpenRouter choose another model, endpoint or tool`;
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  const server = tools.findIndex((t) => typeof (t as { type?: unknown } | null)?.type === 'string' && (t as { type: string }).type.startsWith('openrouter:'));
  if (server >= 0) return `tools[${server}] is an OpenRouter server tool, which OpenRouter runs on its own servers`;
  if (body?.web_search_options !== undefined && body.web_search_options !== null) return 'the request sets web_search_options, which has OpenRouter run a web search on its own servers';
  if (model?.includes(':')) return `the model ${model} carries the variant suffix ${model.slice(model.indexOf(':'))}, which selects other endpoints or adds a tool`;
  if (!model || !Object.hasOwn(allowed, model)) return `the model ${model ?? '(none)'} is not on the proxy's OpenRouter allowlist (${Object.keys(allowed).join(', ')})`;
  const tier = (allowed[model] as OpenRouterPin | undefined)?.service_tier;
  if (tier && body?.service_tier !== undefined && body.service_tier !== tier) return `the request sets service_tier ${JSON.stringify(body.service_tier)}, but ${model} is pinned to OpenRouter's ${tier} (standard) tier`;
  if (tier && body?.speed !== undefined) return `the request sets speed ${JSON.stringify(body.speed)}, which asks OpenRouter for the priority tier, but ${model} is pinned to its ${tier} (standard) tier`;
  return null;
}

/** What a usage line records from a Particle, OpenRouter or xAI answer, read from the body or the stream's chunks. xAI: its usage.cost_in_usd_ticks. Particle: the
 *  echoed model, and on a non-2xx answer its error code and type. OpenRouter: the echoed model, the provider that answered and
 *  the generation id, the same error fields, and `served_elsewhere` on a 2xx answer that names a provider other than the
 *  pinned endpoint's, or names none and still reported usage (OPENROUTER_MODELS). Nothing else from the body is kept. */
function responseFacts(prov: ProviderName, model: string | null, text: string, streamed: boolean, ok: boolean, route = '/v1/chat/completions'): Partial<UsageLine> {
  if (prov === 'xai') {
    const ticks = (streamed ? sseUsage(text) : (jsonOrNull(text) as { usage?: Record<string, unknown> } | null)?.usage)?.cost_in_usd_ticks;
    return typeof ticks === 'number' && Number.isSafeInteger(ticks) && ticks >= 0 ? { cost_in_usd_ticks: ticks } : {};
  }
  if (prov !== 'particle' && prov !== 'openrouter') return {};
  const served = echoedModel(text, streamed);
  const error = ok ? {} : upstreamError(jsonOrNull(text));
  if (prov === 'particle') return { ...(served ? { served_model: served } : {}), ...error };
  const objects = streamed ? text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => jsonOrNull(l.slice(5).trim())) : [jsonOrNull(text)];
  const token = (v: unknown, pattern: RegExp) => (typeof v === 'string' && pattern.test(v) ? v : undefined);
  let provider: string | undefined, generation: string | undefined, tier: string | undefined, usage = false;
  for (const o of objects) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
    const top = o as Record<string, unknown>;
    const r = top.response && typeof top.response === 'object' && !Array.isArray(top.response) ? top.response as Record<string, unknown> : top;
    provider = token(r.provider, /^[A-Za-z0-9 ._()-]{1,100}$/) ?? provider;
    generation = token(r.id, /^[A-Za-z0-9._:-]{1,200}$/) ?? generation;
    tier = token(r.service_tier, /^[a-z_]{1,20}$/) ?? tier;
    usage ||= !!r.usage && typeof r.usage === 'object';
  }
  const pin = OPENROUTER_PINS[model ?? ''];
  const offTier = !!pin?.service_tier && tier !== undefined && tier !== 'default' && tier !== 'standard';
  const elsewhere = ok && ((provider !== pin?.served && (provider !== undefined || (usage && route !== '/v1/responses'))) || offTier);
  const limit = ok ? undefined : token((jsonOrNull(text) as { error?: { metadata?: { limit_source?: unknown } } } | null)?.error?.metadata?.limit_source, /^openrouter_[a-z_]{1,40}$/);
  return { ...(served ? { served_model: served } : {}), ...(provider ? { served_provider: provider } : {}), ...(tier ? { served_tier: tier } : {}), ...(generation ? { generation_id: generation } : {}), ...(elsewhere ? { served_elsewhere: true } : {}),
    ...(limit ? { openrouter_limit_source: limit } : {}), ...error };
}

/** Particle only: `error.code` and `error.type` of a non-2xx JSON answer, each kept only when it is a short token, so no message text reaches the usage line. */
function upstreamError(body: unknown): Pick<UsageLine, 'error_code' | 'error_type'> {
  const e = (body as { error?: unknown } | null)?.error;
  if (!e || typeof e !== 'object' || Array.isArray(e)) return {};
  const token = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : undefined);
  const { code, type } = e as Record<string, unknown>;
  return { ...(token(code) ? { error_code: code as string } : {}), ...(token(type) ? { error_type: type as string } : {}) };
}

/** Anything in an error body shaped like a credential: a Google, OpenAI-style, xAI or OpenRouter key, a per-trial token, a bearer. */
const KEY_SHAPED = /AIza[0-9A-Za-z_-]{20,}|\b(?:sk|xai)-[A-Za-z0-9_-]{16,}|trial-token:[A-Za-z0-9._:-]+|Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g;
const ERROR_BODY_MAX = 8_000;
/** Amendment 2 of frontier-shootout-2026-11, ruling C: what a usage line keeps of a non-2xx answer. Its Retry-After header, and
 *  its body (Google's error.code, error.message, error.status and error.details with the quota and retry details; OpenRouter's
 *  error.message and error.metadata with provider_name and raw), parsed when it is JSON and no longer than 8,000 characters,
 *  else as text cut there. The provider key, the slot's token and anything shaped like a key are masked first. Logging only. */
export function errorFacts(retryAfter: string | null, text: string, secrets: ReadonlyArray<string | null | undefined>): Pick<UsageLine, 'retry_after' | 'error_body' | 'error_text'> {
  let masked = text;
  for (const s of secrets) if (s && s.length >= 8) masked = masked.split(s).join('[masked]');
  masked = masked.replace(KEY_SHAPED, '[masked]');
  const retry = retryAfter !== null && /^[\x20-\x7e]{1,64}$/.test(retryAfter) ? { retry_after: retryAfter } : {};
  const body = masked.length <= ERROR_BODY_MAX ? jsonOrNull(masked) : null;
  if (body !== null && typeof body === 'object') return { ...retry, error_body: body };
  return { ...retry, ...(masked.trim() ? { error_text: masked.slice(0, ERROR_BODY_MAX) } : {}) };
}

/** 0.0.0.0, ::, [::], *, an empty host, or any spelling the URL parser canonicalizes to one of them (0, 0.0, 00.0.0.0, ::0,
 *  0:0:0:0:0:0:0:0): every interface, which the proxy never listens on. A host the parser rejects counts as one too. */
export const isWildcardHost = (host: string) => {
  const h = host.trim();
  if (h === '' || h === '*') return true;
  try {
    const { hostname } = new URL(`http://${h.includes(':') && !h.startsWith('[') ? `[${h}]` : h}/`);
    return hostname === '0.0.0.0' || hostname === '[::]';
  } catch { return true; }
};

/** The credential a request presents: x-api-key, x-goog-api-key (Gemini), or the bearer of Authorization. */
function presentedCredential(req: Request): string | null {
  const apiKey = req.headers.get('x-api-key') ?? req.headers.get('x-goog-api-key');
  if (apiKey) return apiKey;
  const auth = req.headers.get('authorization');
  const m = auth?.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

const json = (status: number, kind: string, message: string) =>
  new Response(JSON.stringify({ error: { kind, type: kind, message: `metering proxy: ${message}` } }), { status, headers: { 'content-type': 'application/json' } });

/** The output-token fields a provider honors on a route; the first is the one the proxy injects when the request states none of them. */
function outputFields(provider: ProviderName, route: string): string[] {
  if (provider === 'anthropic') return ['max_tokens'];
  if ((provider === 'openai' || provider === 'particle' || provider === 'openrouter' || provider === 'xai') && route === '/v1/chat/completions') return ['max_completion_tokens', 'max_tokens'];
  if ((provider === 'openai' || provider === 'xai' || provider === 'openrouter') && route === '/v1/responses') return ['max_output_tokens'];
  return [];
}

/**
 * Forwards provider requests (each slot's base URL names the slot) and meters
 * them. A request is charged to the cell bound to its slot when it arrives, so
 * a request that finishes after the cell moved on still lands on the right
 * cell; `finalize` waits for a cell's in-flight requests to drain. In lease
 * mode a request with no bound cell is refused and logged under `slot:<id>`;
 * in-process mode (loopback, the caller's own credentials) meters it there.
 */
export class MeteringProxy {
  private server: ReturnType<typeof Bun.serve> | null = null;
  readonly meters = new Map<string, Meter>();
  /** Slots whose provider requests are charged to a ledger allowance (slot builds), not one ledger entry each. */
  readonly allowances = new Map<string, BudgetAllowance>();
  readonly counts = { forwarded: 0, refused: 0, failed: 0, estimated: 0, tripwires: 0 };
  private bindings = new Map<string, SlotBinding>();
  /** internal-task Phase B: forwarded request bodies per key, for slots bound with collect_requests. Memory only, never logged;
   *  `takeRequests` hands them to the runner once and drops them. */
  private collected = new Map<string, unknown[]>();
  /** internal-task Phase B: the first body the request cap refused per key, for the same slots; never forwarded or logged. */
  private refusedBody = new Map<string, unknown>();
  private signatures = new SignatureStore();
  private captures: BodyCapture | null = null;
  private inflight = new Map<string, number>();
  private waiters = new Map<string, Array<() => void>>();
  /** `transform` (in-process mode) rewrites a response body after it is metered: a mutant that drops a model's output, for example. */
  constructor(private options: { fetchImpl?: typeof fetch; hostname?: string; port?: number; upstream?: Partial<Record<ProviderName, string>>; policy?: LeasePolicy; controlToken?: string | null; transform?: (slot: string, target: string, text: string) => string; installBodyDeadlineMs?: number } = {}) {}
  get port(): number { return this.server!.port as number; }
  /** Charge the slot's provider requests to `key` (a cell id) from now on; with `token`, only requests presenting it; with `models`, only requests for those provider:model ids;
   *  with `ablation` (lease mode), the bound layers are cut from every generation request (runner/proxy/ablate.ts); with
   *  `routes` (internal-task-a), count route copies on its usage lines when the proxy has route texts; with `install` (internal-task-b, lease
   *  mode, needs `token` and `models`), record every request and refuse the ones that are not the harness's own model call.
   *  Throws, binding nothing, when an install bind lacks one of those or the proxy refuses hosted web tools. */
  bind(slot: string, key: string, token: string | null = null, models: string[] | null = null, ablation: AblationBinding | null = null, routes = false, limits: SlotLimits = {}, capture: string | null = null, install = false) {
    if (install) {
      const missing = !this.options.policy ? 'a lease proxy' : !token ? 'a token' : !models?.length ? 'models' : null;
      if (missing) throw new Error(`bind install refused: an install slot needs ${missing}, which tells the harness's own model call apart from any other request`);
      if (this.options.policy!.refuseHostedTools) throw new Error('bind install refused: this proxy was started with --refuse-hosted-tools, and an install slot meters hosted web tools instead of refusing them; start the install proxy without the flag');
    }
    this.bindings.set(slot, { key, token, models, ablation, ...(routes ? { routes } : {}), ...(limits.max_requests ? { maxRequests: limits.max_requests, sent: 0 } : {}), ...(limits.collect_requests ? { collect: true } : {}), ...(capture ? { capture } : {}), ...(install ? { install } : {}) });
  }
  /** The request bodies collected for `key` since its slot was bound with collect_requests, in order, and the first body the
   *  request cap refused (refused, empty when none was); drops them. */
  takeRequests(key: string): { requests: unknown[]; refused: unknown[] } {
    const requests = this.collected.get(key) ?? [], refused = this.refusedBody.has(key) ? [this.refusedBody.get(key)] : [];
    this.collected.delete(key); this.refusedBody.delete(key);
    return { requests, refused };
  }
  /** With `key`, only drops the binding if it is still that key: a released slot may already be bound to the next cell. */
  unbind(slot: string, key?: string) { if (key === undefined || this.bindings.get(slot)?.key === key) this.bindings.delete(slot); }
  private meter(key: string): Meter { let m = this.meters.get(key); if (!m) this.meters.set(key, m = newMeter()); return m; }
  private settled(key: string) {
    const n = (this.inflight.get(key) ?? 1) - 1;
    if (n > 0) { this.inflight.set(key, n); return; }
    this.inflight.delete(key);
    for (const w of this.waiters.get(key) ?? []) w();
    this.waiters.delete(key);
  }
  /** Wait for `key`'s in-flight requests (at most `timeoutMs`), then remove and return its meter. */
  async finalize(key: string, timeoutMs = 120_000): Promise<Meter> {
    if (this.inflight.get(key)) {
      await Promise.race([new Promise<void>(r => { const list = this.waiters.get(key) ?? []; list.push(r); this.waiters.set(key, list); }), Bun.sleep(timeoutMs)]);
    }
    const m = this.meters.get(key) ?? newMeter();
    this.meters.delete(key);
    this.captures?.close(key);
    if (this.inflight.get(key)) m.undrained = this.inflight.get(key);
    return m;
  }
  /** `install`: the request is on an install slot, so its line carries the install fields, the model the request named when the
   *  line has none, and the status the proxy answered (502 for a failed line). */
  private log(line: UsageLine, install?: InstallTag) {
    // The fallback route is recorded on every google line, forwarded, failed, refused or estimated.
    if (line.provider === 'google' && this.options.policy?.googleVia === VIA_OPENROUTER) line = { ...line, upstream: VIA_OPENROUTER };
    if (install) { const { model, ...fields } = install; line = { ...line, model: line.model ?? model, ...fields, status: line.status ?? 502 }; }
    this.counts[line.outcome]++;
    if (this.options.policy?.usageLog) appendFileSync(this.options.policy.usageLog, JSON.stringify(line) + '\n');
  }
  start() {
    const send: Send = this.options.fetchImpl ?? ((input, init) => fetch(input, init));
    const hostname = this.options.hostname ?? '127.0.0.1';
    if (isWildcardHost(hostname)) throw new Error(`metering proxy: refusing to listen on the wildcard address ${hostname}; bind the loopback or the docker bridge gateway (runner/trial/world.ts listenHost)`);
    this.server = Bun.serve({
      port: this.options.port ?? 0, hostname, idleTimeout: 0,
      fetch: async req => {
        const url = new URL(req.url);
        if (url.pathname === '/__proxy/status' && req.method === 'GET') return Response.json(this.status());
        if (url.pathname.startsWith('/__proxy/') && req.method === 'POST') return this.control(url.pathname, req);
        if (url.pathname === '/muse-code/models' && req.method === 'GET') return Response.json(MUSE_CODE_CATALOG);
        const m = url.pathname.match(/^\/(?:([^/]+)\/)?(anthropic|openai|voyage|particle|openrouter|google|xai)(\/.*)$/);
        if (!m) return json(404, 'invalid_request', `no provider route ${url.pathname}`);
        const [, slot = 'default', prov, path] = m as unknown as [string, string | undefined, ProviderName, string];
        const rest = prov === 'google' && path.startsWith(GOOGLE_HOST_SEGMENT) ? path.slice(GOOGLE_HOST_SEGMENT.length - 1) : path;
        const binding = this.bindings.get(slot);
        const key = binding?.key ?? `slot:${slot}`;
        let install: InstallTag | undefined;
        if (this.options.policy) {
          const refused = (reason: string) => { this.log({ at: new Date().toISOString(), key, provider: prov, route: rest, model: null, outcome: 'refused', reason, status: 403 }); return json(403, 'invalid_request', reason); };
          if (!binding) return refused(`slot ${slot} is not bound; the proxy forwards only for a slot the runner bound`);
          if (binding.install) {
            // The token is checked from the headers before the body is read. A tokenless request is refused at once, its body never
            // read, and is never in flight; a token-bearing one is counted in flight while its body arrives, so it is metered, and
            // refused 408 if the body takes longer than the read deadline, so finalize never reports it undrained.
            const tokenPresented = presentedCredential(req) === binding.token;
            const endpoint = endpointClass(req.method, rest);
            const userAgent = sanitizeUserAgent(req.headers.get('user-agent'), binding.token);
            const refuseInstall = (why: string, status: number, model: string | null, tag: InstallTag) => {
              const reason = `HE-PROXY-010 ${why}; an install slot refuses at $0, and counts, every request that is not the harness's own model call (docs/errors.md)`;
              this.log({ at: new Date().toISOString(), key: tokenPresented ? key : `slot:${slot}`, provider: prov, route: rest, model, outcome: 'refused', reason, status }, tag);
              return json(status, 'invalid_request', reason);
            };
            if (!tokenPresented) return refuseInstall(`the credential presented for slot ${slot} is not the slot's token`, 403, null, { kind: 'install_slot', method: req.method.slice(0, 16), endpoint, token_presented: false, user_agent: userAgent, non_harness: true, model: null });
            this.inflight.set(key, (this.inflight.get(key) ?? 0) + 1);
            let raw: string | undefined;
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              const deadlineMs = this.options.installBodyDeadlineMs ?? INSTALL_BODY_DEADLINE_MS;
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                raw = await Promise.race([req.clone().text(), new Promise<undefined>(r => { timer = setTimeout(() => r(undefined), deadlineMs); })]);
              } catch (e) { this.settled(key); throw e; } finally { clearTimeout(timer); }
              if (raw === undefined) {
                this.settled(key);
                return refuseInstall(`the request body did not arrive within ${deadlineMs / 1000} s`, 408, null, { kind: 'install_slot', method: req.method.slice(0, 16), endpoint, token_presented: true, user_agent: userAgent, non_harness: true, model: null });
              }
            }
            const done = () => this.settled(key);
            const named = (jsonOrNull(raw ?? '') as { model?: unknown } | null)?.model;
            const model = typeof named === 'string' && /^[A-Za-z0-9._:/-]{1,200}$/.test(named) ? named : null;
            install = { kind: 'install_slot', method: req.method.slice(0, 16), endpoint, token_presented: true, user_agent: userAgent, non_harness: true, model };
            const why = endpoint === 'embeddings' ? 'an embeddings request, which the harness\'s own model call never makes'
              : endpoint === 'probe' ? `route ${req.method} /${prov}${rest} is the harness's startup probe of its base URL, not a model call`
              : endpoint === 'other' ? `route ${req.method} /${prov}${rest} is not a model call the harness makes`
              : endpoint !== 'models' && !binding.models!.includes(`${prov}:${model}`) ? `${prov}:${model ?? '(no model)'} is not on slot ${slot}'s model list (${binding.models!.join(', ')})`
              : null;
            if (why) {
              done();
              // A startup probe that carries the token is the harness's own, so it is refused but not counted as non_harness.
              if (endpoint === 'probe') install.non_harness = false;
              return refuseInstall(why, 403, model, install);
            }
            install.non_harness = false;
          }
          if (binding.token !== null && presentedCredential(req) !== binding.token) {
            if (install) this.settled(key);
            this.log({ at: new Date().toISOString(), key: `slot:${slot}`, provider: prov, route: rest, model: null, outcome: 'refused', reason: `the credential presented for slot ${slot} is not the slot's token`, status: 403 });
            return json(403, 'invalid_request', `the credential presented for slot ${slot} is not the slot's token`);
          }
        }
        if (!install) this.inflight.set(key, (this.inflight.get(key) ?? 0) + 1);
        let streaming = false;
        try {
          const r = this.options.policy
            ? await this.forwardLeased(req, prov, rest, url.search, key, send, () => { streaming = true; return () => this.settled(key); }, slot, binding?.models ?? null, binding?.ablation ?? null, binding?.routes === true, binding, install)
            : await this.forwardInProcess(req, slot, prov, rest, url.search, key, send);
          return r;
        } finally { if (!streaming) this.settled(key); }
      },
    });
  }
  stop() { this.server?.stop(true); }

  status() {
    const p = this.options.policy;
    const run = p ? ledgerStatus({ ledgerPath: p.lease.ledgerPath, runId: p.lease.runId }).run : null;
    return { mode: p ? 'lease' : 'in-process', run_id: p?.lease.runId ?? null, lease_usd: p?.lease.budgetUsd ?? null, committed_usd: run?.committed_usd ?? null,
      max_output_tokens: p ? p.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS : null, log_sections: p?.logSections === true, refuse_hosted_tools: p?.refuseHostedTools === true, capture_bodies: !!p?.captureRoot, ...this.counts };
  }

  private async control(path: string, req: Request): Promise<Response> {
    if (this.options.controlToken && req.headers.get('x-proxy-control') !== this.options.controlToken) return json(403, 'invalid_request', 'control endpoints need the x-proxy-control token');
    let body: { slot?: string; key?: string; token?: string; models?: unknown; ablation?: unknown; routes?: unknown; capture?: unknown; timeout_ms?: number; max_requests?: unknown; collect_requests?: unknown; install?: unknown };
    try { body = await req.json() as typeof body; } catch { return json(400, 'invalid_request', 'control body is not JSON'); }
    if (path === '/__proxy/bind' && body.slot && body.key) {
      if (body.models !== undefined && (!Array.isArray(body.models) || body.models.some(m => typeof m !== 'string' || !/^[a-z]+:[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(m)))) return json(400, 'invalid_request', 'bind models must be a list of provider:model ids');
      let ablation: AblationBinding | null = null;
      if (body.ablation !== undefined) {
        if (!this.options.policy?.ablationLog) return json(400, 'invalid_request', 'bind ablation needs a lease proxy started with --ablation-log');
        try { ablation = (await import('./ablate.ts')).loadBinding(body.ablation as AblationSpec); }
        catch (e) { return json(400, 'invalid_request', `bind ablation refused: ${(e as Error).message}`); }
      }
      if (body.max_requests !== undefined && !(Number.isInteger(body.max_requests) && (body.max_requests as number) > 0)) return json(400, 'invalid_request', 'bind max_requests must be a positive whole number');
      if (body.max_requests !== undefined && !(Array.isArray(body.models) && body.models.length)) return json(400, 'invalid_request', 'bind max_requests needs models: the cap counts requests for the first model');
      if (body.install !== undefined && typeof body.install !== 'boolean') return json(400, 'invalid_request', 'bind install must be true or false');
      let capture: string | null = null;
      if (body.capture !== undefined) {
        const root = this.options.policy?.captureRoot;
        if (!root) return json(400, 'invalid_request', 'bind capture needs a lease proxy started with --capture-bodies');
        const dir = typeof body.capture === 'string' && body.capture ? resolve(root, body.capture) : null;
        const rel = dir === null ? '' : relative(resolve(root), dir);
        if (dir === null || isAbsolute(body.capture as string) || rel === '' || rel.startsWith('..') || isAbsolute(rel)) return json(400, 'invalid_request', 'bind capture must name a directory under the --capture-bodies root, relative to it');
        try { mkdirSync(dir, { recursive: true }); } catch (e) { return json(400, 'invalid_request', `bind capture refused: ${(e as Error).message}`); }
        capture = join(dir, CAPTURE_FILE);
      }
      try {
        this.bind(body.slot, body.key, typeof body.token === 'string' && body.token ? body.token : null, body.models === undefined ? null : body.models as string[], ablation, body.routes === true,
          { ...(body.max_requests !== undefined ? { max_requests: body.max_requests as number } : {}), ...(body.collect_requests === true ? { collect_requests: true } : {}) }, capture, body.install === true);
      } catch (e) { return json(400, 'invalid_request', (e as Error).message); }
      return Response.json({ ok: true });
    }
    if (path === '/__proxy/requests' && body.key) return Response.json(this.takeRequests(body.key));
    if (path === '/__proxy/unbind' && body.slot) { this.unbind(body.slot); return Response.json({ ok: true }); }
    if (path === '/__proxy/finalize' && body.key) return Response.json(await this.finalize(body.key, Math.min(Number(body.timeout_ms ?? 30_000), 120_000)));
    return json(404, 'invalid_request', `no control route ${path}`);
  }

  private observe(key: string, status: number | 'failed' | 'unparseable') {
    const m = this.meter(key);
    m.upstream ??= { statuses: {}, failed: 0, unparseable: 0 };
    if (status === 'failed') m.upstream.failed++;
    else if (status === 'unparseable') m.upstream.unparseable++;
    else m.upstream.statuses[String(status)] = (m.upstream.statuses[String(status)] ?? 0) + 1;
  }

  private charge(key: string, prov: string, model: string | null, usd: number, unpriced: boolean) {
    const meter = this.meter(key);
    meter.requests++;
    meter.usd += usd;
    if (unpriced) meter.unpriced++;
    if (model) { const k = `${prov}:${model}`; meter.byModel[k] ??= { usd: 0, requests: 0 }; meter.byModel[k].usd += usd; meter.byModel[k].requests++; }
  }

  /** In-process mode: the client is this harness's own gbrain child; its credentials are forwarded and the paid-request guard or a slot allowance reserves. */
  private async forwardInProcess(req: Request, slot: string, prov: ProviderName, rest: string, search: string, key: string, send: Send): Promise<Response> {
    const target = `${this.options.upstream?.[prov] ?? UPSTREAM[prov]}${rest}${search}`;
    const headers = new Headers(req.headers);
    for (const h of ['host', 'content-length', 'accept-encoding', 'connection']) headers.delete(h);
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
    let price: ReturnType<typeof priceRequest>;
    try { price = priceRequest(`${UPSTREAM[prov]}${rest}${search}`, body ? JSON.parse(body) : undefined); }
    catch (e) { return json(402, 'budget', `refused before forwarding: ${(e as Error).message}`); }
    let res: Response;
    const allowance = this.allowances.get(slot);
    const forward = () => send(target, { method: req.method, headers, body });
    try { res = await (allowance ? allowance.run(forward) : forward()); }
    catch (e) {
      // A refused reservation never left the process; any other failure after sending is charged at its reservation, as the ledger does.
      if ((e as Error).name !== 'BudgetExceededError' && price) this.charge(key, prov, price.model, reservationUsd(price), true);
      return json(502, (e as Error).name === 'BudgetExceededError' ? 'budget' : 'product_error', (e as Error).message);
    }
    const { text, error } = await readBody(res.body);
    // A body that broke off: a stream keeps its partial usage below (charged at no less than the reservation); anything else is charged its reservation.
    if (error && !(res.headers.get('content-type') ?? '').includes('event-stream')) {
      if (price) this.charge(key, prov, price.model, reservationUsd(price), true);
      return json(502, 'product_error', `upstream failed: HTTP ${res.status} body failed before it ended: ${error.message}`);
    }
    if (price) {
      const streamed = (res.headers.get('content-type') ?? '').includes('event-stream');
      let cost: ReturnType<typeof usageCost> = null;
      try { cost = streamed ? usageCost(price, { usage: sseUsage(text) }) : usageCost(price, JSON.parse(text)); } catch { cost = null; }
      // A stream that ended before its final usage is charged the larger of its reservation and the partial usage it reported, as the paid-request guard does.
      const unfinished = streamed && cost !== null && sseIncomplete(text) !== null;
      // An error answer the provider does not bill (a 413, a prompt over the context window, an overloaded 529) settles at $0, as in lease mode and the paid-request guard.
      if (!cost && !error && unbilledAnswer(prov, res.status, jsonOrNull(text), text)) cost = NOTHING_USED;
      const usd = !cost ? reservationUsd(price) : unfinished ? Math.max(reservationUsd(price), cost.usd) : cost.usd;
      this.charge(key, prov, price.model, usd, !cost || unfinished);
    } else this.charge(key, prov, null, 0, false);
    const out = new Headers(res.headers);
    for (const h of ['content-encoding', 'content-length', 'transfer-encoding']) out.delete(h);
    return new Response(this.options.transform ? this.options.transform(slot, target, text) : text, { status: res.status, headers: out });
  }

  /** Lease mode, POST /anthropic/v1/messages/count_tokens: forwarded with the proxy's key, never priced, reserved or metered. */
  private async forwardCount(req: Request, route: string, search: string, key: string, send: Send, realKey: string, raw: string | undefined, model: string | null, at: string, install?: InstallTag): Promise<Response> {
    const headers = new Headers(req.headers);
    for (const h of ['host', 'content-length', 'accept-encoding', 'connection', ...CREDENTIAL_HEADERS]) headers.delete(h);
    headers.set('x-api-key', realKey);
    if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01');
    headers.set('content-type', 'application/json');
    let res: Response;
    try { res = await send(`${this.options.upstream?.anthropic ?? UPSTREAM.anthropic}${route}${search}`, { method: 'POST', headers, body: raw, timeout: false, signal: AbortSignal.timeout(UPSTREAM_DEADLINE_MS) } as RequestInit); }
    catch (e) {
      this.log({ at, key, provider: 'anthropic', route, model, outcome: 'failed', reason: `count_tokens (free): ${(e as Error).message.slice(0, 300)}`, reserved_usd: 0, actual_usd: 0 }, install);
      return json(502, 'product_error', `upstream failed: ${(e as Error).message}`);
    }
    const text = await res.text();
    this.log({ at, key, provider: 'anthropic', route, model, outcome: 'forwarded', status: res.status, reserved_usd: 0, actual_usd: 0, reason: 'count_tokens: free, never metered', ...NO_EXTRAS }, install);
    const out = new Headers(res.headers);
    for (const h of ['content-encoding', 'content-length', 'transfer-encoding']) out.delete(h);
    return new Response(text, { status: res.status, headers: out });
  }

  /** Lease mode: allowlist, tripwire, output cap, price, reserve, inject the key, forward, settle. Every refusal happens before forwarding. */
  private async forwardLeased(req: Request, prov: ProviderName, route: string, search: string, key: string, send: Send, beginStream: () => () => void, slot: string, slotModels: string[] | null, ablation: AblationBinding | null = null, routes = false, binding?: SlotBinding, install?: InstallTag): Promise<Response> {
    const capture = binding?.capture ?? null;
    const p = this.options.policy!;
    const at = new Date().toISOString();
    const refuse = (status: number, kind: string, reason: string, model: string | null = null) => {
      this.log({ at, key, provider: prov, route, model, outcome: 'refused', reason, status }, install);
      return json(status, kind, reason);
    };
    // Gemini also takes a key as ?key=; the inbound one is never the real key and the real one never rides in a URL.
    if (prov === 'google') { const q = new URLSearchParams(search); q.delete('key'); search = q.size ? `?${q}` : ''; }
    // internal-task: in the via-OpenRouter mode a Gemini request is translated and then handled as an OpenRouter one (upProv).
    const via = prov === 'google' && p.googleVia === VIA_OPENROUTER;
    const upProv: ProviderName = via ? 'openrouter' : prov;
    const countRoute = prov === 'anthropic' && req.method === 'POST' && route === COUNT_TOKENS_ROUTE && p.freeCountTokens === true;
    const localCount = prov === 'google' && req.method === 'POST' && GOOGLE_COUNT_ROUTE.test(route);
    if (!countRoute && !localCount && !ROUTES[prov].some(r => r.method === req.method && r.path.test(route))) return refuse(403, 'invalid_request', `route ${req.method} /${prov}${route} is not allowlisted`);
    if (localCount) {
      const counted = route.match(GOOGLE_COUNT_ROUTE)![2]!;
      if (slotModels && !slotModels.includes(`google:${counted}`)) return refuse(403, 'budget', `google:${counted} is not on slot ${slot}'s model list (${slotModels.join(', ') || 'none'})`, counted);
      let parsed: Record<string, any>;
      try { parsed = JSON.parse(await req.text()); } catch { return refuse(400, 'invalid_request', 'request body is not JSON', counted); }
      const estimate = countTokensEstimate(parsed);
      this.log({ at, key, provider: prov, route, model: counted, outcome: 'estimated', status: 200, reserved_usd: 0, actual_usd: 0, local_estimate: true,
        reason: `countTokens answered by the proxy's local estimate (${estimate.totalTokens} tokens at four characters per token); never forwarded or charged`, ...NO_EXTRAS });
      return Response.json(estimate);
    }
    const realKey = (p.env ?? process.env)[KEY_ENV[upProv]];
    if (!realKey) return refuse(503, 'budget', `${KEY_ENV[upProv]} is not set in the proxy's environment`);
    const raw = req.method === 'GET' ? undefined : await req.text();
    const markers = p.forbiddenMarkers ?? [];
    if (raw && markers.length) {
      const leaks = findLeaks(raw, markers);
      if (leaks.length) { this.counts.tripwires++; return refuse(403, 'invalid_request', `tripwire: the request body carries ${leaks.length} forbidden marker(s); the cell is invalid`); }
    }
    let body: Record<string, any> | undefined;
    if (raw !== undefined) {
      try { body = JSON.parse(raw); } catch { return refuse(400, 'invalid_request', 'request body is not JSON'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse(400, 'invalid_request', 'request body must be a JSON object');
    }
    const model = prov === 'google' ? route.match(GOOGLE_ROUTE)?.[2] ?? null : typeof body?.model === 'string' ? body.model : null;
    if (countRoute) {
      if (p.allowModels && !p.allowModels.includes(`anthropic:${model}`)) return refuse(403, 'budget', `anthropic:${model} is not on this cell's model allowlist`, model);
      if (slotModels && !slotModels.includes(`anthropic:${model}`)) return refuse(403, 'budget', `anthropic:${model} is not on slot ${slot}'s model list (${slotModels.join(', ') || 'none'})`, model);
      return this.forwardCount(req, route, search, key, send, realKey, raw, model, at, install);
    }
    const streamed = prov === 'google' ? route.endsWith(':streamGenerateContent') : body?.stream === true;
    if (streamed && (p.streaming ?? 'meter') === 'refuse') return refuse(400, 'invalid_request', 'streaming is disabled for this cell', model);
    const hosted = p.refuseHostedTools || prov === 'google' || prov === 'xai' ? hostedWebTools(body, prov) : [];
    if (hosted.length) {
      const reason = `HE-PROXY-006 the request declares a provider-hosted tool (${hosted.join(', ')}); this proxy refuses hosted search, fetch and code execution, which run outside the trial's egress rules and audit (docs/errors.md). fix: turn the harness's hosted tools off`;
      this.log({ at, key, provider: prov, route, model, outcome: 'refused', reason, status: 400, ...effortFields(body) });
      return json(400, 'invalid_request', reason);
    }
    if (prov === 'google' && streamed && new URLSearchParams(search).get('alt') !== 'sse') return refuse(400, 'invalid_request', 'HE-PROXY-013 streamGenerateContent without alt=sse answers one JSON array, which this proxy does not meter as a stream (docs/errors.md). fix: request ?alt=sse', model);
    const unpriced = install ? unpricedWebTools(prov, body) : [];
    if (unpriced.length) return refuse(400, 'invalid_request', `HE-PROXY-011 the request declares a provider-hosted web tool with no published per-call fee in the price table (${unpriced.join(', ')}); an install slot refuses it rather than meter it at $0 (docs/errors.md). fix: use a hosted tool the price table prices, or add its fee row to a new dated price table`, model);
    // In the via-OpenRouter mode the effort fields come from the Gemini body the harness sent; the body sent on is its translation.
    const geminiBody = body;
    let translated: ReturnType<typeof toChat> | null = null;
    if (via) {
      try { translated = toChat(body ?? {}, model ?? '', this.signatures); }
      catch (e) { if (e instanceof TranslationRefused) return refuse(400, 'invalid_request', e.message, model); throw e; }
      body = translated.chat;
      if (streamed) body.stream = true;
    }
    const upModel = via ? (body!.model as string) : model;
    const upRoute = via ? '/v1/chat/completions' : route;
    const upSearch = via ? '' : search;
    const pinned = upProv === 'openrouter' ? openrouterRefusal(body, upModel, via ? OPENROUTER_PINS : OPENROUTER_MODELS) : null;
    if (pinned) return refuse(400, 'invalid_request', `HE-PROXY-008 ${pinned}; the metering proxy forwards an OpenRouter request only for an allowlisted model on its pinned endpoint (docs/errors.md). fix: name the bare model id and drop OpenRouter routing fields`, model);
    if (prov === 'xai' && body?.previous_response_id !== undefined && body.previous_response_id !== null) return refuse(400, 'invalid_request', 'HE-PROXY-013 the request sets previous_response_id, which continues a conversation stored on xAI\'s servers that this proxy can neither see nor price; it sends every Responses request with store false (docs/errors.md). fix: send the whole conversation in input', model);
    if (prov === 'openrouter' && route === '/v1/responses' && !MUSE_CODE_CATALOG.data.some((d) => d.id === upModel)) return refuse(403, 'invalid_request', 'route POST /openrouter/v1/responses is allowlisted only for the Muse Code catalog (' + MUSE_CODE_CATALOG.data.map((d) => d.id).join(', ') + '); every other OpenRouter model goes through /v1/chat/completions', model);
    if (prov === 'openrouter' && route === '/v1/responses' && body?.previous_response_id !== undefined && body.previous_response_id !== null) return refuse(400, 'invalid_request', 'HE-PROXY-013 the request sets previous_response_id, which continues a conversation stored on a provider\'s servers that this proxy can neither see nor price (docs/errors.md). fix: send the whole conversation in input', model);
    const listedRow = upProv === 'openrouter' ? canonicalLookup(`openrouter:${upModel}`) : undefined;
    const pinnedRow = listedRow && priceOnDate(listedRow, new Date(at));
    if (upProv === 'openrouter' && !pinnedRow) return refuse(402, 'budget', `unpriced request refused: no price-table row for openrouter:${upModel}`, model);
    // The layer filter edits the parsed body before the output cap is injected and the request is priced and reserved.
    let receipt: Omit<AblationReceipt, 'at' | 'key'> | null = null;
    if (ablation && body) {
      const filter = await import('./ablate.ts');
      if (filter.GENERATION_ROUTES.includes(route)) receipt = filter.ablate(ablation, route, body);
    }
    // internal-task: the sections are read from the body the filter left (the bytes billed), before the proxy adds stream_options or an output cap.
    let request: { sections: RequestSections } | { error: string } | null = null;
    if (p.logSections && body && sectionRoute(upProv, upRoute)) {
      try { request = { sections: requestSections(body, Buffer.byteLength(receipt || via ? JSON.stringify(body) : raw!), upProv, upRoute) }; }
      catch (e) { request = { error: `request sections: ${(e as Error).message.slice(0, 200)}` }; }
    }
    if (streamed && (upProv === 'openai' || upProv === 'particle' || upProv === 'openrouter' || upProv === 'xai') && upRoute === '/v1/chat/completions') body!.stream_options = { ...(body!.stream_options ?? {}), include_usage: true };
    if (prov === 'xai' && route === '/v1/responses' && body) body.store = false;
    // OpenRouter: one endpoint, no fallback, and no endpoint dearer than the price-table row the request is metered at.
    // A tier-pinned model also names OpenRouter's standard tier, so neither a flex nor a priority endpoint can serve it.
    if (pinnedRow && body && upModel) {
      const pin = OPENROUTER_PINS[upModel]!;
      body.provider = { only: [pin.only], allow_fallbacks: false, max_price: { prompt: pinnedRow.input, completion: pinnedRow.output } };
      if (pin.service_tier) body.service_tier = pin.service_tier;
    }
    const fields = body ? outputFields(upProv, upRoute) : [];
    const cap = Math.min(p.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS, upProv === 'openrouter' ? OPENROUTER_MAX_OUTPUT[upModel ?? ''] ?? Infinity
      : prov === 'google' ? GEMINI_MAX_OUTPUT[model ?? ''] ?? Infinity : Infinity);
    // Gemini's limit sits in generationConfig (or the REST snake_case generation_config).
    const gen = prov === 'google' && !via && body ? body.generationConfig ?? body.generation_config ?? (body.generationConfig = {}) : null;
    if (gen !== null && (typeof gen !== 'object' || Array.isArray(gen))) return refuse(400, 'invalid_request', 'generationConfig must be a JSON object', model);
    // The output cap and the reservation bound one candidate; Gemini bills every candidate it generates.
    const candidates = gen ? [gen.candidateCount, gen.candidate_count].filter((v) => v !== undefined) : [];
    if (candidates.some((v) => v !== 1)) return refuse(400, 'invalid_request', `HE-PROXY-013 the request asks for candidateCount ${candidates.map((v) => JSON.stringify(v)).join(', ')}; the output cap and the reservation cover one candidate, and Gemini bills every candidate it generates (docs/errors.md). fix: send candidateCount 1 or leave it out`, model);
    if ((fields.length || gen) && body) {
      const stated = (gen ? [gen.maxOutputTokens, gen.max_output_tokens] : [body.max_tokens, body.max_completion_tokens, body.max_output_tokens]).filter((v): v is number => typeof v === 'number');
      if (stated.some(v => v > cap)) return refuse(400, 'invalid_request', `requested ${Math.max(...stated)} output tokens, above this cell's cap of ${cap}`, model);
      if (stated.some(v => !Number.isInteger(v) || v < 1)) return refuse(400, 'invalid_request', `an output limit must be a positive whole number of tokens (got ${stated.join(', ')}); it would lower the reservation without bounding the output`, model);
      if (gen) { if (!stated.length) gen.maxOutputTokens = cap; }
      // A limit in a field this route does not honor (max_output_tokens on chat completions) bounds nothing, so the cap is injected.
      else if (!fields.some(f => typeof body![f] === 'number')) body[fields[0]!] = cap;
    }
    const target = `${this.options.upstream?.[upProv] ?? UPSTREAM[upProv]}${upRoute}${upSearch}`;
    const outBody = body === undefined ? undefined : JSON.stringify(body);
    let price: ReturnType<typeof priceRequest>;
    try { price = priceRequest(`${UPSTREAM[upProv]}${upRoute}${upSearch}`, body, { now: new Date(at) }); }
    catch (e) { return refuse(402, 'budget', `unpriced request refused: ${(e as Error).message}`, model); }
    // A via-OpenRouter request is the cell's google:<model> call, priced at its openrouter:google/<model> row.
    const callId = price ? (via ? `google:${model}` : `${prov}:${price.model}`) : null;
    if (callId && p.allowModels && !p.allowModels.includes(callId)) return refuse(403, 'budget', `${callId} is not on this cell's model allowlist`, model);
    if (callId && slotModels && !slotModels.includes(callId)) return refuse(403, 'budget', `${callId} is not on slot ${slot}'s model list (${slotModels.join(', ') || 'none'})`, model);
    // internal-task Phase B: the opt-in request cap counts the slot's requests for its first model (the cell's), not its utility models.
    if (price && binding?.maxRequests && callId === slotModels?.[0]) {
      if (binding.sent! >= binding.maxRequests) {
        if (binding.collect && body && !this.refusedBody.has(key)) this.refusedBody.set(key, structuredClone(body));
        return refuse(400, REQUEST_CAP, `${REQUEST_CAP}: slot ${slot} already sent its ${binding.maxRequests} model requests`, model);
      }
      binding.sent!++;
    }
    if (binding?.collect && body) { const list = this.collected.get(key) ?? []; list.push(structuredClone(body)); this.collected.set(key, list); }
    const bounded = price ? { ...price, inputTokens: Math.max(price.inputTokens, Buffer.byteLength(outBody ?? '') + 64) } : null;
    // internal-task: an install slot also reserves the most its declared hosted web tools can bill (hosted-tools.ts webToolAllowance).
    const reserved = bounded ? reservationUsd(bounded) + (install ? webToolAllowance(prov, body) : 0) : 0;
    let entry: string | null = null;
    if (bounded) {
      try { entry = p.lease.reserve(reserved, `${upProv}:${bounded.model} ${bounded.kind} [${key}]`); }
      catch (e) { return refuse(402, 'budget', (e as Error).message, model); }
    }
    const headers = new Headers(req.headers);
    for (const h of ['host', 'content-length', 'accept-encoding', 'connection', ...CREDENTIAL_HEADERS]) headers.delete(h);
    if (prov === 'anthropic') { headers.set('x-api-key', realKey); if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01'); }
    else if (prov === 'google' && !via) headers.set('x-goog-api-key', realKey);
    else headers.set('authorization', `Bearer ${realKey}`);
    if (outBody !== undefined) headers.set('content-type', 'application/json');
    // internal-task (H10): route copies ride with the knobs onto every forwarded or failed line of a routes slot, and only there.
    const named = via ? model : bounded?.model ?? model;
    const housekeeping = !!named && !!slotModels?.length && slotModels[0] !== `${prov}:${named}`;
    const routeFields = !routes || !p.routeTexts || !body ? {} : housekeeping ? { housekeeping: true } : { route_copies: routeCopies(body, p.routeTexts) };
    const viaFields = translated ? { upstream: VIA_OPENROUTER as typeof VIA_OPENROUTER, ...(translated.dropped.length ? { translation_dropped: translated.dropped } : {}) } : {};
    const knobs = { ...effortFields(geminiBody), ...routeFields, ...viaFields };
    /** `unfinished`: `cost` is the partial usage of a stream that ended before its final usage, charged at no less than the reservation.
     *  `response`: the parsed body, or a stream's text, which the usage-line schema v1 fields are read from once the request is charged. */
    const settle = (cost: ReturnType<typeof usageCost>, status: number, isStream: boolean, response: unknown, cached?: number, reason?: string, unfinished = false, facts: Partial<UsageLine> = {}) => {
      // internal-task: an install slot charges the hosted web tool fees the response reports on top of its tokens.
      const web = install && bounded ? webToolUse(prov, route, response, isStream) : null;
      const webUsd = web ? web.web_search_usd + web.web_fetch_usd : 0;
      if (cost && webUsd > 0) cost = { ...cost, usd: cost.usd + webUsd };
      // With no usage the reservation is charged, and an install slot adds the web tool fees the response still reports.
      const unknownUsd = reserved + (cost ? 0 : webUsd);
      const charged = !!bounded && (!cost || unfinished);
      if (entry) p.lease.settle(entry, cost && unfinished ? { ...cost, unfinished } : cost ?? (webUsd > 0 ? { usd: unknownUsd, unfinished: true } : null));
      const usd = !cost ? unknownUsd : unfinished ? Math.max(reserved, cost.usd) : cost.usd;
      this.charge(key, prov, named ?? null, usd, charged);
      const elsewhere = facts.served_elsewhere ? `HE-PROXY-009 OpenRouter answered from ${facts.served_provider ?? 'an unnamed provider'}${facts.served_tier ? ' at its ' + facts.served_tier + ' tier' : ''}, not the pinned ${OPENROUTER_PINS[upModel ?? '']?.served ?? 'endpoint'}${OPENROUTER_PINS[upModel ?? '']?.service_tier ? ' at its standard tier' : ''}; the trial is infra_error (docs/errors.md)` : undefined;
      const limited = facts.openrouter_limit_source ? `HE-PROXY-014 OpenRouter refused the request for its spend limit (${facts.openrouter_limit_source}); no model ran, and new trials wait for the limit to reset (docs/errors.md)` : undefined;
      const why = [elsewhere, limited, reason].filter(Boolean).join('; ');
      this.log({ at, key, provider: prov, route, model: named, outcome: 'forwarded', ...(why ? { reason: why } : {}), status, reserved_usd: reserved, actual_usd: usd,
        input_tokens: cost?.input_tokens, output_tokens: cost?.output_tokens, ...(cost && cached !== undefined ? { cached_tokens: cached } : {}), charged_reservation: charged,
        ...(charged ? { usage_unknown: true as const, reported_usd: cost?.usd ?? 0 } : {}), streamed: isStream, ...knobs,
        ...facts, ...(cost?.reported_usd !== undefined ? { openrouter_cost_usd: cost.reported_usd } : {}), ...safetyStop(response), ...finishReason(response), ...lineExtrasFor(upProv, upRoute, response, request), ...web }, install);
    };
    // The upstream never answered, or its non-streamed body broke off: usage is unknown, so the reservation is charged.
    const failed = (message: string) => {
      if (entry) p.lease.settle(entry, null);
      this.charge(key, prov, named ?? null, reserved, !!bounded);
      this.observe(key, 'failed');
      this.log({ at, key, provider: prov, route, model, outcome: 'failed', reason: message.slice(0, 300), reserved_usd: reserved, actual_usd: reserved, charged_reservation: !!bounded,
        ...(bounded ? { usage_unknown: true as const, reported_usd: 0 } : {}), ...knobs }, install);
      return json(502, 'product_error', `upstream failed: ${message}`);
    };
    if (receipt && p.ablationLog) appendFileSync(p.ablationLog, JSON.stringify({ at, key, ...receipt }) + '\n');
    if (capture) {
      try { (this.captures ??= new BodyCapture(p.captureMaxBytes ?? DEFAULT_CAPTURE_MAX_BYTES)).write(capture, key, route, body ?? null); }
      catch (e) {
        if (entry) p.lease.settle(entry, { usd: 0, input_tokens: 0, output_tokens: 0 });
        return refuse(500, 'product_error', `HE-PROXY-007 the request body could not be captured, so it was not sent: ${(e as Error).message.slice(0, 200)}`, model);
      }
    }
    let res: Response;
    try { res = await send(target, { method: req.method, headers, body: outBody, timeout: false, signal: AbortSignal.timeout(UPSTREAM_DEADLINE_MS) } as RequestInit); }
    catch (e) { return failed((e as Error).message); }
    const out = new Headers(res.headers);
    for (const h of ['content-encoding', 'content-length', 'transfer-encoding']) out.delete(h);
    const streamAnswer = (res.headers.get('content-type') ?? '').includes('event-stream') && !!res.body;
    const answerFacts = (text: string) => ({ ...responseFacts(upProv, upModel, text, streamAnswer, res.ok, upRoute), ...(res.ok ? {} : errorFacts(res.headers.get('retry-after'), text, [realKey, binding?.token])) });
    if (streamAnswer) {
      const done = beginStream();
      const [upstreamClient, meterBranch] = res.body!.tee();
      const client = translated && res.ok ? geminiEvents(upstreamClient, new GeminiStream(model ?? '', translated.includeThoughts, this.signatures)) : upstreamClient;
      this.observe(key, res.status);
      void readBody(meterBranch).then(
        ({ text, error }) => {
          // Gemini chunks carry usageMetadata, not usage: streamUsageCost reads the last one.
          const google = prov === 'google' && !via;
          const u = google ? null : sseUsage(text);
          const cost = !bounded ? null : google ? streamUsageCost(bounded, text) : u ? usageCost(bounded, { usage: u }) : null;
          const unbilled = bounded && !cost && !error ? unbilledAnswer(upProv, res.status, jsonOrNull(text), text) : null;
          if (unbilled) {
            settle(NOTHING_USED, res.status, true, text, undefined, unbilledReason(res.status, unbilled.type), false, answerFacts(text));
            return;
          }
          const unfinished = error ? `the stream failed before its final usage: ${error.message.slice(0, 200)}` : google ? geminiStreamIncomplete(text) : sseIncomplete(text);
          const over = !!unfinished && !!cost && cost.usd > reserved;
          const reason = !bounded || (cost && !unfinished) ? undefined
            : `${unfinished ?? 'the stream carried no usage'}${over ? '; charged its partial usage, which cost more than the reservation' : ''}`;
          settle(cost, res.status, true, text, cachedTokens(google ? lastUsageMetadata(text) : u), reason, !!unfinished, answerFacts(text));
        },
      ).finally(done);
      return new Response(client, { status: res.status, headers: out });
    }
    const { text, error } = await readBody(res.body);
    if (error) return failed(`HTTP ${res.status} body failed before it ended: ${error.message}`);
    let cost: ReturnType<typeof usageCost> = null;
    let parsed = true;
    try { JSON.parse(text); } catch { parsed = false; }
    this.observe(key, res.ok && !parsed ? 'unparseable' : res.status);
    const parsedBody = parsed ? JSON.parse(text) as { usage?: unknown; usageMetadata?: unknown } : null;
    if (bounded && parsedBody) cost = usageCost(bounded, parsedBody);
    let reason: string | undefined;
    const unbilled = !cost && bounded ? unbilledAnswer(upProv, res.status, parsedBody, text) : null;
    if (unbilled) {
      cost = NOTHING_USED;
      reason = unbilledReason(res.status, unbilled.type);
    } else if (!cost && bounded) reason = 'the response carried no usage';
    settle(cost, res.status, false, parsedBody, cachedTokens(prov === 'google' && !via ? parsedBody?.usageMetadata : parsedBody?.usage), reason, false, answerFacts(text));
    if (!translated) return new Response(text, { status: res.status, headers: out });
    out.set('content-type', 'application/json');
    const answer = res.ok && parsedBody ? fromChat(parsedBody as Record<string, any>, model ?? '', translated.includeThoughts, this.signatures) : geminiError(res.ok ? 502 : res.status, text);
    return new Response(JSON.stringify(answer), { status: res.ok && !parsedBody ? 502 : res.status, headers: out });
  }
}

/** OpenRouter's event stream, turned into Gemini's as it arrives (runner/proxy/gemini-openrouter.ts GeminiStream). */
function geminiEvents(upstream: ReadableStream<Uint8Array>, stream: GeminiStream): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  return upstream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) { const out = stream.push(decoder.decode(chunk, { stream: true })); if (out) controller.enqueue(encoder.encode(out)); },
    flush(controller) { const out = stream.push(decoder.decode() + '\n') + stream.end(); if (out) controller.enqueue(encoder.encode(out)); },
  }));
}

/** internal-task: the fields a forwarded line adds, read after the request was charged so they can never change a charge;
 *  `request` is null without --log-sections or off the chat routes. Never throws. */
export function lineExtrasFor(prov: string, route: string, response: unknown, request: { sections: RequestSections } | { error: string } | null): Partial<UsageLine> {
  try {
    const x = responseExtras(prov, route, response, request && 'sections' in request ? request.sections.tools_declared.map(t => t.name) : []);
    const counts = { cache_write_tokens: x.cache_write_tokens, cache_write_1h_tokens: x.cache_write_1h_tokens, reasoning_tokens: x.reasoning_tokens };
    if (!request) return counts;
    return 'error' in request ? { ...counts, sections_error: request.error } : { ...counts, tools_called: x.tools_called, sections: request.sections };
  } catch (e) {
    return { ...NO_EXTRAS, ...(request ? { sections_error: `response extras: ${(e as Error).message.slice(0, 200)}` } : {}) };
  }
}

/** The harness side of cross-process attribution: bind a slot to a key around a question or an ingest, then read its meter. */
export class ProxyControl {
  constructor(private base: string, private token: string | null = process.env.SHOOTOUT_PROXY_CONTROL_TOKEN ?? null) {}
  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.base.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(this.token ? { 'x-proxy-control': this.token } : {}) }, body: JSON.stringify(body), keepalive: false });
    if (!res.ok) throw new Error(`metering proxy ${path}: HTTP ${res.status}`);
    return res.json();
  }
  bind(slot: string, key: string, token?: string, models?: string[], ablation?: AblationSpec, capture?: string) { return this.post('/__proxy/bind', { slot, key, ...(token ? { token } : {}), ...(models ? { models } : {}), ...(ablation ? { ablation } : {}), ...(capture ? { capture } : {}) }); }
  unbind(slot: string) { return this.post('/__proxy/unbind', { slot }); }
  finalize(key: string, timeoutMs = 30_000) { return this.post('/__proxy/finalize', { key, timeout_ms: timeoutMs }) as Promise<Meter>; }
  /** Run `fn` with the slot's provider calls charged to `key`; returns its result and the key's meter. */
  async around<T>(slot: string, key: string, fn: () => Promise<T>): Promise<{ value?: T; error?: unknown; meter: Meter }> {
    await this.bind(slot, key);
    let value: T | undefined, error: unknown;
    try { value = await fn(); } catch (e) { error = e; }
    await this.unbind(slot);
    return { value, error, meter: await this.finalize(key) };
  }
}

export interface ProxyCliArgs {
  host: string; port: number; ledger: string; leaseUsd: number; runId: string; usageLog: string | null;
  allowModels: string[] | null; maxOutputTokens: number | null; forbiddenMarkers: string[]; streaming: 'meter' | 'refuse'; upstream: Partial<Record<ProviderName, string>>; newRun: boolean;
  controlToken: string | null; freeCountTokens: boolean; ablationLog: string | null; logSections: boolean;
  /** internal-task: --refuse-hosted-tools, off without it. */
  refuseHostedTools: boolean;
  /** internal-task: --capture-bodies <dir> and --capture-max-bytes <n>, null without them. */
  captureBodies: string | null; captureMaxBytes: number | null;
  /** internal-task (H10): --route-texts <file.json>, null without it. */
  routeTexts: RouteTexts | null;
  /** internal-task: --google-via openrouter, null without it. */
  googleVia: typeof VIA_OPENROUTER | null;
}

export function parseProxyArgs(argv: string[]): ProxyCliArgs {
  const one = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const listen = one('--listen') ?? '127.0.0.1:8787';
  const at = listen.lastIndexOf(':');
  const port = Number(listen.slice(at + 1));
  if (at <= 0 || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--listen must look like host:port');
  const ledger = one('--budget-ledger'), runId = one('--run-id'), lease = one('--lease-usd');
  if (!ledger || !runId || !lease) throw new Error('the proxy needs --budget-ledger <file>, --lease-usd <n> and --run-id <id>; it never forwards without a lease');
  const streaming = (one('--streaming') ?? 'meter') as 'meter' | 'refuse';
  if (!['meter', 'refuse'].includes(streaming)) throw new Error('--streaming must be meter or refuse');
  const upstream: Partial<Record<ProviderName, string>> = {};
  argv.forEach((a, i) => {
    if (a !== '--upstream') return;
    const [prov, base] = [argv[i + 1].slice(0, argv[i + 1].indexOf('=')), argv[i + 1].slice(argv[i + 1].indexOf('=') + 1)];
    if (!(prov in UPSTREAM) || !/^https?:\/\//.test(base)) throw new Error('--upstream must look like openai=http://host:port');
    upstream[prov as ProviderName] = base.replace(/\/$/, '');
  });
  const markersFile = one('--forbidden-markers');
  const routeTextsFile = one('--route-texts');
  let routeTexts: RouteTexts | null = null;
  if (routeTextsFile) {
    const t = JSON.parse(readFileSync(routeTextsFile, 'utf8')) as Partial<RouteTexts>;
    const texts = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0);
    if (!texts(t.copies) || !texts(t.listing ?? [])) throw new Error('--route-texts must name a JSON file {"copies": [text, ...], "listing": [text, ...]} of non-empty strings');
    routeTexts = { copies: t.copies!, listing: t.listing ?? [] };
  }
  const maxOutput = one('--max-output-tokens');
  const googleVia = one('--google-via') ?? null;
  if (googleVia !== null && googleVia !== VIA_OPENROUTER) throw new Error('--google-via must be openrouter');
  const captureMax = one('--capture-max-bytes');
  if (captureMax !== undefined && !(Number.isSafeInteger(Number(captureMax)) && Number(captureMax) > 0)) throw new Error('--capture-max-bytes must be a positive whole number of bytes');
  if (captureMax !== undefined && !one('--capture-bodies')) throw new Error('--capture-max-bytes needs --capture-bodies <dir>');
  if (maxOutput !== undefined && !(Number.isSafeInteger(Number(maxOutput)) && Number(maxOutput) > 0)) throw new Error('--max-output-tokens must be a positive whole number of tokens (the harness\'s own max output)');
  return {
    host: listen.slice(0, at), port, ledger, leaseUsd: Number(lease), runId, usageLog: one('--usage-log') ?? null,
    allowModels: one('--allow-models') ? one('--allow-models')!.split(',').map(s => s.trim()).filter(Boolean) : null,
    maxOutputTokens: maxOutput !== undefined ? Number(maxOutput) : null,
    forbiddenMarkers: markersFile ? readFileSync(markersFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean) : [],
    streaming, upstream, newRun: argv.includes('--new-run'), freeCountTokens: argv.includes('--free-count-tokens'), logSections: argv.includes('--log-sections'), refuseHostedTools: argv.includes('--refuse-hosted-tools'), captureBodies: one('--capture-bodies') ?? null, captureMaxBytes: captureMax !== undefined ? Number(captureMax) : null, controlToken: one('--control-token') ?? process.env.SHOOTOUT_PROXY_CONTROL_TOKEN ?? null,
    routeTexts,
    ablationLog: one('--ablation-log') ?? null,
    googleVia: googleVia as typeof VIA_OPENROUTER | null,
  };
}

export function startLeaseProxy(a: ProxyCliArgs, env: Record<string, string | undefined> = process.env): MeteringProxy {
  const lease = BudgetRun.openLease({ runId: a.runId, leaseUsd: a.leaseUsd, ledgerPath: a.ledger, runner: 'metering-proxy', maxOutputTokens: a.maxOutputTokens, newRun: a.newRun });
  const proxy = new MeteringProxy({ hostname: a.host, port: a.port, upstream: a.upstream, controlToken: a.controlToken,
    policy: { lease, env, allowModels: a.allowModels, maxOutputTokens: a.maxOutputTokens ?? undefined, forbiddenMarkers: a.forbiddenMarkers, streaming: a.streaming, usageLog: a.usageLog ?? `${lease.ledgerPath}.usage.ndjson`, freeCountTokens: a.freeCountTokens, ...(a.googleVia ? { googleVia: a.googleVia } : {}), logSections: a.logSections, ...(a.refuseHostedTools ? { refuseHostedTools: true } : {}), ...(a.captureBodies ? { captureRoot: resolve(a.captureBodies), ...(a.captureMaxBytes ? { captureMaxBytes: a.captureMaxBytes } : {}) } : {}), ...(a.ablationLog ? { ablationLog: a.ablationLog } : {}), ...(a.routeTexts ? { routeTexts: a.routeTexts } : {}) } });
  proxy.start();
  return proxy;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  try {
    if (argv[0] === 'summary') {
      const one = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
      const s = ledgerStatus({ ledgerPath: one('--budget-ledger'), runId: one('--run-id') });
      if (!s.run) throw new Error(`no lease ${one('--run-id')} in ${s.ledger}`);
      const requests = BudgetRun.runRequests(s.ledger, s.run.run_id);
      // internal-task: install-slot totals from the usage log lines written while this lease was open (the log has no run id).
      const usageLog = one('--usage-log') ?? `${s.ledger}.usage.ndjson`;
      const { started_at: from, finished_at: until } = s.run;
      const lines = (existsSync(usageLog) ? readFileSync(usageLog, 'utf8').split('\n') : []).filter((l) => l.includes('"kind":"install_slot"'))
        .map((l) => jsonOrNull(l) as UsageLine | null).filter((l): l is UsageLine => !!l && l.at >= from && (!until || l.at <= until));
      const install = installTotals(lines);
      console.log(JSON.stringify({ run_id: s.run.run_id, lease_usd: s.run.budget_usd, committed_usd: s.run.committed_usd, measured_usd: s.run.measured_usd, usage_unknown_usd: s.run.usage_unknown_usd, overshoot_usd: s.run.overshoot_usd, requests,
        max_output_tokens: BudgetRun.leaseMaxOutputTokens(s.ledger, s.run.run_id) ?? DEFAULT_MAX_OUTPUT_TOKENS, finished_at: s.run.finished_at, ...(Object.keys(install).length ? { install } : {}) }));
    } else {
      const a = parseProxyArgs(argv);
      const proxy = startLeaseProxy(a);
      const keys = (Object.keys(KEY_ENV) as ProviderName[]).filter(p => process.env[KEY_ENV[p]]);
      process.stderr.write(`[metering-proxy] lease ${a.runId} $${a.leaseUsd.toFixed(2)} on ${a.host}:${proxy.port}; providers with keys: ${keys.join(', ') || 'none'}; ledger ${a.ledger}\n`);
      const stop = () => { proxy.stop(); process.stderr.write(`[metering-proxy] stopped: ${JSON.stringify(proxy.status())}\n`); process.exit(0); };
      process.on('SIGTERM', stop);
      process.on('SIGINT', stop);
    }
  } catch (e) {
    process.stderr.write(`[metering-proxy] ${(e as Error).message}\n`);
    process.exit(e instanceof BudgetExceededError ? 3 : 2);
  }
}
