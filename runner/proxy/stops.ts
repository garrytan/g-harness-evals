/**
 * Provider safety-filter stops on the metering proxy's usage lines (internal-task plan decision 9, R95). Record only: the proxy
 * never refuses, retries or changes an answer for a stop. A stop is a result of its own, apart from a model failure, so
 * each forwarded line names the provider's own stop signal in `safety_stop`, written `<field>:<value>` from the fixed
 * values below. No text from the answer reaches the line.
 *
 * - Anthropic Messages: `stop_reason` "refusal" (the body, or a stream's message_delta).
 * - Chat Completions (OpenAI, Particle, OpenRouter, xAI): a choice's `finish_reason` "content_filter", or a `refusal`
 *   message (its text is never kept).
 * - Responses (OpenAI, xAI): an output message part of type "refusal", or `incomplete_details.reason` "content_filter".
 * - Gemini: a candidate's `finishReason` SAFETY, PROHIBITED_CONTENT, BLOCKLIST, RECITATION, SPII or IMAGE_SAFETY, or any
 *   `promptFeedback.blockReason` (the prompt was blocked before the model ran).
 */

export const GEMINI_SAFETY_FINISHES = ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'RECITATION', 'SPII', 'IMAGE_SAFETY'] as const;
const TOKEN = /^[A-Z_]{1,40}$/;

/** The first safety stop in one answer object (a body, a stream chunk or event), or undefined. */
function stopIn(o: unknown): string | undefined {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined;
  const r = o as Record<string, any>;
  if (r.stop_reason === 'refusal' || r.delta?.stop_reason === 'refusal' || r.message?.stop_reason === 'refusal') return 'stop_reason:refusal';
  for (const c of Array.isArray(r.choices) ? r.choices : []) {
    if (c?.finish_reason === 'content_filter') return 'finish_reason:content_filter';
    if (typeof (c?.message ?? c?.delta)?.refusal === 'string' && (c.message ?? c.delta).refusal) return 'refusal';
  }
  const response = r.response && typeof r.response === 'object' ? r.response : r;
  if (response.incomplete_details?.reason === 'content_filter') return 'incomplete_details:content_filter';
  if (r.type === 'response.refusal.delta' || r.type === 'response.refusal.done') return 'refusal';
  for (const item of Array.isArray(response.output) ? response.output : []) {
    if (Array.isArray(item?.content) && item.content.some((p: any) => p?.type === 'refusal')) return 'refusal';
  }
  const block = r.promptFeedback?.blockReason ?? r.prompt_feedback?.block_reason;
  if (typeof block === 'string' && TOKEN.test(block)) return `blockReason:${block}`;
  for (const c of Array.isArray(r.candidates) ? r.candidates : []) {
    const finish = c?.finishReason ?? c?.finish_reason;
    if ((GEMINI_SAFETY_FINISHES as readonly string[]).includes(finish)) return `finishReason:${finish}`;
  }
  return undefined;
}

/** The safety stop an answer carries: `response` is the parsed body (a Gemini JSON array included) or a stream's text. Never throws. */
export function safetyStop(response: unknown): { safety_stop?: string } {
  try {
    const objects = typeof response === 'string'
      ? response.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } })
      : Array.isArray(response) ? response : [response];
    for (const o of objects) {
      const stop = stopIn(o);
      if (stop) return { safety_stop: stop };
    }
  } catch { /* a stop is recorded only when it can be read */ }
  return {};
}

/** The finish reason one answer object reports, as its provider spells it, or undefined. */
function finishIn(o: unknown): string | undefined {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined;
  const r = o as Record<string, any>;
  const candidate = (Array.isArray(r.candidates) ? r.candidates : []).map((c: any) => c?.finishReason).find((f: unknown) => typeof f === 'string');
  if (candidate) return candidate;
  const choice = (Array.isArray(r.choices) ? r.choices : []).map((c: any) => c?.finish_reason).find((f: unknown) => typeof f === 'string');
  if (choice) return choice;
  const stop = r.delta?.stop_reason ?? r.stop_reason ?? r.message?.stop_reason;
  if (typeof stop === 'string') return stop;
  const response = r.response && typeof r.response === 'object' ? r.response : r.object === 'response' ? r : null;
  if (response && typeof response.status === 'string' && response.status !== 'in_progress' && response.status !== 'queued') {
    return typeof response.incomplete_details?.reason === 'string' ? response.status + ':' + response.incomplete_details.reason : response.status;
  }
  return undefined;
}

const FINISH = /^[A-Za-z0-9_.:-]{1,64}$/;
/** Amendment 2 of frontier-shootout-2026-11, ruling B: the finish reason an answer reports, so a cut at the output cap shows
 *  (MAX_TOKENS, length, max_tokens, incomplete:max_output_tokens). `response` is the parsed body (a Gemini JSON array
 *  included) or a stream's text, whose last reported reason wins. Record only; never throws. */
export function finishReason(response: unknown): { finish_reason?: string } {
  try {
    const objects = typeof response === 'string'
      ? response.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } })
      : Array.isArray(response) ? response : [response];
    let last: string | undefined;
    for (const o of objects) last = finishIn(o) ?? last;
    return last !== undefined && FINISH.test(last) ? { finish_reason: last } : {};
  } catch { return {}; }
}
