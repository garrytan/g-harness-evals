/**
 * The google route's via-OpenRouter mode (internal-task): Gemini CLI speaks the Gemini API to the proxy's google route, and the
 * proxy reaches Gemini through OpenRouter's Chat Completions, because OpenRouter serves no Gemini-native endpoint
 * (POST openrouter.ai/api/v1beta/models/<model>:generateContent answers 404 where its real routes answer 401, checked
 * 2026-11-15, and its API reference names no such route). toChat turns a generateContent body into a Chat Completions body
 * and fromChat turns the answer back; GeminiStream turns OpenRouter's event stream into Gemini's.
 *
 * Thought signatures: Gemini 3 and later validate the thoughtSignature a function call came back with when that call is
 * replayed. OpenRouter returns it in reasoning_details as a reasoning.encrypted entry of format google-gemini-v1 whose id
 * is the tool call's id and whose data is the signature, one entry per assistant turn keyed to its first tool call
 * (RooCodeInc/Roo-Code#10640, pydantic/pydantic-ai#3548), and expects it back on the assistant message. The response side
 * puts data on that call's functionCall part as thoughtSignature and keeps the whole entry in a SignatureStore; the request
 * side sends the stored entry back unchanged, or rebuilds it from the call's id when the store has never seen the
 * signature. An entry with no matching call goes on the turn's last text part, where Gemini itself signs a turn without
 * calls. Long-decode continuation entries (gemini-continuation) are not used: the cell's output cap is below Gemini's
 * standard limit, so a stopped decode is a MAX_TOKENS finish.
 *
 * Anything the translation cannot carry is refused with HE-PROXY-012 before the request is priced or sent.
 */

export const VIA_OPENROUTER = 'openrouter';
export const CONTINUATION_ID = 'gemini-continuation';
export const SIGNATURE_FORMAT = 'google-gemini-v1';

export class TranslationRefused extends Error {
  constructor(message: string) { super('HE-PROXY-012 ' + message + "; the google route's via-OpenRouter mode cannot carry it (docs/errors.md)"); }
}

type Json = Record<string, any>;
export interface ReasoningDetail { type: string; data?: string; id?: string | null; format?: string; index?: number; [k: string]: unknown }

/** Signatures OpenRouter returned, with the reasoning_details entry each came in, so a replay sends back the same entry. */
export class SignatureStore {
  private entries = new Map<string, ReasoningDetail>();
  constructor(private readonly max = 20_000) {}
  keep(detail: ReasoningDetail) {
    if (typeof detail.data !== 'string') return;
    this.entries.delete(detail.data);
    this.entries.set(detail.data, structuredClone(detail));
    if (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
  }
  get(signature: string): ReasoningDetail | undefined { return this.entries.get(signature); }
}

const KNOWN_GENERATION = new Set(['temperature', 'topP', 'topK', 'maxOutputTokens', 'stopSequences', 'candidateCount', 'presencePenalty', 'frequencyPenalty',
  'seed', 'responseMimeType', 'responseSchema', 'responseJsonSchema', 'thinkingConfig', 'responseModalities']);
const DROPPED_TOP = ['safetySettings', 'labels'];
const KNOWN_TOP = new Set(['contents', 'systemInstruction', 'tools', 'toolConfig', 'generationConfig', 'model', ...DROPPED_TOP]);
const IMAGE = /^image\/(png|jpeg|webp|gif|heic|heif)$/;

const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
/** A field in Gemini's camelCase or its REST snake_case spelling, which its API also takes. */
const field = (o: Json | undefined, name: string) => o?.[name] ?? o?.[name.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())];
const camelKeys = (o: Json) => Object.fromEntries(Object.entries(o).map(([k, v]) => [camel(k), v]));

/** Keys whose value is a schema or a list of schemas. Every other key (default, enum, const, example, propertyOrdering,
 *  required) holds a plain value and is copied as it is, so a literal shaped like a schema is never rewritten. */
const SCHEMA_KEYS = new Set(['items', 'prefixItems', 'anyOf', 'oneOf', 'allOf', 'not', 'additionalProperties']);

/** A Gemini Schema (OpenAPI subset, upper-case type names) as JSON Schema. */
function jsonSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(jsonSchema);
  if (!s || typeof s !== 'object') return s;
  const out: Json = {};
  for (const [k, v] of Object.entries(s as Json)) {
    if (k === 'type' && typeof v === 'string') out.type = v.toLowerCase();
    else if (k === 'nullable') continue;
    else if (k === 'properties' && v && typeof v === 'object') out.properties = Object.fromEntries(Object.entries(v as Json).map(([p, ps]) => [p, jsonSchema(ps)]));
    else out[k] = SCHEMA_KEYS.has(k) ? jsonSchema(v) : v;
  }
  if ((s as Json).nullable === true && typeof out.type === 'string') out.type = [out.type, 'null'];
  return out;
}

