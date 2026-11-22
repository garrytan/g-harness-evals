// The key QM's own Slack surface drops a repeated inbound message on, before any turn starts: channel:ts
// (dedupeKey, src/slack/message-gating.ts:171-174 at 77024e79; the event handlers call it, src/slack/events.ts:141
// and :150, and dedupedRun skips a key it has seen, message-gating.ts:190-196). A Slack redelivery of the same event
// keeps its channel and ts, so it has the same key; a new message has a new ts, so it is a new turn even when its text
// repeats. A timer turn is not a Slack event, so it has no key.
//
//   node slack-event-key.mjs <turn.request.json>   prints the key, or - when the turn has none
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function slackEventKey(req) {
  if (req.kind === 'timer') return null;
  const channel = req.channel?.id;
  return channel && req.ts ? `${channel}:${req.ts}` : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write((slackEventKey(JSON.parse(readFileSync(process.argv[2], 'utf8'))) ?? '-') + '\n');
}
