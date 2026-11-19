// Keyless tests for the owner-identity generator (world/owner-identity): determinism, token rules, coverage, loadTask and
// loadWorld validity, and one golden test per hard case showing the gold roles the grader scores against.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rng } from '../world/brain/names.ts';
import { loadTask } from '../runner/trial/task.ts';
import { loadWorld } from '../world/services/world.ts';
import { HARD_CASES } from '../world/owner-identity/facts.ts';
import { DEV_SEED, digest, generateBank, writeBank, type Gold } from '../world/owner-identity/generate.ts';
import { checkBank, PROBE_SEED } from '../world/owner-identity/check.ts';
import { collides, isEnglish, stem, TokenPool } from '../world/owner-identity/tokens.ts';

const dev = generateBank(DEV_SEED, 'dev', 12);
const probe = generateBank(PROBE_SEED, 'dev', 42);
const golds = (bank: Map<string, string>) => [...bank].filter(([k]) => k.endsWith('gold.json')).map(([, v]) => JSON.parse(v) as Gold);
const people = (bank: Map<string, string>) => JSON.parse(bank.get('world/people.json')!) as { owner: string; people: Array<{ id: string; name: string; role_in_story: string }>; decoys: Array<{ id: string; kind: string }> };
const decoy = (bank: Map<string, string>, kind: string) => people(bank).decoys.find((d) => d.kind === kind)!.id;
const allFacts = golds(probe).flatMap((g) => g.facts.map((f) => ({ ...f, task: g.task, source: g.source })));
const owner = people(probe).owner;
const of = (h: string) => allFacts.filter((f) => f.hard_case === h);

describe('determinism', () => {
  test('the same seed gives the same bytes and another seed does not', () => {
    expect(digest(generateBank(DEV_SEED, 'dev', 12))).toBe(digest(dev));
    expect(digest(generateBank('another-seed', 'dev', 12))).not.toBe(digest(dev));
  });
  test('only the two bank sizes are accepted', () => {
    expect(() => generateBank(DEV_SEED, 'dev', 13)).toThrow('--tasks must be 12');
  });
});

describe('tokens', () => {
  test('english words are refused, with plurals', () => {
    expect(isEnglish('garden')).toBe(true);
    expect(isEnglish('Gardens')).toBe(true);
    expect(isEnglish('Varnimel')).toBe(false);
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
    expect(checkBank(dev, 'dev', 12)).toBeNull();
    expect(checkBank(probe, 'dev', 42)).toBeNull();
  });
  test('every hard case is in at least one dev task and at least six probe tasks', () => {
    for (const h of HARD_CASES) {
      expect(golds(dev).filter((g) => g.hard_cases.includes(h)).length).toBeGreaterThanOrEqual(1);
      expect(golds(probe).filter((g) => g.hard_cases.includes(h)).length).toBeGreaterThanOrEqual(6);
    }
  });
  test('loadTask reads every task and loadWorld reads the world', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oi-test-'));
    try {
      writeBank(dev, dir);
      const ids = readdirSync(join(dir, 'dev'));
      expect(ids.length).toBe(12);
      for (const id of ids) expect(loadTask(join(dir, 'dev', id)).family).toMatch(/^owner_identity_[IL]$/);
      const world = loadWorld(join(dir, 'world', 'world.json'));
      expect(world.files.length).toBeGreaterThan(8);
      expect(world.files.every((f) => f.visibility === 'private' && f.owner === people(dev).owner)).toBe(true);
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
  test('control: plain first-hand facts', () => {
    for (const f of of('control')) { expect(f.claimant).toBe(f.utterer); expect(f.primary).toBe(f.claimant === owner ? 'owner_recall' : 'false_owner'); }
  });
});