const text = (parts: Json[]) => parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');

function systemText(si: unknown): string | null {
  if (si === undefined || si === null) return null;
  if (typeof si === 'string') return si;
  const parts = Array.isArray((si as Json).parts) ? (si as Json).parts as Json[] : [];
  if (parts.some((p) => typeof p.text !== 'string')) throw new TranslationRefused('systemInstruction holds a part that is not text');
  return parts.map((p) => p.text).join('\n');
}

function userContent(parts: Json[]): string | Json[] {
  if (parts.every((p) => typeof p.text === 'string' && !p.thought)) return text(parts);
  return parts.flatMap((p): Json[] => {
    if (p.thought) return [];
    if (typeof p.text === 'string') return [{ type: 'text', text: p.text }];
    const inline = field(p, 'inlineData');
    if (inline) {
      const mime = field(inline, 'mimeType');
      if (!IMAGE.test(mime ?? '')) throw new TranslationRefused('an inlineData part of type ' + mime);
      return [{ type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + inline.data } }];
    }
    if (field(p, 'fileData')) throw new TranslationRefused('a fileData part (an uploaded file URI)');
    throw new TranslationRefused('a user part with ' + (Object.keys(p).join(', ') || 'no fields'));
  });
}

/** A Chat Completions body for a generateContent body, whether the answer should carry thought text, and the fields dropped. */
export function toChat(body: Json, model: string, store: SignatureStore): { chat: Json; includeThoughts: boolean; dropped: string[] } {
  if (field(body, 'cachedContent') !== undefined) throw new TranslationRefused('cachedContent (an explicit Gemini context cache)');
  const unknown = Object.keys(body).filter((k) => !KNOWN_TOP.has(camel(k)));
  if (unknown.length) throw new TranslationRefused('the request field(s) ' + unknown.join(', '));
  const dropped = DROPPED_TOP.filter((k) => field(body, k) !== undefined);
  const messages: Json[] = [];
  const sys = systemText(field(body, 'systemInstruction'));
  if (sys !== null) messages.push({ role: 'system', content: sys });
  const open: Array<{ id: string; name: string }> = [];
  const contents = Array.isArray(body.contents) ? body.contents as Json[] : typeof body.contents === 'string' ? [{ role: 'user', parts: [{ text: body.contents }] }] : null;
  if (!contents) throw new TranslationRefused('contents that are not a list');
  contents.forEach((c, ci) => {
    const parts = Array.isArray(c.parts) ? c.parts as Json[] : [];
    if ((c.role ?? 'user') === 'model') {
      const other = parts.find((p) => !field(p, 'functionCall') && typeof p.text !== 'string');
      if (other) throw new TranslationRefused('a model part with ' + Object.keys(other).join(', '));
      const calls = parts.filter((p) => field(p, 'functionCall'));
      const toolCalls = calls.map((p, pi) => {
        const fc = field(p, 'functionCall');
        const id = typeof fc.id === 'string' && fc.id ? fc.id : 'call_' + ci + '_' + pi;
        open.push({ id, name: fc.name });
        return { id, type: 'function', function: { name: fc.name, arguments: JSON.stringify(fc.args ?? {}) } };
      });
      const details: ReasoningDetail[] = [];
      for (const p of parts) {
        const sig = field(p, 'thoughtSignature');
        if (typeof sig !== 'string' || !sig) continue;
        const callId = field(p, 'functionCall') ? toolCalls[calls.indexOf(p)]!.id : null;
        details.push(store.get(sig) ?? { type: 'reasoning.encrypted', data: sig, id: callId, format: SIGNATURE_FORMAT, index: details.length });
      }
      const msg: Json = { role: 'assistant', content: text(parts.filter((p) => !p.thought)) || null };
      if (toolCalls.length) msg.tool_calls = toolCalls;
      if (details.length) msg.reasoning_details = details;
      messages.push(msg);
      return;
    }
    for (const p of parts.filter((q) => field(q, 'functionResponse'))) {
      const fr = field(p, 'functionResponse');
      if (Array.isArray(fr.parts) && fr.parts.length) throw new TranslationRefused('a functionResponse that carries parts (a multimodal tool result)');
      const at = typeof fr.id === 'string' && fr.id ? open.findIndex((o) => o.id === fr.id) : open.findIndex((o) => o.name === fr.name);
      if (at < 0) throw new TranslationRefused('a functionResponse for ' + fr.name + ' with no function call before it');
      const [call] = open.splice(at, 1);
      messages.push({ role: 'tool', tool_call_id: call!.id, content: JSON.stringify(fr.response ?? {}) });
    }
    const rest = parts.filter((p) => !field(p, 'functionResponse'));
    if (rest.length) messages.push({ role: 'user', content: userContent(rest) });
  });
  const chat: Json = { model: 'google/' + model, messages };
  const tools = (Array.isArray(body.tools) ? body.tools as Json[] : []).flatMap((t) => {
    const extra = Object.keys(t).filter((k) => camel(k) !== 'functionDeclarations');
    if (extra.length) throw new TranslationRefused('the tool kind(s) ' + extra.join(', '));
    return ((field(t, 'functionDeclarations') ?? []) as Json[]).map((d) => ({ type: 'function', function: {
      name: d.name, ...(d.description ? { description: d.description } : {}),
      parameters: field(d, 'parametersJsonSchema') ?? jsonSchema(d.parameters) ?? { type: 'object', properties: {} } } }));
  });
  if (tools.length) chat.tools = tools;
  const fcc = field(field(body, 'toolConfig'), 'functionCallingConfig');
  if (fcc) {
    const mode = String(fcc.mode ?? 'AUTO').toUpperCase();
    const allowed = field(fcc, 'allowedFunctionNames') as string[] | undefined;
    if (mode === 'AUTO' || mode === 'MODE_UNSPECIFIED') chat.tool_choice = 'auto';
    else if (mode === 'NONE') chat.tool_choice = 'none';
    else if (mode === 'ANY' && allowed?.length === 1) chat.tool_choice = { type: 'function', function: { name: allowed[0] } };
    else if (mode === 'ANY' && !allowed?.length) chat.tool_choice = 'required';
    else throw new TranslationRefused('toolConfig mode ' + mode + (allowed?.length ? ' with ' + allowed.length + ' allowed functions' : ''));
  }
  const gen = camelKeys(field(body, 'generationConfig') ?? {});
  const unknownGen = Object.keys(gen).filter((k) => !KNOWN_GENERATION.has(k));
  if (unknownGen.length) throw new TranslationRefused('generationConfig field(s) ' + unknownGen.join(', '));
  if (gen.candidateCount !== undefined && gen.candidateCount !== 1) throw new TranslationRefused('candidateCount ' + gen.candidateCount);
  if (gen.responseModalities !== undefined && JSON.stringify((gen.responseModalities as string[]).map((m) => m.toUpperCase())) !== '["TEXT"]') throw new TranslationRefused('responseModalities ' + JSON.stringify(gen.responseModalities));
  if (gen.temperature !== undefined) chat.temperature = gen.temperature;
  if (gen.topP !== undefined) chat.top_p = gen.topP;
  if (gen.topK !== undefined) chat.top_k = gen.topK;
  if (gen.presencePenalty !== undefined) chat.presence_penalty = gen.presencePenalty;
  if (gen.frequencyPenalty !== undefined) chat.frequency_penalty = gen.frequencyPenalty;
  if (gen.seed !== undefined) chat.seed = gen.seed;
  if (gen.maxOutputTokens !== undefined) chat.max_tokens = gen.maxOutputTokens;
  if (Array.isArray(gen.stopSequences) && gen.stopSequences.length) chat.stop = gen.stopSequences;
  const schema = gen.responseJsonSchema ?? (gen.responseSchema !== undefined ? jsonSchema(gen.responseSchema) : undefined);
  if (gen.responseMimeType === 'application/json') chat.response_format = schema !== undefined ? { type: 'json_schema', json_schema: { name: 'response', schema } } : { type: 'json_object' };
  else if (schema !== undefined) throw new TranslationRefused('a responseSchema without responseMimeType application/json');
  else if (gen.responseMimeType !== undefined && gen.responseMimeType !== 'text/plain') throw new TranslationRefused('responseMimeType ' + gen.responseMimeType);
  const thinking = camelKeys(gen.thinkingConfig ?? {});
  if (typeof thinking.thinkingLevel === 'string') chat.reasoning = { effort: thinking.thinkingLevel.toLowerCase() };
  else if (typeof thinking.thinkingBudget === 'number') chat.reasoning = thinking.thinkingBudget === -1 ? { enabled: true } : thinking.thinkingBudget === 0 ? { effort: 'none' } : { max_tokens: thinking.thinkingBudget };
  return { chat, includeThoughts: thinking.includeThoughts === true, dropped };
}

