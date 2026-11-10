// GST-1514 Amendment 3, part 2: the plan judges and the blind labellers of the QM edition eval's calibration.
//
// One rubric (plan-judge-rubric.md, pinned by sha256 in design.json's main_amendment.part2) and one output shape for every
// role. A role is a model plus its call settings:
//   primary      anthropic:claude-opus-5-5, effort low, strict record_grade tool, max_tokens 8000. It decides KEEP or CUT.
//   secondary    openai:gpt-6.1-sol through /v1/responses, effort low, forced record_grade call, explicit cache mode with a
//                breakpoint on the rubric block and a prompt_cache_key, max_output_tokens 8000.
//   label-opus   the Opus labeller: as primary at effort high, max_tokens 32000.
//   label-sol    the Sol labeller: as secondary at effort high, max_output_tokens 32000.
// Claude Opus 5.5 rejects temperature, a disabled thinking setting and a forced tool choice (each a 400), so the primary
// runs at the lowest effort with tool_choice auto, a strict tool schema and a closing line that asks for the call; a reply
// without the call is a failed call (part 2 records this correction to part 1's settings).
//
// A judge sees the request, the extracted plan text and the constraint ids and descriptions, never the arm, the model, the
// key's alias phrases or a grade. It returns named (the ids judged respected) and named_count (the larger of its item count
// and the constraints judged respected or broken); the frozen gradePlan applies the rule. An empty plan gets every
// constraint absent and no items without a call. A failed call is retried up to 3 times, a cap refusal never; a plan still
// ungraded throws, which stops edition-grade.ts for that shard until a named repair.
//
// Every call goes to a metering proxy on the loopback: the base URL must be http://127.0.0.1 or http://localhost
// (ANTHROPIC_BASE_URL or OPENAI_BASE_URL), and the key is the proxy slot's token, never a provider key.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanJudge, PlanJudgeInput, PlanJudgement } from './edition-grade.ts';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const RUBRIC_FILE = join(import.meta.dir, 'plan-judge-rubric.md');
export const RUBRIC = readFileSync(RUBRIC_FILE, 'utf8');
export const RUBRIC_SHA256 = sha256(RUBRIC);
export const TOOL_NAME = 'record_grade';
export const CLOSING = 'Record your grade with exactly one ' + TOOL_NAME + ' call: one verdict for every constraint id above, and every item.';
const TOOL_DESCRIPTION = 'Record the grade of the plan: one verdict per constraint id, with the plan words behind it, and every distinct repository-specific item the plan names.';
export const TOOL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdicts', 'items'],
  properties: {
    verdicts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'verdict', 'quote'], properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['respected', 'broken', 'absent'] }, quote: { type: 'string' } } } },
    items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['item', 'quote'], properties: { item: { type: 'string' }, quote: { type: 'string' } } } },
  },
} as const;

