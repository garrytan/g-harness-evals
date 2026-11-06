// internal-task: the answering model's defaults in the OpenClaw and Hermes adapter configs name the cell model. The golden
// tests that compare an adapter's output with an older commit (tests/openai-branch.test.ts, tests/instruction-route.test.ts)
// apply this one intended change to the older output before comparing, so any other difference still fails.
//
//   OpenClaw (config/openclaw.json): model.primary is anthropic/${HE_MODEL_NAME}, which OpenClaw resolves at load, so the
//   file keeps the reference. utilityModel stays unset, so housekeeping keeps OpenClaw's shipped default,
//   anthropic/claude-haiku-5-5 (internal-task, 2026-11-01).
//   Hermes (adapter.sh): model.default in the config copy is the cell model, the answering model, not a housekeeping model.
export const OPENCLAW_COMMENT_OLD = '// by adapter.sh so OpenClaw can write beside it if it wants to.\n';
export const OPENCLAW_COMMENT_NEW = OPENCLAW_COMMENT_OLD.slice(0, -1) + ' model.primary\n// is the cell model from HE_MODEL_NAME (internal-task-a). utilityModel is unset on\n// purpose: OpenClaw\'s housekeeping model stays its shipped default,\n// anthropic/claude-haiku-5-5 (internal-task-b, 2026-11-01).\n';

function replaceOnce(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error('model-defaults: the older config has no ' + JSON.stringify(from));
  return text.replace(from, to);
}

/** The older config text with the internal-task change applied: OpenClaw's Anthropic template (or OpenClaw's JSON rewrite of it), or a Hermes config copy for a cell on <model>. */
export function withCellModelDefaults(harness: 'openclaw' | 'hermes', text: string, model: string): string {
  if (harness === 'hermes') {
    const m = text.match(/^ {2}default: ".*"\n/m);
    if (!m) throw new Error('model-defaults: the Hermes config has no model.default line');
    return text.replace(m[0], `  default: "${model}"\n`);
  }
  if (text.startsWith('//')) {
    const c = replaceOnce(text, OPENCLAW_COMMENT_OLD, OPENCLAW_COMMENT_NEW);
    return replaceOnce(c, '      model: { primary: "anthropic/claude-sonnet-5-5" },\n', '      model: { primary: "anthropic/${HE_MODEL_NAME}" },\n');
  }
  return replaceOnce(text, '"primary": "anthropic/claude-sonnet-5-5"\n      },\n', '"primary": "anthropic/${HE_MODEL_NAME}"\n      },\n');
}
