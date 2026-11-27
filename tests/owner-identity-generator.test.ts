// Keyless tests for the owner-identity generator (world/owner-identity): determinism, token rules, coverage, loadTask and
// loadWorld validity, and one golden test per hard case showing the gold roles the grader scores against.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rng } from '../world/brain/names.ts';
import { loadTask } from '../runner/trial/task.ts';
import { loadWorld } from '../world/services/world.ts';
import { HARD_CASES } from '../world/owner-identity/facts.ts';
import { DEV_SEED, PROFILES, digest, generateBank, writeBank, type Gold } from '../world/owner-identity/generate.ts';
import { checkBank, KNOWN_FORMAT_CASES, PROBE_SEED } from '../world/owner-identity/check.ts';
import { collides, isEnglish, stem, TokenPool } from '../world/owner-identity/tokens.ts';

const dev = generateBank(DEV_SEED, 'dev', 15);
const probe = generateBank(PROBE_SEED, 'dev', 42);
const golds = (bank: Map<string, string>) => [...bank].filter(([k]) => k.endsWith('gold.json')).map(([, v]) => JSON.parse(v) as Gold);
const people = (bank: Map<string, string>) => JSON.parse(bank.get('world/people.json')!) as { owner: string; people: Array<{ id: string; name: string; role_in_story: string }>; decoys: Array<{ id: string; kind: string }> };
const decoy = (bank: Map<string, string>, kind: string) => people(bank).decoys.find((d) => d.kind === kind)!.id;
const allFacts = golds(probe).flatMap((g) => g.facts.map((f) => ({ ...f, task: g.task, source: g.source })));
const owner = people(probe).owner;
const of = (h: string) => allFacts.filter((f) => f.hard_case === h);
const probeFiles = (JSON.parse(probe.get('world/world.json')!) as { files: Array<{ path: string; body: string }> }).files;
const lineOf = (f: (typeof allFacts)[number], back = 0) => {
  if (!('file' in f.where)) return null;
  const w = f.where;
  return probeFiles.find((x) => x.path.endsWith(`/${f.task}/${w.file}`))!.body.split('\n')[w.line - 1 - back]!;
};
const ownerP = people(probe).people.find((p) => p.id === owner)!;
const ea = people(probe).people.find((p) => p.role_in_story.startsWith('executive assistant'))!.id;
const tasksWith = (bank: Map<string, string>, h: string) => golds(bank).filter((g) => g.hard_cases.includes(h as never));

describe('determinism', () => {
  test('the same seed gives the same bytes and another seed does not', () => {
    expect(digest(generateBank(DEV_SEED, 'dev', 15))).toBe(digest(dev));
    expect(digest(generateBank('another-seed', 'dev', 15))).not.toBe(digest(dev));
  });
  test('only the two bank sizes are accepted', () => {
    expect(() => generateBank(DEV_SEED, 'dev', 13)).toThrow('--tasks must be 15');
  });
});

describe('tokens', () => {
  test('english words are refused, with plurals', () => {
    expect(isEnglish('garden')).toBe(true);
    expect(isEnglish('Gardens')).toBe(true);
    expect(isEnglish('Varnimel')).toBe(false);
  });
  test('isEnglish reads world/owner-identity/english-words.txt', () => {
    const words = readFileSync('world/owner-identity/english-words.txt', 'utf8').split('\n').filter(Boolean);
    expect(words.length).toBe(31917);
    for (const w of [words[0]!, words[words.length - 1]!]) expect(isEnglish(w)).toBe(true);
  });
  test('collisions are case- and plural-insensitive and include substrings', () => {
    expect(stem('Ostrevins')).toBe('ostrevin');
    expect(collides('Ostrevin', 'ostrevins')).toBe(true);
    expect(collides('Ostrevin', 'Kostrevinal')).toBe(true);
    expect(collides('Ostrevin', 'Varnimel')).toBe(false);
  });
  test('a pool issues unique, colliding-free pseudo-words of 6 to 10 letters', () => {
    const pool = new TokenPool(rng([1, 2, 3, 4]), ['Chloe Norbury']);
    const toks = Array.from({ length: 400 }, () => pool.next());
    for (const [i, t] of toks.entries()) {
      expect(t).toMatch(/^[A-Z][a-z]{5,9}$/);
      expect(isEnglish(t)).toBe(false);
      for (const u of toks.slice(i + 1)) expect(collides(t, u)).toBe(false);
      expect(collides(t, 'Norbury')).toBe(false);
    }
  });
});

