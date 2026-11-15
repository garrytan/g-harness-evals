// harness-evals delivery arm (HARN-61), the hook and placebo arms on Pi 1.5.0: a global extension (auto-discovered in
// $PI_CODING_AGENT_DIR/extensions) on the context event, which Pi fires before each LLM call with a deep copy of the
// messages (dist/core/extensions/types.d.ts:691-701). It appends /tmp/he-delivery/card.md as a text block to the last
// message (the prompt on request 1, the newest tool result on a follow-up), so every request carries one fresh copy and Pi's
// history keeps none. The --he-steps-card flag does nothing; pi --help lists it only when this extension loaded, which is the
// before-ready check. One line per request goes to /logs/agent/he-delivery-fires.jsonl.
import { appendFileSync, readFileSync } from 'node:fs';
const CARD = '/tmp/he-delivery/card.md';
const FIRES = '/logs/agent/he-delivery-fires.jsonl';
export default function (pi) {
  pi.registerFlag('he-steps-card', { description: 'harness-evals delivery arm marker (no effect)', type: 'boolean' });
  pi.on('context', async (event) => {
    const messages = event.messages;
    const last = messages[messages.length - 1];
    if (!last || !['user', 'toolResult'].includes(last.role)) return undefined;
    const text = readFileSync(CARD, 'utf8');
    if (typeof last.content === 'string') last.content = [{ type: 'text', text: last.content }, { type: 'text', text }];
    else if (Array.isArray(last.content)) last.content.push({ type: 'text', text });
    else return undefined;
    try { appendFileSync(FIRES, JSON.stringify({ at: Date.now() / 1000, event: 'context', role: last.role, bytes: Buffer.byteLength(text) }) + '\n'); } catch {}
    return { messages };
  });
}
