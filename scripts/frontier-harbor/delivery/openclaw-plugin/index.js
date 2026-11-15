// harness-evals delivery arm (HARN-61), the hook and placebo arms on OpenClaw 2026.10.6. Two registrations carry
// /tmp/he-delivery/card.md to the model: before_prompt_build returns it as prependContext, so the turn's first request has
// it in the user message, and agent tool-result middleware appends it to every tool result before OpenClaw feeds the result
// back to the model, so each tool follow-up request has a fresh copy after the newest tool output. One line per firing goes
// to /logs/agent/he-delivery-fires.jsonl.
import { appendFileSync, readFileSync } from 'node:fs';
const CARD = '/tmp/he-delivery/card.md';
const FIRES = '/logs/agent/he-delivery-fires.jsonl';
const card = () => readFileSync(CARD, 'utf8');
const fire = (event, extra) => { try { appendFileSync(FIRES, JSON.stringify({ at: Date.now() / 1000, event, ...extra }) + '\n'); } catch {} };
export default {
  id: 'he-steps-card',
  name: 'harness-evals steps card',
  description: 'harness-evals delivery arm (HARN-61): the steps card before the first request and after every tool result.',
  register(api) {
    api.on('before_prompt_build', () => {
      const text = card();
      fire('before_prompt_build', { bytes: Buffer.byteLength(text) });
      return { prependContext: text };
    });
    api.registerAgentToolResultMiddleware(async (event) => {
      const text = card();
      fire('tool_result', { tool: event.toolName, bytes: Buffer.byteLength(text) });
      const result = event.result ?? { content: [], details: {} };
      return { result: { ...result, content: [...(Array.isArray(result.content) ? result.content : []), { type: 'text', text }] } };
    }, { runtimes: ['openclaw'] });
  },
};
