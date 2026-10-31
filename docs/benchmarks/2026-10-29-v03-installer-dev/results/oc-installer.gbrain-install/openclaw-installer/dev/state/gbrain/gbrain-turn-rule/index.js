// Managed by gbrain setup openclaw; a re-run rewrites this file. Remove: gbrain setup openclaw --remove
const RULE = "GBrain: before answering this turn, check GBrain first (`search` or `query` on the `gbrain` MCP server) for the people, companies, projects, meetings and decisions it touches. Results span every source it holds: use only what the current requester may see. Then answer and finish the task.";
export default {
  id: "gbrain-turn-rule",
  name: 'GBrain turn rule',
  description: "Puts the GBrain brain-first rule next to every user turn (managed by gbrain setup openclaw).",
  register(api) {
    api.on('before_prompt_build', () => ({ prependContext: RULE }));
  },
};
