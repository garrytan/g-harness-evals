// The QM adapter drops a Slack redelivery the way QM's own Slack surface does: same channel and ts, the key
// src/slack/message-gating.ts:171-174 dedupes on at 77024e79. A new message is a new turn even when its text repeats.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slackEventKey } from '../harnesses/qm/slack-event-key.mjs';

const ROOT = join(import.meta.dir, '..');
const first = { turn: 5, actor: { member: 'dana-okafor', slack_user_id: 'U2Q88O0N6PU' }, channel: { id: 'C16V9M1OB60', name: 'north-team', type: 'channel' }, text: '@assistant on what date did Orrin Mills move over to Marcus?', ts: '1791993600.000134', thread_ts: null };

describe('QM Slack event key', () => {
  test('a redelivery of the same message has the same key', () => {
    expect(slackEventKey(first)).toBe('C16V9M1OB60:1791993600.000134');
    expect(slackEventKey({ ...first, turn: 6, retry_attempt: 1 })).toBe(slackEventKey(first));
  });
  test('a new message with the same text is a new key', () => {
    expect(slackEventKey({ ...first, turn: 9, ts: '1792072800.000138' })).not.toBe(slackEventKey(first));
  });
  test('the same ts in another channel is a new key', () => {
    expect(slackEventKey({ ...first, channel: { id: 'DALWAYS0004', name: 'dm:dana-okafor', type: 'dm' } })).not.toBe(slackEventKey(first));
  });
  test('a timer turn has no key, so it is never dropped', () => {
    expect(slackEventKey({ ...first, kind: 'timer', timer: { id: 't1' } })).toBeNull();
  });
  test('the command the adapter runs prints the key, or - for a timer turn', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qm-event-key-'));
    const run = (req: object) => {
      writeFileSync(join(dir, 'req.json'), JSON.stringify(req));
      return spawnSync('node', [join(ROOT, 'harnesses/qm/slack-event-key.mjs'), join(dir, 'req.json')], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } }).stdout.trim();
    };
    expect(run(first)).toBe('C16V9M1OB60:1791993600.000134');
    expect(run({ ...first, kind: 'timer' })).toBe('-');
  });
  test('the adapter drops a seen key with no reply and the image carries the helper', () => {
    const adapter = readFileSync(join(ROOT, 'harnesses/qm/adapter.sh'), 'utf8');
    expect(adapter).toContain('event_key=$(node /opt/harness/slack-event-key.mjs "$req")');
    expect(adapter).toContain('dropped: Slack redelivery of $event_key');
    expect(adapter).toContain('unset "seen_events[$event_key]"');
    expect(readFileSync(join(ROOT, 'harnesses/qm/Dockerfile'), 'utf8')).toMatch(/COPY adapter\.sh .*slack-event-key\.mjs .*\/opt\/harness\//);
  });
});