/** Gemini's finishReason for an OpenRouter choice: the native Gemini reason when OpenRouter passed one on, else a mapping. */
export function finishReason(choice: Json): string | undefined {
  const native = choice.native_finish_reason;
  if (typeof native === 'string' && /^[A-Z_]+$/.test(native) && native !== 'CONTINUATION') return native === 'STOP' && choice.finish_reason === 'length' ? 'MAX_TOKENS' : native;
  return ({ stop: 'STOP', tool_calls: 'STOP', length: 'MAX_TOKENS', content_filter: 'SAFETY', error: 'OTHER' } as Record<string, string>)[choice.finish_reason] ?? (choice.finish_reason ? 'OTHER' : undefined);
}

export function usageMetadata(u: Json | undefined): Json | undefined {
  if (!u || typeof u.prompt_tokens !== 'number') return undefined;
  const thoughts = u.completion_tokens_details?.reasoning_tokens ?? 0;
  const cached = u.prompt_tokens_details?.cached_tokens;
  return { promptTokenCount: u.prompt_tokens, candidatesTokenCount: Math.max(0, (u.completion_tokens ?? 0) - thoughts), totalTokenCount: u.total_tokens ?? u.prompt_tokens + (u.completion_tokens ?? 0),
    ...(thoughts ? { thoughtsTokenCount: thoughts } : {}), ...(typeof cached === 'number' && cached > 0 ? { cachedContentTokenCount: cached } : {}) };
}