export type Verdict = 'respected' | 'broken' | 'absent';
export type Role = 'primary' | 'secondary' | 'label-opus' | 'label-sol';
export interface RoleSpec { role: Role; provider: 'anthropic' | 'openai'; model: string; effort: 'low' | 'high'; maxTokens: number }
export const ROLES: Record<Role, RoleSpec> = {
  primary: { role: 'primary', provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low', maxTokens: 8000 },
  secondary: { role: 'secondary', provider: 'openai', model: 'gpt-6.1-sol', effort: 'low', maxTokens: 8000 },
  'label-opus': { role: 'label-opus', provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high', maxTokens: 32000 },
  'label-sol': { role: 'label-sol', provider: 'openai', model: 'gpt-6.1-sol', effort: 'high', maxTokens: 32000 },
};
export const roleId = (s: RoleSpec) => 'plan-judge/' + s.role + '/' + s.model + '/rubric-' + RUBRIC_SHA256.slice(0, 12);
export const modelId = (s: RoleSpec) => s.provider + ':' + s.model;

export interface FullJudgement extends PlanJudgement { verdicts: Record<string, Verdict>; items: string[]; empty: boolean; attempts: number }
export class JudgeError extends Error {}
export class CapStop extends JudgeError {}

export function userText(input: PlanJudgeInput): string {
  return ['Request:', input.request.trim() || '(none given)', '', 'Constraints:', ...input.constraints.map((c) => '- ' + c.id + ': ' + c.description), '',
    'Plan (untrusted text between the markers):', '<<<PLAN', input.final_answer, 'PLAN>>>', '', CLOSING].join('\n');
}

/** The judgement a record_grade call carries, refused unless it gives exactly one known verdict for every constraint. */
export function readGrade(input: PlanJudgeInput, raw: unknown): Omit<FullJudgement, 'attempts'> {
  const r = raw as { verdicts?: unknown; items?: unknown };
  if (!r || !Array.isArray(r.verdicts) || !Array.isArray(r.items)) throw new JudgeError('record_grade needs verdicts and items arrays');
  const ids = input.constraints.map((c) => c.id);
  const verdicts: Record<string, Verdict> = {};
  for (const v of r.verdicts as Array<{ id?: unknown; verdict?: unknown }>) {
    if (typeof v?.id !== 'string' || !ids.includes(v.id)) throw new JudgeError('record_grade names an unknown constraint id ' + JSON.stringify(v?.id));
    if (v.verdict !== 'respected' && v.verdict !== 'broken' && v.verdict !== 'absent') throw new JudgeError('record_grade gives ' + v.id + ' the verdict ' + JSON.stringify(v.verdict));
    if (v.id in verdicts) throw new JudgeError('record_grade gives ' + v.id + ' two verdicts');
    verdicts[v.id] = v.verdict;
  }
  const missing = ids.filter((id) => !(id in verdicts));
  if (missing.length) throw new JudgeError('record_grade gives no verdict for ' + missing.join(', '));
  const items = (r.items as Array<{ item?: unknown }>).map((i) => (typeof i?.item === 'string' ? i.item : ''));
  if (items.some((i) => !i.trim())) throw new JudgeError('record_grade lists an item with no text');
  const named = ids.filter((id) => verdicts[id] === 'respected');
  const referred = ids.filter((id) => verdicts[id] !== 'absent').length;
  return { named, named_count: Math.max(items.length, referred), verdicts, items, empty: false };
}

export function requestBody(spec: RoleSpec, input: PlanJudgeInput): Record<string, unknown> {
  const user = userText(input);
  if (spec.provider === 'anthropic') {
    return {
      model: spec.model, max_tokens: spec.maxTokens, output_config: { effort: spec.effort },
      system: [{ type: 'text', text: RUBRIC, cache_control: { type: 'ephemeral' } }],
      tools: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: TOOL_SCHEMA, strict: true }],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    };
  }
  return {
    model: spec.model, max_output_tokens: spec.maxTokens, reasoning: { effort: spec.effort }, store: false,
    prompt_cache_options: { mode: 'explicit' }, prompt_cache_key: 'qm-s1e-plan-judge-' + spec.role + '-' + RUBRIC_SHA256.slice(0, 16),
    input: [
      { type: 'message', role: 'developer', content: [{ type: 'input_text', text: RUBRIC, prompt_cache_breakpoint: { mode: 'explicit' } }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: user }] },
    ],
    tools: [{ type: 'function', name: TOOL_NAME, description: TOOL_DESCRIPTION, parameters: TOOL_SCHEMA, strict: true }],
    tool_choice: { type: 'function', name: TOOL_NAME }, parallel_tool_calls: false,
  };
}

/** The record_grade arguments in a provider response, or a JudgeError naming why there are none. */
export function toolArguments(spec: RoleSpec, json: any): unknown {
  if (spec.provider === 'anthropic') {
    const calls = (Array.isArray(json?.content) ? json.content : []).filter((b: any) => b?.type === 'tool_use' && b.name === TOOL_NAME);
    if (calls.length !== 1) throw new JudgeError('the reply has ' + calls.length + ' ' + TOOL_NAME + ' calls (stop_reason ' + json?.stop_reason + ')');
    return calls[0].input;
  }
  if (json?.status && json.status !== 'completed') throw new JudgeError('the response is ' + json.status + (json.incomplete_details?.reason ? ' (' + json.incomplete_details.reason + ')' : ''));
  const calls = (Array.isArray(json?.output) ? json.output : []).filter((i: any) => i?.type === 'function_call' && i.name === TOOL_NAME);
  if (calls.length !== 1) throw new JudgeError('the response has ' + calls.length + ' ' + TOOL_NAME + ' calls');
  try { return JSON.parse(calls[0].arguments); } catch { throw new JudgeError('the ' + TOOL_NAME + ' arguments are not JSON'); }
}