describe('bank validity and coverage', () => {
  test('the dev bank and the 42-task probe bank pass every check', () => {
    expect(checkBank(dev, 'dev', 15)).toBeNull();
    expect(checkBank(probe, 'dev', 42)).toBeNull();
  });
  test('the dev bank guarantees these per-hard-case minimums, recorder labels in two meeting formats and one live relay task', () => {
    const devMin = {
      recorder_label_absorbs: 3, reported_speech_in_notes: 2, press_paraphrase: 2, owner_under_generic_label: 1, group_thread_one_label: 1,
      assistant_relays_thread: 1, agent_brief_in_user_seat: 2, agent_on_owner_account: 2,
    };
    expect(PROFILES[15]!.min).toEqual(devMin);
    for (const [h, n] of Object.entries(devMin)) expect(tasksWith(dev, h).length).toBeGreaterThanOrEqual(n);
    const recorder = tasksWith(dev, 'recorder_label_absorbs');
    expect(recorder.every((g) => g.source === 'meeting')).toBe(true);
    expect(new Set(recorder.flatMap((g) => g.formats.map((f) => f.format))).size).toBeGreaterThanOrEqual(2);
    const liveTasks = golds(dev).filter((g) => g.family === 'L');
    expect(liveTasks.length).toBe(4);
    expect(liveTasks.some((g) => g.hard_cases.includes('assistant_relays_thread'))).toBe(true);
  });
  test('the probe bank carries every hard case in at least six tasks', () => {
    for (const h of HARD_CASES) expect(tasksWith(probe, h).length).toBeGreaterThanOrEqual(6);
  });
  test('every file of a task carrying a newer hard case is in a format gbrain reads', () => {
    for (const g of [...golds(dev), ...golds(probe)]) if (g.hard_cases.some((h) => KNOWN_FORMAT_CASES.includes(h))) for (const f of g.formats) expect(f.format_known_to_gbrain).toBe(true);
  });
  test('loadTask reads every task and loadWorld reads the world', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oi-test-'));
    try {
      writeBank(dev, dir);
      const ids = readdirSync(join(dir, 'dev'));
      expect(ids.length).toBe(17);
      expect(ids.filter((id) => id.endsWith('-capture'))).toEqual(['oi-16-capture', 'oi-17-capture']);
      for (const id of ids) expect(loadTask(join(dir, 'dev', id)).family).toMatch(id.endsWith('-capture') ? /^owner_identity_C$/ : /^owner_identity_[IL]$/);
      const world = loadWorld(join(dir, 'world', 'world.json'));
      expect(world.files.length).toBeGreaterThan(8);
      expect(world.files.filter((f) => f.folder !== 'people').every((f) => f.visibility === 'private' && f.owner === people(dev).owner)).toBe(true);
      expect(world.files.filter((f) => f.folder === 'people').every((f) => f.visibility === 'public' && f.kind === 'profile')).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('gold roles per hard case', () => {
  test('owner_quoted_by_other: the owner\'s fact, said by someone else, is secondary', () => {
    for (const f of of('owner_quoted_by_other')) expect([f.claimant === owner, f.utterer !== owner, f.primary, f.correct_surface]).toEqual([true, true, 'secondary', 'owner']);
  });
  test('owner_quotes_other: another person\'s fact, said by the owner, belongs to that person', () => {
    for (const f of of('owner_quotes_other')) expect([f.utterer, f.reporter, f.primary, f.correct_surface]).toEqual([owner, owner, 'false_owner', `person:${f.claimant}`]);
  });
  test('owner_aliases: the owner under another name or address is still the owner', () => {
    for (const f of of('owner_aliases')) expect([f.claimant, f.utterer, f.primary]).toEqual([owner, owner, 'owner_recall']);
  });
  test('forwarded_email: the forwarded author keeps the fact and the forwarder is the reporter', () => {
    for (const f of of('forwarded_email')) { expect(f.claimant).not.toBe(owner); expect(f.reporter).not.toBeNull(); expect(f.primary).toBe('false_owner'); }
  });
  test('assistant_on_behalf: the owner\'s relayed facts are secondary and the assistant\'s own are not the owner\'s', () => {
    const ea = people(probe).people.find((p) => p.role_in_story.startsWith('executive assistant'))!.id;
    const fs = of('assistant_on_behalf');
    expect(fs.some((f) => f.claimant === owner && f.utterer === ea && f.primary === 'secondary')).toBe(true);
    expect(fs.some((f) => f.claimant === ea && f.primary === 'false_owner' && f.correct_surface === `person:${ea}`)).toBe(true);
    for (const f of fs) expect(f.utterer).toBe(ea);
  });
  test('group_chat: each speaker owns what they say', () => {
    for (const f of of('group_chat')) expect(f.claimant).toBe(f.utterer);
  });
  test('swapped_or_anonymous_labels: gold follows the true speaker, not the label', () => {
    const swapped = golds(probe).find((g) => g.source === 'meeting' && g.formats[0]!.format === 'bold-name-no-time' && g.hard_cases.includes('assistant_model_says_I'))!;
    const world = JSON.parse(probe.get('world/world.json')!) as { files: Array<{ path: string; body: string }> };
    const body = world.files.find((f) => f.path.includes(`/${swapped.task}/`))!.body.split('\n');
    const names = Object.fromEntries(people(probe).people.map((p) => [p.id, p.name]));
    const mislabelled = swapped.facts.filter((f) => 'line' in f.where && !f.claimant.startsWith('agent:') && !body[f.where.line - 1]!.startsWith(`**${names[f.claimant]}:**`));
    expect(mislabelled.length).toBeGreaterThan(0);
  });
  test('similar_name_decoy: the namesake and the near-anagram nickname keep their own facts', () => {
    const ids = [decoy(probe, 'similar_name'), decoy(probe, 'anagram_nickname')];
    for (const f of of('similar_name_decoy')) { expect(ids).toContain(f.claimant); expect(f.correct_surface).toBe(`person:${f.claimant}`); }
  });
  test('me_contact_decoy: a speaker labelled "Me" who is not the owner keeps their facts', () => {
    for (const f of of('me_contact_decoy')) { expect(f.claimant).not.toBe(owner); expect(f.primary).toBe('false_owner'); }
    expect(of('me_contact_decoy').some((f) => f.claimant === decoy(probe, 'me_contact'))).toBe(true);
  });
  test('assistant_model_says_I: an AI assistant\'s "I" is never the owner', () => {
    for (const f of of('assistant_model_says_I')) expect([f.claimant.startsWith('agent:'), f.correct_surface]).toEqual([true, 'not_owner']);
  });
  test('agent_brief_in_user_seat: an orchestrator brief about the owner is not the owner speaking', () => {
    for (const f of of('agent_brief_in_user_seat')) expect([f.claimant, f.subject, f.primary, f.correct_surface]).toEqual(['agent:orchestrator', owner, 'false_owner', 'not_owner']);
  });
  test('recorder_label_absorbs: an attendee\'s line under the owner\'s label stays the attendee\'s', () => {
    expect(of('recorder_label_absorbs').length).toBeGreaterThan(0);
    for (const f of of('recorder_label_absorbs')) {
      expect([f.claimant !== owner, f.utterer, f.primary, f.correct_surface]).toEqual([true, f.claimant, 'false_owner', `person:${f.claimant}`]);
      expect(lineOf(f)!.replace(/^\*\*/, '').startsWith(ownerP.name)).toBe(true);
      const speaker = people(probe).people.find((p) => p.id === f.claimant)!;
      expect(f.cue).toBe('clear');
      expect(lineOf(f)!.includes(`${ownerP.name.split(' ')[0]}, speaking as your ${speaker.role_in_story}:`) || lineOf(f)!.includes(`${ownerP.name.split(' ')[0]}, ${speaker.name.split(' ')[0]} here`)).toBe(true);
    }
  });
  test('owner_under_generic_label: the owner\'s lines under "Participant 2" or "Speaker 2" are the owner\'s', () => {
    for (const f of of('owner_under_generic_label')) {
      expect([f.claimant, f.utterer, f.primary, f.correct_surface]).toEqual([owner, owner, 'owner_recall', 'owner']);
      expect(lineOf(f)).toMatch(/^(\*\*Participant 2:\*\*|Speaker 2:) /);
    }
  });
  test('group_thread_one_label: a member\'s line under the thread name stays the member\'s', () => {
    for (const f of of('group_thread_one_label')) {
      expect([f.claimant !== owner, f.utterer, f.primary, f.correct_surface]).toEqual([true, f.claimant, 'false_owner', `person:${f.claimant}`]);
      expect(lineOf(f)!.startsWith('**Me**')).toBe(false);
    }
  });
  test('reported_speech_in_notes: what a friend told the owner, in an agent-written notes page, is the friend\'s', () => {
    for (const f of of('reported_speech_in_notes')) {
      expect([f.claimant !== owner, f.utterer, f.reporter, f.primary, f.correct_surface]).toEqual([true, owner, owner, 'false_owner', `person:${f.claimant}`]);
      expect(golds(probe).find((g) => g.task === f.task)!.formats.find((x) => 'file' in f.where && x.file === f.where.file)!.format).toBe('markdown-notes-page');
    }
  });
  test('press_paraphrase: a news report about the owner is the outlet\'s claim, not the owner\'s', () => {
    for (const f of of('press_paraphrase')) expect([f.claimant.startsWith('press:'), f.subject, f.primary, f.correct_surface]).toEqual([true, owner, 'false_owner', 'not_owner']);
  });
  test('agent_on_owner_account: lines the scheduling agent typed from the owner\'s account are the agent\'s', () => {
    for (const f of of('agent_on_owner_account')) {
      expect([f.claimant, f.utterer, f.primary, f.correct_surface]).toEqual(['agent:scheduler', 'agent:scheduler', 'false_owner', 'not_owner']);
      if ('file' in f.where) expect([lineOf(f)!, lineOf(f, 1)!].some((l) => l.startsWith('**Me**') || l.startsWith(`${ownerP.name}, [`))).toBe(true);
    }
  });
  test('assistant_relays_thread: a third party\'s reply the assistant pastes stays the third party\'s', () => {
    expect(of('assistant_relays_thread').some((f) => f.source === 'live')).toBe(true);
    for (const f of of('assistant_relays_thread')) {
      expect([f.claimant !== owner && f.claimant !== ea, f.utterer, f.reporter, f.primary, f.correct_surface]).toEqual([true, f.claimant, ea, 'false_owner', `person:${f.claimant}`]);
    }
  });
  test('only recorder_label_absorbs facts carry a cue field', () => {
    for (const f of allFacts) expect(f.cue === undefined).toBe(f.hard_case !== 'recorder_label_absorbs');
  });
  test('control: plain first-hand facts', () => {
    for (const f of of('control')) { expect(f.claimant).toBe(f.utterer); expect(f.primary).toBe(f.claimant === owner ? 'owner_recall' : 'false_owner'); }
  });
});