interface Message { reasoning?: string; content?: string; tool_calls: Array<{ id: string; name: string; arguments: string }>; details: ReasoningDetail[] }

/** Gemini parts for one assistant message: thought text when asked for, the text, then each call with its signature. */
function partsOf(msg: Message, includeThoughts: boolean, store: SignatureStore): Json[] {
  const out: Json[] = [];
  if (includeThoughts && msg.reasoning) out.push({ text: msg.reasoning, thought: true });
  if (msg.content) out.push({ text: msg.content });
  const signed = msg.details.filter((d) => d.type === 'reasoning.encrypted' && d.format === SIGNATURE_FORMAT && typeof d.data === 'string' && d.id !== CONTINUATION_ID);
  for (const d of signed) store.keep(d);
  const calls: Json[] = msg.tool_calls.map((c) => {
    let args: unknown;
    try { args = c.arguments ? JSON.parse(c.arguments) : {}; } catch { args = { _unparsed_arguments: c.arguments }; }
    const sig = signed.find((d) => d.id === c.id)?.data;
    return { functionCall: { id: c.id, name: c.name, args }, ...(sig ? { thoughtSignature: sig } : {}) };
  });
  out.push(...calls);
  const loose = signed.filter((d) => !msg.tool_calls.some((c) => c.id === d.id));
  if (loose.length) {
    let target = calls.find((c) => !c.thoughtSignature) ?? [...out].reverse().find((p) => typeof p.text === 'string' && !p.thought);
    if (!target) { target = { text: '' }; out.push(target); }
    target.thoughtSignature = loose[0]!.data;
  }
  return out;
}

/** A generateContent answer for a non-streamed Chat Completions answer. */
export function fromChat(res: Json, model: string, includeThoughts: boolean, store: SignatureStore): Json {
  const choice = (res.choices ?? [])[0] ?? {};
  const m = choice.message ?? {};
  const msg: Message = { reasoning: m.reasoning ?? undefined, content: m.content ?? undefined, details: Array.isArray(m.reasoning_details) ? m.reasoning_details : [],
    tool_calls: (m.tool_calls ?? []).map((c: Json) => ({ id: c.id, name: c.function?.name, arguments: c.function?.arguments ?? '' })) };
  const reason = finishReason(choice);
  const usage = usageMetadata(res.usage);
  const parts = partsOf(msg, includeThoughts, store);
  return { candidates: [{ ...(parts.length ? { content: { role: 'model', parts } } : {}), ...(reason ? { finishReason: reason } : {}), index: 0 }],
    ...(usage ? { usageMetadata: usage } : {}), modelVersion: model, ...(typeof res.id === 'string' ? { responseId: res.id } : {}) };
}

