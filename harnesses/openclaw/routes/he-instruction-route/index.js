// harness-evals route-hook (internal-task). The adapter copies this plugin to $OPENCLAW_STATE_DIR/he-instruction-route and
// replaces the placeholder string with the bytes of /opt/harness/routes/instruction.md as a JSON string literal.
const RULE = "__HE_INSTRUCTION__";
export default {
  id: "he-instruction-route",
  name: "harness-evals instruction route",
  description: "Puts the instruction next to every user turn (harness-evals HE_HARNESS_CONFIG=route-hook).",
  register(api) {
    api.on('before_prompt_build', () => ({ prependContext: RULE }));
  },
};
