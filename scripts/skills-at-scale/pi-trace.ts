#!/usr/bin/env bun
// The Pi trace fixture for got-skill's Pi parser (internal-task-a, internal-task-b, review F5): one real keyless Pi session on the
// skills-catalog arm in which the scripted fake model opens one catalog SKILL.md twice, first with Pi's read tool and then
// with bash cat. Keeps the captured request bodies (requests.ndjson, the fake's log with headers dropped), Pi's own session
// log (session.jsonl), the turn's JSON event stream (turn-0001.pi.jsonl) and meta.json under the fixture directory.
//
//   bun scripts/skills-at-scale/pi-trace.ts [--out tests/fixtures/skills-at-scale/pi-trace] [--work <dir>]
//
// The catalog is a 5-skill synthetic rung (scripts/skills-at-scale/synth-catalog.ts --sizes 5), so the fixture stays small.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildImages, buildKit } from './build-kit.ts';
import { runSession } from './session.ts';
import { writeLadder } from './synth-catalog.ts';

export const PI_TRACE_SKILL_ROOT = '/harness-state/pi/skills';
export const PI_TRACE_PROMPT = 'Write the hiring report for this week.';

async function main() {
  const a = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const out = resolve(v('--out') ?? 'tests/fixtures/skills-at-scale/pi-trace');
  const work = resolve(v('--work') ?? join(homedir(), '.capy/work/skills-at-scale/pi-trace'));
  rmSync(work, { recursive: true, force: true });
  writeLadder(join(work, 'ladder'), [5]);
  buildKit({ catalog: join(work, 'ladder', '5'), out: join(work, 'kit') });
  buildImages(join(work, 'kit'), ['pi'], 'pitrace');
  const skill = readdirSync(join(work, 'ladder', '5', 'skills')).sort()[0]!;
  const path = PI_TRACE_SKILL_ROOT + '/' + skill + '/SKILL.md';
  const s = await runSession({ harness: 'pi', config: 'skills-catalog', image: 'harness-eval/pi:sas-pitrace', turns: [PI_TRACE_PROMPT], dir: join(work, 'session'),
    script: [{ call: 'read', arguments: { path } }, { tool: 'cat ' + path }, { text: 'Done: read the ' + skill + ' skill twice.' }] });
  if (!s.trial) throw new Error('no trial directory; see ' + join(work, 'session', 'progress.log'));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const rows = readFileSync(join(work, 'session', 'fake.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  writeFileSync(join(out, 'requests.ndjson'), rows.map(({ headers: _h, authorization_sha256: _a, ...r }) => JSON.stringify(r)).join('\n') + '\n');
  const sessions = join(s.trial, 'state', 'pi', 'sessions');
  const log = existsSync(sessions) ? readdirSync(sessions).find((f) => f.endsWith('.jsonl')) : undefined;
  if (!log) throw new Error('no Pi session log under ' + sessions);
  copyFileSync(join(sessions, log), join(out, 'session.jsonl'));
  copyFileSync(join(s.trial, 'logs', 'turns', 'turn-0001.pi.jsonl'), join(out, 'turn-0001.pi.jsonl'));
  const pin = JSON.parse(readFileSync(resolve(import.meta.dir, '../../harnesses/pi/pin.json'), 'utf8')) as { version: string };
  writeFileSync(join(out, 'meta.json'), JSON.stringify({ what: 'one keyless Pi session (skills-catalog arm, 5 synthetic skills) in which the fake model reads one catalog SKILL.md with Pi\'s read tool, then with bash cat',
    pi_version: pin.version, skill, path, opens: [{ tool: 'read', arguments: { path } }, { tool: 'bash', arguments: { command: 'cat ' + path } }], termination: s.termination, requests: rows.length,
    made_by: 'bun scripts/skills-at-scale/pi-trace.ts' }, null, 1) + '\n');
  console.log('PI_TRACE ' + out + ' skill=' + skill + ' requests=' + rows.length + ' termination=' + s.termination);
}

if (import.meta.main) await main();