/** Gemini's error body for a non-2xx OpenRouter answer, keeping OpenRouter's message. */
export function geminiError(status: number, body: string): Json {
  let message = body.slice(0, 2000);
  try { message = JSON.parse(body)?.error?.message ?? message; } catch { /* keep the raw text */ }
  const name = ({ 400: 'INVALID_ARGUMENT', 401: 'UNAUTHENTICATED', 402: 'RESOURCE_EXHAUSTED', 403: 'PERMISSION_DENIED', 404: 'NOT_FOUND', 408: 'DEADLINE_EXCEEDED', 429: 'RESOURCE_EXHAUSTED', 500: 'INTERNAL', 502: 'UNAVAILABLE', 503: 'UNAVAILABLE', 504: 'DEADLINE_EXCEEDED' } as Record<number, string>)[status] ?? (status >= 500 ? 'INTERNAL' : 'FAILED_PRECONDITION');
  return { error: { code: status, message, status: name } };
}

/**
 * OpenRouter's Chat Completions event stream as Gemini's: text and thought deltas pass on as they arrive, and the calls,
 * their signatures, the finishReason and usageMetadata go out in one last chunk at the end, as Gemini sends a function
 * call whole.
 */
export class GeminiStream {
  private buffer = '';
  private details: ReasoningDetail[] = [];
  private calls: Array<{ id: string; name: string; arguments: string }> = [];
  private choice: Json = {};
  private usage: Json | undefined;
  private failure: Json | undefined;
  private ended = false;
  private id: string | undefined;
  constructor(private readonly model: string, private readonly includeThoughts: boolean, private readonly store: SignatureStore) {}

  private event(obj: Json): string { return 'data: ' + JSON.stringify({ ...obj, modelVersion: this.model, ...(this.id ? { responseId: this.id } : {}) }) + '\r\n\r\n'; }

  /** Gemini events for one piece of OpenRouter's stream. */
  push(chunk: string): string {
    this.buffer += chunk;
    let out = '';
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') { out += this.end(); continue; }
      let obj: Json;
      try { obj = JSON.parse(data); } catch { continue; }
      if (typeof obj.id === 'string') this.id = obj.id;
      if (obj.usage) this.usage = obj.usage;
      if (obj.error) this.failure ??= typeof obj.error === 'object' ? obj.error : { message: String(obj.error) };
      for (const c of obj.choices ?? []) {
        const d = c.delta ?? {};
        if (c.finish_reason === 'error') this.failure ??= c.error ?? { message: 'OpenRouter ended the choice with finish_reason error' };
        if (c.finish_reason) this.choice = c;
        if (Array.isArray(d.reasoning_details)) this.details.push(...d.reasoning_details);
        for (const t of d.tool_calls ?? []) {
          const i = typeof t.index === 'number' ? t.index : this.calls.length;
          const call = this.calls[i] ??= { id: '', name: '', arguments: '' };
          if (t.id) call.id = t.id;
          if (t.function?.name) call.name += t.function.name;
          if (t.function?.arguments) call.arguments += t.function.arguments;
        }
        const live: Json[] = [];
        if (this.includeThoughts && typeof d.reasoning === 'string' && d.reasoning) live.push({ text: d.reasoning, thought: true });
        if (typeof d.content === 'string' && d.content) live.push({ text: d.content });
        if (live.length) out += this.event({ candidates: [{ content: { role: 'model', parts: live }, index: 0 }] });
      }
    }
    return out;
  }

  /** The last chunk: calls, signatures, finishReason and usage. Empty once sent. A stream that failed or stopped before a
   *  finish_reason ends in a Gemini error event instead, with no half-built calls. */
  end(): string {
    if (this.ended) return '';
    this.ended = true;
    if (this.failure || !this.choice.finish_reason) {
      const failure = this.failure ?? { message: 'the OpenRouter stream ended before a finish_reason' };
      const code = typeof failure.code === 'number' && failure.code >= 400 && failure.code < 600 ? failure.code : 502;
      return this.event(geminiError(code, JSON.stringify({ error: failure })));
    }
    const tail = partsOf({ tool_calls: this.calls.map((c, i) => ({ ...c, id: c.id || 'call_stream_' + i })), details: this.details }, false, this.store);
    const reason = finishReason(this.choice);
    const usage = usageMetadata(this.usage);
    if (!tail.length && !reason && !usage) return '';
    return this.event({ candidates: [{ ...(tail.length ? { content: { role: 'model', parts: tail } } : {}), ...(reason ? { finishReason: reason } : {}), index: 0 }], ...(usage ? { usageMetadata: usage } : {}) });
  }
}

/** countTokens, answered locally and never forwarded: about four characters per token, Gemini CLI's own fallback rule. */
export function countTokensEstimate(body: Json): { totalTokens: number } {
  const req = field(body, 'generateContentRequest') ?? body;
  return { totalTokens: Math.ceil(JSON.stringify([field(req, 'systemInstruction') ?? null, req.contents ?? [], req.tools ?? []]).length / 4) };
}
