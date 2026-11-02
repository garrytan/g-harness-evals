// internal-task: Hermes's config templates set agent.image_input_mode to text (harnesses/hermes/config/), so the browser_exec
// description no longer follows a models.dev lookup. Tests that compare a Hermes config with one written before that change
// apply this to the older config first.
const NOTE = `# Screenshots off the model's own vision (internal-task): text keeps Hermes from asking
# models.dev whether the model can see images, which otherwise sets the
# browser_exec description's header from the network (the vision header when
# models.dev answers, the text-only one when egress is refused), so the prompt
# would change with egress and within a run. Read by agent/image_routing.py
# decide_image_input_mode at v2026.9.24; every Hermes cell gets it.
`;
const OPENAI_AGENT = 'agent:\n  reasoning_effort: "medium"\n';
const DISPLAY = 'display:\n  streaming: false\n';

/** The Hermes config as the templates now leave it: the note and image_input_mode under the OpenAI template's agent: key,
 *  or a new agent: block before display: in the Anthropic template. */
export function withTextImageMode(config: string): string {
  if (config.includes(OPENAI_AGENT)) return config.replace(OPENAI_AGENT, NOTE + OPENAI_AGENT + '  image_input_mode: "text"\n');
  if (!config.includes(DISPLAY)) throw new Error('withTextImageMode: neither template shape found');
  return config.replace(DISPLAY, NOTE + 'agent:\n  image_input_mode: "text"\n\n' + DISPLAY);
}
