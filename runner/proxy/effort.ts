/**
 * Reasoning effort on the metering proxy's usage lines (internal-task). Record only: the proxy never refuses or rewrites a
 * request for its effort, so the fields a line records are the fields that went to the provider.
 */
import type { UsageLine } from './metering-proxy.ts';

/** The values a usage line records verbatim. Any other value is never logged, since it could be a private marker; the line
 *  names the field in `unrecognized_effort_fields` instead. `ultra` is a gpt-6-astra effort (harnesses/ablation/coding/items.json). */
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export const THINKING_TYPES = ['enabled', 'disabled', 'adaptive'] as const;
/** Gemini's `generationConfig.thinkingConfig.thinkingLevel` values (ai.google.dev/gemini-api/docs/thinking), recorded lower-case. */
export const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;

export type EffortFields = Pick<UsageLine, 'reasoning_effort' | 'output_config_effort' | 'thinking_type' | 'thinking_budget_tokens' | 'thinking_level' | 'unrecognized_effort_fields'>;

/**
 * The effort fields a request sets, each in its own field: OpenAI Responses `reasoning.effort` or Chat Completions
 * `reasoning_effort` (both as reasoning_effort; the route tells them apart), Anthropic `output_config.effort` (how Claude
 * Code sends effort), `thinking.type` and `thinking.budget_tokens`, and Gemini `generationConfig.thinkingConfig` (or the REST
 * snake_case spelling): `thinkingLevel` as thinking_level, in any case, and `thinkingBudget` as thinking_budget_tokens. A
 * field set to a value outside the known values is named by its request path in unrecognized_effort_fields and its value
 * is dropped.
 */
export function effortFields(body: Record<string, any> | undefined): EffortFields {
  if (!body) return {};
  const unrecognized: string[] = [];
  const pick = (path: string, value: unknown, values: readonly string[]) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string' && values.includes(value)) return value;
    unrecognized.push(path);
    return undefined;
  };
  const effort = pick('reasoning.effort', body.reasoning?.effort, REASONING_EFFORTS) ?? pick('reasoning_effort', body.reasoning_effort, REASONING_EFFORTS);
  const configEffort = pick('output_config.effort', body.output_config?.effort, REASONING_EFFORTS);
  const thinking = pick('thinking.type', body.thinking?.type, THINKING_TYPES);
  const budget = body.thinking?.budget_tokens;
  const budgetOk = Number.isSafeInteger(budget) && budget >= 0;
  if (!budgetOk && budget !== undefined && budget !== null) unrecognized.push('thinking.budget_tokens');
  const [genKey, gen] = spelled(body, 'generationConfig', 'generation_config');
  const [tcKey, tc] = spelled(gen, 'thinkingConfig', 'thinking_config');
  const [levelKey, rawLevel] = spelled(tc, 'thinkingLevel', 'thinking_level');
  const [geminiBudgetKey, geminiBudget] = spelled(tc, 'thinkingBudget', 'thinking_budget');
  const level = pick(`${genKey}.${tcKey}.${levelKey}`, typeof rawLevel === 'string' ? rawLevel.toLowerCase() : rawLevel, THINKING_LEVELS);
  const geminiBudgetOk = Number.isSafeInteger(geminiBudget) && geminiBudget >= 0;
  if (!geminiBudgetOk && geminiBudget !== undefined && geminiBudget !== null) unrecognized.push(`${genKey}.${tcKey}.${geminiBudgetKey}`);
  return {
    ...(effort !== undefined ? { reasoning_effort: effort } : {}),
    ...(configEffort !== undefined ? { output_config_effort: configEffort } : {}),
    ...(thinking !== undefined ? { thinking_type: thinking } : {}),
    ...(budgetOk ? { thinking_budget_tokens: budget as number } : geminiBudgetOk ? { thinking_budget_tokens: geminiBudget as number } : {}),
    ...(level !== undefined ? { thinking_level: level } : {}),
    ...(unrecognized.length ? { unrecognized_effort_fields: unrecognized } : {}),
  };
}

/** A key of a request object under its camelCase name, else its REST snake_case one, with its value. */
function spelled(o: unknown, camel: string, snake: string): [string, any] {
  const obj = o && typeof o === 'object' && !Array.isArray(o) ? o as Record<string, unknown> : {};
  return obj[camel] !== undefined ? [camel, obj[camel]] : [snake, obj[snake]];
}

const SIGNATURE_FIELDS = ['reasoning_effort', 'output_config_effort', 'thinking_type', 'thinking_budget_tokens', 'thinking_level'] as const;

/**
 * Calls per effort setting, for a trial's efforts_requested: one key per combination of a line's effort fields, written
 * `field=value` in a fixed order and joined by spaces (`output_config_effort=high thinking_type=adaptive`), an unrecognized
 * field as `<request path>=unrecognized`, and `none` for a call that set no effort field. Only calls that went to the
 * provider count (forwarded and failed lines); refusals and free count_tokens calls do not. The caller picks the lines
 * (one trial's key, housekeeping calls in or out).
 */
export function effortCounts(lines: ReadonlyArray<Partial<UsageLine>>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of lines) {
    if ((line.outcome !== 'forwarded' && line.outcome !== 'failed') || line.route?.endsWith('/count_tokens')) continue;
    const parts = SIGNATURE_FIELDS.filter((f) => line[f] !== undefined).map((f) => `${f}=${line[f]}`);
    for (const path of line.unrecognized_effort_fields ?? []) parts.push(`${path}=unrecognized`);
    const key = parts.join(' ') || 'none';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
