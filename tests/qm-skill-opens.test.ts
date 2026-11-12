// internal-task "Got the skill" on QM (harnesses/qm/skill-opens.ts), keyless, on fixture traces under
// tests/fixtures/qm-skill-opens/: trimmed captures from the QM arms capture check (the fake model reads careful with
// skills action read; scripts/skill-resolver/step0/qm/arms/qm-arms-check.ts, cells qm-arm-<provider>-native and
// qm-arm-anthropic-none) and one hand-made session covering a files read of a synced SKILL.md, an execute cat, a failed
// execute read, a non-catalog skill, a missing skill, and calls that are not opens.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { skillOpens, requestCalls, traceCalls } from '../harnesses/qm/skill-opens.ts';

const DIR = join(resolve(import.meta.dir), 'fixtures', 'qm-skill-opens');
const json = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const ndjson = (f: string) => readFileSync(join(DIR, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
// The catalog names the fixtures touch, as in ~/.capy/work/internal-task/catalog (browse is QM's own, not in the catalog).
const CATALOG = ['careful', 'review', 'qa', 'ship', 'freeze', 'learn'];

describe('captured requests and the stored trace, both providers', () => {
  for (const provider of ['anthropic', 'openai']) {
    test(provider + ': the skills read of careful is one open, from the requests and from the trace', () => {
      const requests = ndjson(provider + '-requests.ndjson');
      const session = json(provider + '-session.json');
      expect(skillOpens({ catalog: CATALOG, requests }).opened).toEqual(['careful']);
      expect(skillOpens({ catalog: CATALOG, session }).opened).toEqual(['careful']);
      const both = skillOpens({ catalog: CATALOG, requests, session });
      expect(both.opened).toEqual(['careful']);
      expect(both.opens.map((o) => [o.source, o.via, o.skill])).toEqual([['request', 'skills', 'careful'], ['trace', 'skills', 'careful']]);
      expect(requestCalls(requests.at(-1)!).filter((c) => c.tool === 'skills')).toHaveLength(1);
    });
  }

  test('no-catalog: the same read is answered "no such skill file", so nothing is opened', () => {
    const r = skillOpens({ catalog: CATALOG, requests: ndjson('none-requests.ndjson'), session: json('none-session.json') });
    expect(r.opened).toEqual([]);
    expect(r.refused.map((o) => [o.source, o.skill, o.found])).toEqual([['request', 'careful', false], ['trace', 'careful', false]]);
  });
});

describe('the hand-made session', () => {
  const r = skillOpens({ catalog: CATALOG, session: json('session-synthetic.json') });
  test('opens: a files read of the synced SKILL.md and an execute cat that exited 0', () => {
    expect(r.opened).toEqual(['careful', 'review']);
    expect(r.opens.map((o) => [o.via, o.skill])).toEqual([['files', 'careful'], ['execute', 'review']]);
  });
  test('not opens: a failed read, a missing skill, ls of a SKILL.md, a non-SKILL file; a non-catalog skill is listed apart', () => {
    expect(r.refused.map((o) => [o.via, o.skill])).toEqual([['execute', 'qa'], ['skills', 'no-such-skill']]);
    expect(r.other.map((o) => [o.via, o.skill])).toEqual([['skills', 'browse']]);
    expect(r.opens.some((o) => o.skill === 'ship')).toBe(false);
  });
  test('the trace reader keeps every tool call with its answer', () => {
    expect(traceCalls(json('session-synthetic.json')).map((c) => [c.tool, c.code])).toEqual([['files', null], ['execute', 0], ['execute', 1], ['skills', null], ['skills', null], ['files', null], ['execute', 0]]);
  });
});
