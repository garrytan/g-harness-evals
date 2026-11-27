// internal-task arm N (owner-identity, no gbrain): the bot's notes store. world-MCP's notes tools (notes_list, notes_read, notes_write)
// keep one <person id>.md file per person under the trial directory, seeded with the people pages the gbrain arms import
// (tasks/multiuser/owner-identity/corpus/dev/people). Only the bot reads or writes it, and only inside its directory; every call is
// a world event. The runner dumps it into owner-identity/store.json after the fence and grades it as it grades a gbrain store.
// Keyless: the real in-process world over HTTP, the official MCP client, a scripted trial; no model, no docker, no key.

import { afterAll, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { dumpNotesStore, type NotesStore } from '../runner/grade/owner-identity-store.ts';
import { gradeOwnerIdentity, namesOf, type Gold, type People } from '../runner/grade/owner-identity.ts';
import { loadPrereg, type Cell, type Prereg } from '../runner/run.ts';
import { runTrial } from '../runner/trial/trial.ts';
import { TrialWorld } from '../runner/trial/world.ts';
import type { Script } from '../runner/contracts.ts';
import { createWorldServer, type WorldServer } from '../world/services/server.ts';
import { NOTE_MAX_BYTES, readNotesSeed } from '../world/services/notes.ts';
import { loadWorld, WorldError } from '../world/services/world.ts';
import { WORLD_MCP_NOTES_TOOLS, WORLD_MCP_TOOLS } from '../world/world-mcp/tools.ts';
import { tokenOf } from './world-helpers.ts';

const ROOT = resolve(import.meta.dir, '..');
const SET = join(ROOT, 'tasks', 'multiuser', 'owner-identity');
const WORLD_PATH = join(SET, 'world', 'world.json');
const PAGES = join(SET, 'corpus', 'dev', 'people');
const PREAMBLE = join(ROOT, 'tasks', 'multiuser', '_shared', 'preamble.owner-identity.md');
const oiWorld = loadWorld(WORLD_PATH);
const people = JSON.parse(readFileSync(join(SET, 'world', 'people.json'), 'utf8')) as People;
const OWNER = people.owner;
const gold = (task: string) => JSON.parse(readFileSync(join(SET, 'dev', task, 'gold.json'), 'utf8')) as Gold;
const TASKS = readdirSync(join(SET, 'dev')).filter((d) => existsSync(join(SET, 'dev', d, 'gold.json'))).sort();

const tmp = mkdtempSync(join(tmpdir(), 'he-oi-notes-'));
const servers: WorldServer[] = [];
const clients: Client[] = [];
afterAll(async () => {
  for (const c of clients) await c.close().catch(() => undefined);
  for (const s of servers) s.stop();
  rmSync(tmp, { recursive: true, force: true });
});

function start(name: string, notes = true): { ws: WorldServer; dir: string } {
  const dir = join(tmp, name, 'owner-identity', 'notes');
  const ws = createWorldServer({ world: oiWorld, split: 'dev', trialId: name, eventsPath: null, ...(notes ? { notes: { dir, seed: readNotesSeed(WORLD_PATH, 'dev') } } : {}) });
  servers.push(ws);
  return { ws, dir };
}

async function connect(ws: WorldServer, token: string): Promise<Client> {
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${ws.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  clients.push(c);
  return c;
}

const body = (r: Awaited<ReturnType<Client['callTool']>>): any => JSON.parse((r.content as Array<{ text: string }>)[0]!.text);
const files = (dir: string) => readdirSync(dir).sort();
/** Every path under a directory, relative to it. */
const tree = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).sort();

describe('the seed', () => {
  test('one file per person id, holding that person\'s people page as the gbrain arms import it; the decoy page keeps its own name', () => {
    const seed = readNotesSeed(WORLD_PATH, 'dev');
    const pages = readdirSync(PAGES).filter((f) => f.endsWith('.md')).sort();
    expect(Object.keys(seed).length).toBe(pages.length);
    for (const p of people.people) expect(seed[p.id]).toBe(readFileSync(join(PAGES, `${basename(p.page_slug)}.md`), 'utf8'));
    const decoys = Object.keys(seed).filter((id) => !people.people.some((p) => p.id === id));
    expect(decoys).toEqual(['chloe-norbury-2']);
    expect(seed[OWNER]).toContain('# Chloe Norbury');
  });

  test('the world writes the seed into its directory and logs one admin event', () => {
    const { ws, dir } = start('seed');
    expect(files(dir)).toEqual(Object.keys(readNotesSeed(WORLD_PATH, 'dev')).map((id) => `${id}.md`).sort());
    const ev = ws.log.events.find((e) => e.tool === 'admin.notes_seed')!;
    expect(ev).toMatchObject({ actor: null, via: 'admin', kind: 'admin', outcome: 'ok', effect: { files: files(dir).length } });
  });

  test('a set with no people pages has no seed', () => {
    expect(() => readNotesSeed(join(ROOT, 'world', 'seed', 'world.json'), 'dev')).toThrow(/no people pages/);
  });
});

describe('the notes tools over world-MCP', () => {
  test('the bot gets the three notes tools beside the world tools; members, and a world without notes, do not', async () => {
    const { ws } = start('tools');
    const bot = await connect(ws, ws.credentials.bot.token);
    expect((await bot.listTools()).tools.map((t) => t.name).sort()).toEqual([...WORLD_MCP_TOOLS, ...WORLD_MCP_NOTES_TOOLS].sort());
    const owner = await connect(ws, tokenOf(ws, OWNER));
    expect((await owner.listTools()).tools.map((t) => t.name).sort()).toEqual([...WORLD_MCP_TOOLS].sort());
    const plain = start('tools-off', false).ws;
    const plainBot = await connect(plain, plain.credentials.bot.token);
    expect((await plainBot.listTools()).tools.map((t) => t.name).sort()).toEqual([...WORLD_MCP_TOOLS].sort());
  });

  test('list, read, replace, append and a new person file, each a world event', async () => {
    const { ws, dir } = start('rw');
    const bot = await connect(ws, ws.credentials.bot.token);
    const listed = body(await bot.callTool({ name: 'notes_list', arguments: {} }));
    expect(listed.map((n: { person: string }) => n.person)).toEqual(files(dir).map((f) => f.slice(0, -3)));
    const seeded = readFileSync(join(dir, 'ada-jormere.md'), 'utf8');
    expect(listed.find((n: { person: string }) => n.person === 'ada-jormere').bytes).toBe(Buffer.byteLength(seeded));
    expect(body(await bot.callTool({ name: 'notes_read', arguments: { person: 'ada-jormere' } }))).toEqual({ person: 'ada-jormere', text: seeded });

    const appended = body(await bot.callTool({ name: 'notes_write', arguments: { person: 'ada-jormere', text: '- Ada swims at Quorvel Lido.', append: true } }));
    const after = `${seeded}${seeded.endsWith('\n') ? '' : '\n'}- Ada swims at Quorvel Lido.`;
    expect(appended).toEqual({ person: 'ada-jormere', bytes: Buffer.byteLength(after), created: false });
    expect(readFileSync(join(dir, 'ada-jormere.md'), 'utf8')).toBe(after);
    await bot.callTool({ name: 'notes_write', arguments: { person: 'ada-jormere', text: '# Ada\n- replaced\n' } });
    expect(readFileSync(join(dir, 'ada-jormere.md'), 'utf8')).toBe('# Ada\n- replaced\n');
    expect(body(await bot.callTool({ name: 'notes_write', arguments: { person: 'new-friend', text: '- met at the pottery class' } }))).toMatchObject({ created: true });
    expect(files(dir)).toContain('new-friend.md');

    const missing = await bot.callTool({ name: 'notes_read', arguments: { person: 'nobody-here' } });
    expect(missing.isError).toBe(true);
    expect(body(missing)).toMatchObject({ error: 'note_not_found' });

    const notes = ws.log.events.filter((e) => e.tool.startsWith('notes.'));
    expect(notes.map((e) => [e.tool, e.kind, e.outcome])).toEqual([
      ['notes.list', 'read', 'ok'], ['notes.read', 'read', 'ok'], ['notes.write', 'write', 'ok'], ['notes.write', 'write', 'ok'], ['notes.write', 'write', 'ok'], ['notes.read', 'deny', 'denied'],
    ]);
    const firstWrite = notes.find((e) => e.tool === 'notes.write')!;
    expect(firstWrite).toMatchObject({ actor: ws.service.bot!.id, via: 'mcp', args: { person: 'ada-jormere', text: '- Ada swims at Quorvel Lido.', append: true }, effect: { file: 'ada-jormere.md', created: false, append: true } });
  });
});

describe('permissions: only the bot, only its notes directory', () => {
  test('a member is refused on every notes call, and the refusal is logged', () => {
    const { ws, dir } = start('member');
    const owner = ws.service.requireMember(OWNER);
    const before = tree(dir);
    for (const call of [() => ws.service.notesList(owner, 'mcp'), () => ws.service.notesRead(owner, 'mcp', OWNER), () => ws.service.notesWrite(owner, 'mcp', { person: OWNER, text: 'x' })]) {
      expect(call).toThrow(WorldError);
    }
    expect(ws.log.events.filter((e) => e.tool.startsWith('notes.')).map((e) => [e.actor, e.outcome, e.error])).toEqual([[OWNER, 'denied', 'forbidden'], [OWNER, 'denied', 'forbidden'], [OWNER, 'denied', 'forbidden']]);
    expect(tree(dir)).toEqual(before);
  });

  test('a person id that is not a plain id writes nothing anywhere', async () => {
    const { ws, dir } = start('paths');
    const bot = await connect(ws, ws.credentials.bot.token);
    const trialRoot = join(dir, '..', '..');
    const before = tree(trialRoot);
    for (const person of ['../escape', '../../escape', 'people/chloe-norbury', 'Chloe', '.hidden', '-lead', 'a b', 'x'.repeat(65), '/abs', 'chloe-norbury.md', '']) {
      const r = await bot.callTool({ name: 'notes_write', arguments: { person, text: 'planted' } });
      expect(r.isError).toBe(true);
      if (person) expect(body(r)).toMatchObject({ error: 'bad_person' });
      expect((await bot.callTool({ name: 'notes_read', arguments: { person } })).isError).toBe(true);
    }
    expect(tree(trialRoot)).toEqual(before);
    expect(existsSync(join(tmp, 'escape.md'))).toBe(false);
  });

  test('a write that would pass the size cap is refused and leaves the file as it was', async () => {
    const { ws, dir } = start('big');
    const bot = await connect(ws, ws.credentials.bot.token);
    const was = readFileSync(join(dir, `${OWNER}.md`), 'utf8');
    const r = await bot.callTool({ name: 'notes_write', arguments: { person: OWNER, text: 'x'.repeat(NOTE_MAX_BYTES), append: true } });
    expect(body(r)).toMatchObject({ error: 'too_large' });
    expect(readFileSync(join(dir, `${OWNER}.md`), 'utf8')).toBe(was);
  });

  test('after the fence every notes write is refused; reads still answer', async () => {
    const { ws, dir } = start('fence');
    const bot = await connect(ws, ws.credentials.bot.token);
    ws.service.fence();
    const before = tree(dir);
    expect(body(await bot.callTool({ name: 'notes_write', arguments: { person: OWNER, text: 'late' } }))).toMatchObject({ error: 'fenced' });
    expect((await bot.callTool({ name: 'notes_read', arguments: { person: OWNER } })).isError).toBeFalsy();
    expect(tree(dir)).toEqual(before);
  });

  test('notes writes change no other world state: files, messages, calendar, mail and the write events are untouched', async () => {
    const { ws } = start('isolated');
    const bot = await connect(ws, ws.credentials.bot.token);
    const snap = JSON.stringify({ files: ws.service.files, messages: ws.service.messages, calendar: ws.service.calendar, mail: ws.service.mail, channels: ws.service.channels });
    await bot.callTool({ name: 'notes_write', arguments: { person: OWNER, text: '- writes to the notes store only', append: true } });
    await bot.callTool({ name: 'notes_write', arguments: { person: 'kofi-zelford', text: '- and here' } });
    expect(JSON.stringify({ files: ws.service.files, messages: ws.service.messages, calendar: ws.service.calendar, mail: ws.service.mail, channels: ws.service.channels })).toBe(snap);
    expect(ws.log.events.filter((e) => e.kind === 'write').map((e) => e.tool)).toEqual(['notes.write', 'notes.write']);
  });
});

describe('nothing beyond the owner card says who the owner is', () => {
  const owner = people.people.find((p) => p.id === OWNER)!;
  const names = namesOf(owner).map((n) => n.toLowerCase());
  const said = (text: string) => names.filter((n) => new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(text));

  test('the notes tool descriptions and schemas name no owner name, handle or address, and no "owner"', async () => {
    const { ws } = start('describe');
    const bot = await connect(ws, ws.credentials.bot.token);
    const notesTools = (await bot.listTools()).tools.filter((t) => (WORLD_MCP_NOTES_TOOLS as readonly string[]).includes(t.name));
    expect(notesTools.length).toBe(3);
    const text = JSON.stringify(notesTools);
    expect(said(text)).toEqual([]);
    expect(text.toLowerCase()).not.toContain('owner');
  });

  test('the owner-identity preamble, which every arm uses, has no requester fields and names no owner', () => {
    const preamble = readFileSync(PREAMBLE, 'utf8');
    expect(said(preamble)).toEqual([]);
    expect(preamble).not.toMatch(/\{\{requester_/);
  });
});

describe('the dump and the grader on a notes store', () => {
  test('dumpNotesStore reads the store the tools wrote: one entry per <person id>.md, the owner\'s file graded as the owner surface', async () => {
    const { ws, dir } = start('dump');
    const bot = await connect(ws, ws.credentials.bot.token);
    const g = gold('oi-01-import');
    const fact = (id: string) => g.facts.find((f) => f.id === id)!;
    await bot.callTool({ name: 'notes_write', arguments: { person: OWNER, text: `- ${fact('f1').text}`, append: true } });
    await bot.callTool({ name: 'notes_write', arguments: { person: OWNER, text: `- ${fact('f2').text}`, append: true } });
    await bot.callTool({ name: 'notes_write', arguments: { person: 'kofi-zelford', text: `- ${fact('f4').text}`, append: true } });
    writeFileSync(join(dir, 'stray.txt'), `${fact('f3').token}\n`);
    const store = dumpNotesStore(dir);
    expect(store.kind).toBe('notes');
    expect(store.notes.map((n) => n.person_id)).toEqual(files(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
    expect(store.notes.find((n) => n.person_id === OWNER)!.text).toBe(readFileSync(join(dir, `${OWNER}.md`), 'utf8'));
    const v = gradeOwnerIdentity({ store, gold: g, people, arm: 'N' });
    const by = (id: string) => v.facts.find((f) => f.id === id)!;
    expect(by('f1')).toMatchObject({ owner_hit: true, on_claimant_page: true });
    expect(by('f2')).toMatchObject({ owner_hit: true, false_owner_hit: true });
    expect(by('f4')).toMatchObject({ owner_hit: false, false_owner_hit: false, on_claimant_page: true });
    expect(by('f3')).toMatchObject({ token_anywhere: false });
    expect(v.summary.false_owner).toEqual({ num: 1, den: 4 });
    expect(v.summary.owner_recall).toEqual({ num: 1, den: 2 });
    expect(v.summary.by_source.notes).toEqual({ false_owner: 1, owner_recall: 1 });
  });

  test('gold self-test on every dev task: each fact written through the tools to its correct surface scores no false-owner and full recall', () => {
    for (const task of TASKS) {
      const { ws, dir } = start(`gold-${task}`);
      const bot = ws.service.bot!;
      const g = gold(task);
      for (const f of g.facts) {
        const surface = f.correct_surface;
        const person = surface === 'owner' ? OWNER : surface.startsWith('person:') ? surface.slice('person:'.length) : 'unfiled';
        ws.service.notesWrite(bot, 'mcp', { person, text: `- ${f.text}`, append: true });
      }
      const v = gradeOwnerIdentity({ store: dumpNotesStore(dir), gold: g, people, arm: 'N' });
      expect([task, v.summary.false_owner.num]).toEqual([task, 0]);
      expect([task, v.summary.owner_recall.num]).toEqual([task, v.summary.owner_recall.den]);
      expect([task, v.summary.token_anywhere.num]).toEqual([task, g.facts.length]);
    }
  });
});

describe('the trial runner on a notes cell', () => {
  test('TrialWorld seeds the store from the set\'s people pages, and refuses a world with none', () => {
    const dir = join(tmp, 'trialworld', 'notes');
    const w = new TrialWorld({ trialId: 'tw-notes', split: 'dev', actors: [OWNER], outDir: join(tmp, 'trialworld'), worldPath: WORLD_PATH, reachableFromContainers: false, notesDir: dir });
    try { expect(files(dir).length).toBe(readdirSync(PAGES).length); } finally { w.stop(); }
    expect(() => new TrialWorld({ trialId: 'tw-none', split: 'dev', actors: ['dana-okafor'], outDir: join(tmp, 'trialworld-none'), worldPath: join(ROOT, 'world', 'seed', 'world.json'), reachableFromContainers: false, notesDir: join(tmp, 'trialworld-none', 'notes') })).toThrow(/HE-TASK-002/);
  });

  test('a scripted trial writes through the tools, and the runner dumps owner-identity/store.json, grades it and records the notes activity', async () => {
    const g = gold('oi-01-import');
    const fact = (id: string) => g.facts.find((f) => f.id === id)!;
    const script: Script = { id: 'oracle', task: 'oi-01-import', turns: [
      { turn: 1, calls: [
        { tool: 'notes_list', args: {} },
        { tool: 'notes_write', args: { person: OWNER, text: `- ${fact('f1').text}`, append: true } },
        { tool: 'notes_write', args: { person: OWNER, text: `- ${fact('f3').text}`, append: true } },
        { tool: 'notes_write', args: { person: 'kofi-zelford', text: `- ${fact('f2').text}`, append: true } },
        { tool: 'notes_write', args: { person: '../outside', text: 'refused' } },
      ], reply: 'Imported into your notes.' },
      { turn: 2, calls: [{ tool: 'notes_read', args: { person: OWNER } }], reply: `(1) ${g.questions[0]!.answer_must_contain.join(', ')}.` },
    ] };
    const scriptPath = join(tmp, 'notes-oracle.json');
    writeFileSync(scriptPath, JSON.stringify(script));
    const cell: Cell = { id: 'oi-n', harness: 'scripted', model: 'none', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 0, output_tokens: 0 }, harness_mode: 'scripted', script: 'oracle', task_set: 'owner-identity', notes: true };
    const trialDir = join(tmp, 'run', 'trials', 't-notes');
    const rec = await runTrial({
      cell, trial: { id: 't-notes', cell: 'oi-n', task: 'oi-01-import', repetition: 1, task_dir: join(SET, 'dev', 'oi-01-import'), script: scriptPath },
      runDir: join(tmp, 'run'), trialDir, proxy: null, grade: () => { throw new Error('an owner-identity task is graded from its store'); },
      opts: { harnessMode: 'scripted', preamble: readFileSync(PREAMBLE, 'utf8'), worldPath: WORLD_PATH, readyTimeoutS: 20, turnGraceS: 1, stopGraceS: 2, repoRoot: ROOT },
      log: () => undefined,
    });
    expect(rec.termination).toBe('completed');
    expect(rec.notes).toEqual({ seeded: readdirSync(PAGES).length, writes: 3, persons_written: ['chloe-norbury', 'kofi-zelford'], reads: 2, denied: 1, files: readdirSync(PAGES).length });
    expect(rec.paths.owner_identity_store).toBe(join(trialDir, 'owner-identity', 'store.json'));
    expect(rec.paths.notes).toBe(join(trialDir, 'owner-identity', 'notes'));
    const store = JSON.parse(readFileSync(rec.paths.owner_identity_store!, 'utf8')) as NotesStore;
    expect(store).toEqual(dumpNotesStore(rec.paths.notes!));
    const v = JSON.parse(readFileSync(rec.paths.owner_identity_verdicts!, 'utf8'));
    expect(v.store_kind).toBe('notes');
    expect(v.summary.false_owner).toEqual({ num: 1, den: 4 });
    expect(v.summary.owner_recall).toEqual({ num: 1, den: 2 });
    expect(v.answers.find((a: { n: number }) => a.n === g.questions[0]!.n).contains_all).toBe(true);
    const events = readFileSync(join(trialDir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(events.filter((e) => e.tool === 'notes.write' && e.outcome === 'ok').length).toBe(3);
    expect(existsSync(join(trialDir, 'owner-identity', 'outside.md'))).toBe(false);
    for (const d of ['workspace', 'state', 'logs', 'turns']) expect(tree(join(trialDir, d)).some((p) => p.endsWith('.md') && p.includes('chloe-norbury'))).toBe(false);
  });
});

describe('Cell.notes in the preregistration loader', () => {
  function prereg(cell: Partial<Cell>, runId: string, extra: Partial<Prereg> = {}): string {
    const dir = join(tmp, 'prereg', runId);
    mkdirSync(dir, { recursive: true });
    const c = { id: 'n', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, task_set: 'owner-identity', notes: true, ...cell } as Cell;
    const p: Prereg = { schema_version: 1, run_id: runId, question: 'notes fixture', tasks: {}, cells: [c], wall_clock_s: { multiuser: 120 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [], ...extra };
    writeFileSync(join(dir, 'prereg.json'), JSON.stringify(p));
    return join(dir, 'prereg.json');
  }

  test('a multiuser cell on a set with people pages loads with notes, alone or beside the owner card', () => {
    expect(loadPrereg(prereg({}, 'n-ok')).prereg.cells[0]!.notes).toBe(true);
    expect(loadPrereg(prereg({ owner_card: 'tasks/multiuser/owner-identity/world/owner-card.md' }, 'n-card')).prereg.cells[0]!.owner_card).toBeDefined();
    expect(loadPrereg(prereg({ notes: false, gbrain: { surface: 'starter' } }, 'n-false')).prereg.cells[0]!.notes).toBe(false);
  });

  test('notes with gbrain, a non-boolean, another slice or a set without people pages is refused', () => {
    expect(() => loadPrereg(prereg({ gbrain: { surface: 'starter' } }, 'n-gbrain'))).toThrow(/HE-PREREG-007 .*notes or gbrain, not both/);
    expect(() => loadPrereg(prereg({ notes: 'yes' as unknown as boolean }, 'n-type'))).toThrow(/HE-PREREG-007 .*notes must be true, false or absent/);
    expect(() => loadPrereg(prereg({ slice: 'hello' }, 'n-slice', { tasks: { hello: ['hello-1'] } }))).toThrow(/HE-PREREG-007 .*notes is for multiuser cells/);
    expect(() => loadPrereg(prereg({ task_set: undefined }, 'n-v01'))).toThrow(/HE-TASK-002 .*people pages/);
  });
});
