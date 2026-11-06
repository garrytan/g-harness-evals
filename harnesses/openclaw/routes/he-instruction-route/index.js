// harness-evals hook routes (HARN-15, HARN-18). The adapter copies this plugin to $OPENCLAW_STATE_DIR/he-instruction-route and
// replaces the two placeholder strings with JSON string literals: TEXT with the route's bytes (/opt/harness/routes/instruction.md,
// or routes/placebo.md on route-placebo) and FLAG with the path of the emit flag the adapter writes before every member turn
// (docs/adapters.md, "Emit flag"). The hook keeps no state: it prepends TEXT when the flag reads emit=1 and adds nothing otherwise.
import { readFileSync } from 'node:fs';
const TEXT = "__HE_INSTRUCTION__";
const FLAG = "__HE_EMIT_FLAG__";
const emit = () => { try { return readFileSync(FLAG, 'utf8').trim() === 'emit=1'; } catch { return false; } };
export default {
  id: "he-instruction-route",
  name: "harness-evals instruction route",
  description: "Puts the route's text next to a user turn when the adapter's emit flag says so (harness-evals hook routes).",
  register(api) {
    api.on('before_prompt_build', () => (emit() ? { prependContext: TEXT } : undefined));
  },
};
