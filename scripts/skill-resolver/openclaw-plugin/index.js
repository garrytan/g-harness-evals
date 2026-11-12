// harness-evals skill-resolver arm (internal-task): the OpenClaw lane of the hook wrapper. The adapter copies this plugin to
// $OPENCLAW_STATE_DIR/he-skill-resolver and replaces the two placeholder strings with JSON string literals: HOOK with the
// wrapper binary (/opt/skill-resolver/bin/he-skill-hook) and CONFIG with the wrapper's config file. before_prompt_build runs the
// wrapper, which resolves the turn and logs its status; in push mode (resolver-on) it prints the block and the plugin returns it
// as appendContext, in shadow mode (native) it prints nothing. Any failure adds nothing.
import { spawnSync } from 'node:child_process';
const HOOK = "__HE_SKILL_HOOK__";
const CONFIG = "__HE_SKILL_CONFIG__";
export default {
  id: "he-skill-resolver",
  name: "harness-evals skill resolver",
  description: "Runs the gbrain skill resolver each turn through the harness-evals hook wrapper (internal-task).",
  register(api) {
    api.on('before_prompt_build', (event) => {
      try {
        const r = spawnSync(HOOK, [CONFIG], { input: JSON.stringify({ hook: 'before_prompt_build', prompt: typeof event?.prompt === 'string' ? event.prompt : null }), encoding: 'utf8', timeout: 15000 });
        const block = r.status === 0 && typeof r.stdout === 'string' ? r.stdout : '';
        return block ? { appendContext: block } : undefined;
      } catch { return undefined; }
    });
  },
};