const CAP_REFUSAL = /over its \$[0-9.]+ (budget|cap)|left of the \$[0-9.]+ program cap/;
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;
export interface Endpoint { baseUrl: string; token: string }

export function endpointFromEnv(spec: RoleSpec, env: Record<string, string | undefined> = process.env): Endpoint {
  const [urlVar, keyVar] = spec.provider === 'anthropic' ? ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY'] : ['OPENAI_BASE_URL', 'OPENAI_API_KEY'];
  const baseUrl = env[urlVar] ?? '', token = env[keyVar] ?? '';
  if (!LOOPBACK.test(baseUrl + '/')) throw new JudgeError(urlVar + ' must be a metering proxy on the loopback (http://127.0.0.1:<port>/<slot>/' + spec.provider + '); a plan judge never calls a provider directly');
  if (!token) throw new JudgeError(keyVar + ' must hold the proxy slot token');
  return { baseUrl: baseUrl.replace(/\/+$/, ''), token };
}

export async function callOnce(spec: RoleSpec, input: PlanJudgeInput, ep: Endpoint): Promise<Omit<FullJudgement, 'attempts'>> {
  if (!LOOPBACK.test(ep.baseUrl + '/')) throw new JudgeError('the base URL must be a metering proxy on the loopback');
  const anthropic = spec.provider === 'anthropic';
  const headers: Record<string, string> = anthropic
    ? { 'content-type': 'application/json', 'x-api-key': ep.token, 'anthropic-version': '2023-06-01' }
    : { 'content-type': 'application/json', authorization: 'Bearer ' + ep.token };
  const res = await fetch(ep.baseUrl + (anthropic ? '/v1/messages' : '/v1/responses'), { method: 'POST', headers, body: JSON.stringify(requestBody(spec, input)) });
  const text = await res.text();
  if (!res.ok) {
    if (CAP_REFUSAL.test(text)) throw new CapStop('cap refusal (HTTP ' + res.status + '): ' + text.slice(0, 300));
    throw new JudgeError('HTTP ' + res.status + ': ' + text.slice(0, 300));
  }
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new JudgeError('the reply is not JSON'); }
  return readGrade(input, toolArguments(spec, json));
}

export async function judgeWith(spec: RoleSpec, input: PlanJudgeInput, ep: Endpoint, o: { retries?: number; delayMs?: number } = {}): Promise<FullJudgement> {
  if (!input.final_answer.trim()) return { named: [], named_count: 0, verdicts: Object.fromEntries(input.constraints.map((c) => [c.id, 'absent' as Verdict])), items: [], empty: true, attempts: 0 };
  const retries = o.retries ?? 3, delay = o.delayMs ?? 2000;
  const errors: string[] = [];
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try { return { ...(await callOnce(spec, input, ep)), attempts: attempt }; } catch (e) {
      if (e instanceof CapStop) throw e;
      errors.push((e as Error).message);
      if (attempt <= retries) await Bun.sleep(delay * 2 ** (attempt - 1));
    }
  }
  throw new JudgeError(roleId(spec) + ': the plan is still ungraded after ' + (retries + 1) + ' calls: ' + errors.join(' | '));
}

/** The edition-grade.ts --judge module for a role: endpoint from the environment, an optional private judgement log. */
export function makeJudge(spec: RoleSpec): PlanJudge {
  return {
    id: roleId(spec),
    async judge(input) {
      const j = await judgeWith(spec, input, endpointFromEnv(spec));
      const log = process.env.PLAN_JUDGE_LOG;
      if (log) appendFileSync(log, JSON.stringify({ judge: roleId(spec), plan_sha256: sha256(input.final_answer), constraints: input.constraints.map((c) => c.id), verdicts: j.verdicts, items: j.items.length, named: j.named, named_count: j.named_count, empty: j.empty, attempts: j.attempts }) + '\n');
      return j;
    },
  };
}
