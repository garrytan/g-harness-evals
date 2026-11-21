// harness-evals rules-at-scale hook arm on OpenClaw: before_prompt_build returns /tmp/he-rules/hooktext.md as
// appendContext, so the turn's prompt carries one copy of the six planted rules after the task message. Nothing is added
// to tool results (the earlier delivery plugin in scripts/frontier-harbor/delivery/openclaw-plugin also did that; this arm wants
// one copy). One line per firing goes to /logs/agent/he-rules-fires.jsonl.
import { appendFileSync, readFileSync } from 'node:fs';
const TEXT = '/tmp/he-rules/hooktext.md';
const FIRES = '/logs/agent/he-rules-fires.jsonl';
export default {
  id: 'he-rules-hook',
  name: 'harness-evals rules hook',
  description: 'harness-evals rules-at-scale hook arm: the planted rules once, after the task message.',
  register(api) {
    api.on('before_prompt_build', () => {
      const text = readFileSync(TEXT, 'utf8');
      try { appendFileSync(FIRES, JSON.stringify({ at: Date.now() / 1000, event: 'before_prompt_build', bytes: Buffer.byteLength(text) }) + '\n'); } catch {}
      return { appendContext: text };
    });
  },
};
