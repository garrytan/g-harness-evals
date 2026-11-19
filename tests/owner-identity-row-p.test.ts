// Row P (owner identity, gbrain alone): the gbrain commands one import task runs, and the files it stages. Keyless: no docker,
// no model call; the metered route itself is covered by tests/gbrain-llm-route.test.ts.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { importFiles, P_MODELS, taskSteps, TRANSCRIPT_FORMATS } from '../scripts/owner-identity/row-p.ts';
import type { World } from '../world/types.ts';

const SET = resolve(import.meta.dir, '..', 'tasks', 'multiuser', 'owner-identity');
const world = JSON.parse(readFileSync(join(SET, 'world', 'world.json'), 'utf8')) as World;
const people = JSON.parse(readFileSync(join(SET, 'world', 'people.json'), 'utf8')) as { owner: string };
const owner = world.members.find((m) => m.id === people.owner)!;

test('a task registers the owner before any import, and the opus row pins extraction before the files', () => {
  const files = [{ file: 'a.jsonl', format: 'claude-code-session-jsonl' }, { file: 'Me.txt', format: 'imessage-slack' }];
  const shipped = taskSteps({ task: 'oi-01-import', owner, pin: P_MODELS.shipped.pin, files });
  expect(shipped.map((s) => s.label)).toEqual(['people', 'owner-member', 'owner-set', 'file-1-ingest', 'file-2-capture', 'file-2-extract']);
  expect(shipped[2]!.args).toEqual(['access', 'owner', 'set', owner.id, '--json']);
  expect(shipped[3]!.args).toEqual(['transcripts', 'ingest', '/imports/a.jsonl', '--format', 'claude-code', '--facts', '--json']);
  expect(shipped[4]!.args).toEqual(['capture', '--file', '/imports/Me.txt', '--type', 'conversation', '--slug', 'imports/oi-01-import/me-txt', '--json']);
  expect(shipped[5]!.args).toEqual(['extract-conversation-facts', '--slug', 'imports/oi-01-import/me-txt', '--workers', '1', '--json']);
  const opus = taskSteps({ task: 'oi-01-import', owner, pin: P_MODELS.opus.pin, files });
  expect(opus.map((s) => s.label).slice(0, 4)).toEqual(['people', 'owner-member', 'owner-set', 'pin']);
  expect(opus[3]!.args).toEqual(['config', 'set', 'facts.extraction_model', 'anthropic:claude-opus-5-5']);
});

test('every import file of the dev bank is staged from world.json, and every agent-session format has a transcripts reader', () => {
  for (const task of ['oi-01-import', 'oi-02-import', 'oi-03-import', 'oi-04-import', 'oi-05-import', 'oi-06-import', 'oi-07-import', 'oi-08-import']) {
    const gold = JSON.parse(readFileSync(join(SET, 'dev', task, 'gold.json'), 'utf8')) as { source: string; formats: Array<{ file: string; format: string; format_known_to_gbrain: boolean }> };
    const staged = importFiles(world, owner.id, task);
    expect(staged.map((f) => f.file).sort()).toEqual(gold.formats.map((f) => f.file).sort());
    for (const f of staged) expect(f.body.length).toBeGreaterThan(0);
    if (gold.source === 'agent-session') for (const f of gold.formats.filter((x) => x.format_known_to_gbrain)) expect(TRANSCRIPT_FORMATS[f.format]).toBeDefined();
  }
});
