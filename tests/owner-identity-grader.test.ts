// HARN-116 owner-identity grader, store reader, facts drain and audit helper, keyless. Fixture stores are written by hand from the
// generator contract (handoffs gen-spec.md, "Planted facts and gold.json"); every name, address and token is invented.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerCheck, gradeOwnerIdentity, gradeOwnerIdentityFiles, tokenRegex, type Gold, type GoldFact, type People } from '../runner/grade/owner-identity.ts';
import { dumpDockerArgs, dumpNotesStore, factSourceCategory, gbrainStoreFrom, rawKind, type GbrainStore, type StoreFact, type StorePage } from '../runner/grade/owner-identity-store.ts';
import { DRAIN_DEFAULTS, drainCounts, drainGbrain, drainProblem, factsDrainPhase, gbrainLlmOn, probeFactsIdle, waitFactsIdle } from '../runner/trial/gbrain-drain.ts';
import { drawAudit, renderAudit, scoreAudit } from '../scripts/owner-identity/audit-sample.ts';
import type { TrialGbrainDrain } from '../runner/contracts.ts';

const tmp = mkdtempSync(join(tmpdir(), 'he-owner-identity-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const OWNER = 'ilsa-marrowby';
const people: People = {
  owner: OWNER,
  people: [
    { id: OWNER, name: 'Ilsa Marrowby', first: 'Ilsa', aliases: ['Izzy', 'I. Marrowby'], handles: { emails: ['ilsa@example.com', 'ilsa.m@example.org', 'ilsa.work@example.net'], phones: ['555-0101', '555-0102'], slack: 'ilsam', imessage: ['555-0101'] }, page_slug: 'people/ilsa-marrowby' },
    { id: 'dov-quarrel', name: 'Dov Quarrel', first: 'Dov', aliases: [], handles: { emails: ['dov@example.com'] }, page_slug: 'people/dov-quarrel' },
    { id: 'pell-asquith', name: 'Pell Asquith', first: 'Pell', aliases: ['Pelly'], handles: { emails: ['pell@example.org'] }, page_slug: 'people/pell-asquith' },
    { id: 'wren-talbot', name: 'Wren Talbot', first: 'Wren', aliases: [], handles: { emails: ['wren@example.net'] }, page_slug: 'people/wren-talbot' },
  ],
  decoys: [{ id: 'ilsa-marrowbie', kind: 'similar_name' }],
};

const fact = (id: string, token: string, claimant: string, primary: GoldFact['primary'], hard_case = 'control', over: Partial<GoldFact> = {}): GoldFact => ({
  id, token, claimant, utterer: claimant, reporter: null, subject: claimant, hard_case, primary,
  correct_surface: claimant === OWNER ? 'owner' : `person:${claimant}`, where: { file: 'chat.txt', line: 1 }, text: `a sentence with ${token}`, ...over,
});
const gold = (facts: GoldFact[], questions: Gold['questions'] = []): Gold => ({ task: 'oi-01-fixture', family: 'I', source: 'chat-1to1', formats: [{ file: 'chat.txt', format: 'whatsapp', format_known_to_gbrain: true }], hard_cases: [...new Set(facts.map((f) => f.hard_case))], facts, questions });

const page = (slug: string, compiled_truth: string, over: Partial<StorePage> = {}): StorePage => {
  const p = { slug, source_id: 'default', type: slug.startsWith('people/') ? 'person' : 'note', title: slug, frontmatter: {}, compiled_truth, timeline: '', timeline_entries: [], source_kind: 'put_page', ...over };
  return { ...p, raw_kind: over.raw_kind !== undefined ? over.raw_kind : rawKind(p) };
};
let nextId = 1;
const row = (entity: string | null, text: string, over: Partial<StoreFact> = {}): StoreFact => ({
  id: nextId++, source_id: 'default', entity_slug: entity, fact: text, context: null, kind: 'fact', visibility: 'private', source: 'mcp:put_page', source_category: 'model_write',
  source_session: null, attributed_to: null, unattributed: entity === null || entity === 'memory/unattributed', expired: false, ...over,
});
const store = (pages: StorePage[], facts: StoreFact[] = [], owner_member: string | null = null): GbrainStore => ({
  schema_version: 1, kind: 'gbrain', read_via: "gbrain/owner-identity-dump.ts (read-only SQL through gbrain's engine)", gbrain_version: '0.60.747.0', owner_member, pages, facts, absorb_log: [], absorb_jobs: [],
});
const only = (v: ReturnType<typeof gradeOwnerIdentity>, id: string) => v.facts.find((f) => f.id === id)!;

describe('token matching', () => {
  test('case- and plural-insensitive whole words, possessive included, never a substring', () => {
    const re = tokenRegex('Varnimel');
    for (const s of ['varnimel', 'VARNIMELS', "Varnimel's", 'Varnimeles', 'the Varnimel-Works gym']) expect(re.test(s)).toBe(true);
    for (const s of ['xVarnimel', 'Varnimelx', 'Varnime']) expect(re.test(s)).toBe(false);
    expect(tokenRegex('Ostrevy').test('two Ostrevies')).toBe(true);
  });
});

describe('the grader on hand-built gbrain stores', () => {
  test('a correct import: the owner fact on the owner page, a contact fact on the contact page', () => {
    const g = gold([fact('f1', 'Varnimel', OWNER, 'owner_recall'), fact('f2', 'Ostrevin', 'dov-quarrel', 'false_owner')]);
    const s = store([page('people/ilsa-marrowby', 'My climbing gym is Varnimel Works.'), page('people/dov-quarrel', 'Dov will send the Ostrevin deck Friday.')]);
    const v = gradeOwnerIdentity({ store: s, gold: g, people });
    expect(v.summary.false_owner).toEqual({ num: 0, den: 1 });
    expect(v.summary.owner_recall).toEqual({ num: 1, den: 1 });
    expect(only(v, 'f2').on_claimant_page).toBe(true);
    expect(only(v, 'f2').owner_hit).toBe(false);
  });

  test('the owner quoting someone else, filed on the owner page as a fact row, is false-owner', () => {
    const g = gold([fact('f1', 'Quellanor', 'dov-quarrel', 'false_owner', 'owner_quotes_other', { utterer: OWNER })]);
    const s = store([page('people/ilsa-marrowby', 'Owner page.')], [row('people/ilsa-marrowby', 'Prefers Quellanor coffee', { attributed_to: 'user' })]);
    const v = gradeOwnerIdentity({ store: s, gold: g, people });
    expect(only(v, 'f1').false_owner_hit).toBe(true);
    expect(only(v, 'f1').filed_as_user).toBe(true);
    expect(v.summary.false_owner).toEqual({ num: 1, den: 1 });
    expect(v.summary.by_hard_case.owner_quotes_other!.false_owner).toEqual({ num: 1, den: 1 });
    expect(v.summary.by_source.model_write!.false_owner).toBe(1);
  });

  test('a third-party fact on the owner page that names its claimant is correctly reported, not false-owner', () => {
    const g = gold([fact('f1', 'Brisovel', 'dov-quarrel', 'false_owner', 'owner_quoted_by_other')]);
    const s = store([page('people/ilsa-marrowby', 'Dov Quarrel says he keeps his boat at Brisovel.')]);
    const f = only(gradeOwnerIdentity({ store: s, gold: g, people }), 'f1');
    expect(f.owner_hit).toBe(true);
    expect(f.false_owner_hit).toBe(false);
    expect(f.correctly_reported).toBe(true);
  });

  test('a token only on a raw conversation page is no owner hit, but is anywhere', () => {
    const g = gold([fact('f1', 'Tazomer', OWNER, 'owner_recall'), fact('f2', 'Lunarik', 'pell-asquith', 'false_owner')]);
    const s = store([page('conversations/whatsapp/ilsa-pell', 'Ilsa: I live near Tazomer\nPell: my dog is Lunarik', { type: 'conversation' }), page('meetings/2026-03-02-sync', 'Speaker A: Lunarik again', { type: 'note' }), page('people/ilsa-marrowby', 'Owner page.')]);
    const v = gradeOwnerIdentity({ store: s, gold: g, people });
    expect(only(v, 'f1').owner_hit).toBe(false);
    expect(only(v, 'f1').token_anywhere).toBe(true);
    expect(only(v, 'f2').false_owner_hit).toBe(false);
    expect(only(v, 'f2').occurrences.every((x) => x.surface === 'other')).toBe(true);
    expect(v.summary.token_anywhere).toEqual({ num: 2, den: 2 });
  });

  test('plural and case variants on the owner page and timeline count', () => {
    const g = gold([fact('f1', 'Varnimel', OWNER, 'owner_recall'), fact('f2', 'Brendosy', OWNER, 'owner_recall')]);
    const s = store([page('people/ilsa-marrowby', 'Goes to the VARNIMELS on Tuesdays.', { timeline: '- **2026-03-01** | bought two brendosies', timeline_entries: [{ date: '2026-03-01', source: 'manual', summary: 'bought two brendosies', detail: '' }] })]);
    const v = gradeOwnerIdentity({ store: s, gold: g, people });
    expect(v.summary.owner_recall).toEqual({ num: 2, den: 2 });
    expect(v.summary.by_source.page_line!.owner_recall).toBe(2);
  });

  test('an unattributed fact is visible as speaker unknown and is no owner hit', () => {
    const g = gold([fact('f1', 'Corvessa', 'pell-asquith', 'false_owner', 'swapped_or_anonymous_labels'), fact('f2', 'Draminor', 'dov-quarrel', 'false_owner')]);
    const s = store([page('memory/unattributed', 'Speaker unknown: likes Draminor')], [row(null, 'Speaker A prefers Corvessa')]);
    const v = gradeOwnerIdentity({ store: s, gold: g, people });
    expect(only(v, 'f1').unattributed_visible).toBe(true);
    expect(only(v, 'f2').unattributed_visible).toBe(true);
    expect(v.summary.false_owner.num).toBe(0);
    expect(v.summary.unattributed_visible).toEqual({ num: 2, den: 2 });
  });

  test("the owner's member page is an owner surface, rows and lines alike", () => {
    const g = gold([fact('f1', 'Halvenor', 'dov-quarrel', 'false_owner'), fact('f2', 'Pirelline', OWNER, 'owner_recall')]);
    const s = store([page('memory/members/ilsa', 'Pirelline is her running club.')], [row('memory/members/ilsa', 'Keeps a kayak called Halvenor')], 'ilsa');
    const v = gradeOwnerIdentity({ store: s, gold: g, people });
    expect(v.owner_slugs).toEqual(['people/ilsa-marrowby', 'memory/members/ilsa']);
    expect(only(v, 'f1').false_owner_hit).toBe(true);
    expect(only(v, 'f2').owner_hit).toBe(true);
    expect(gradeOwnerIdentity({ store: { ...s, owner_member: null }, gold: g, people }).summary.false_owner.num).toBe(0);
  });

  test('filed_as_user is recorded apart and never makes an owner hit', () => {
    const g = gold([fact('f1', 'Sorvelle', 'dov-quarrel', 'false_owner', 'group_chat'), fact('f2', 'Tremova', 'pell-asquith', 'false_owner')]);
    const s = store([], [row('people/dov-quarrel', 'Owns a Sorvelle bike', { attributed_to: 'user' }), row('people/pell-asquith', 'Pell Asquith likes Tremova', { attributed_to: 'user' })]);
    const v = gradeOwnerIdentity({ store: s, gold: g, people });
    expect(only(v, 'f1').filed_as_user).toBe(true);
    expect(only(v, 'f1').owner_hit).toBe(false);
    expect(only(v, 'f2').filed_as_user).toBe(false);
    expect(v.summary.filed_as_user).toEqual({ num: 1, den: 2 });
    expect(v.summary.attributed_to_agreement).toEqual({ num: 0, den: 2 });
  });

  test('a fact on a third person page is wrong-person; expired rows are not graded', () => {
    const g = gold([fact('f1', 'Kestrova', 'dov-quarrel', 'false_owner'), fact('f2', 'Orbellin', 'pell-asquith', 'false_owner')]);
    const s = store([], [row('people/wren-talbot', 'Kestrova is the boat'), row('people/ilsa-marrowby', 'Orbellin tea', { expired: true })]);
    const v = gradeOwnerIdentity({ store: s, gold: g, people });
    expect(only(v, 'f1').on_wrong_person_page).toBe(true);
    expect(v.summary.wrong_person).toEqual({ num: 1, den: 2 });
    expect(only(v, 'f2').token_anywhere).toBe(false);
  });

  test('a secondary fact names its reporter; secondaries count in neither primary', () => {
    const g = gold([fact('f1', 'Melbriar', OWNER, 'secondary', 'assistant_on_behalf', { reporter: 'wren-talbot', utterer: 'wren-talbot' })]);
    const s = store([page('people/ilsa-marrowby', 'Wren Talbot wrote that Ilsa will host at Melbriar.')]);
    const v = gradeOwnerIdentity({ store: s, gold: g, people });
    expect(only(v, 'f1').correctly_reported).toBe(true);
    expect(v.summary.false_owner.den + v.summary.owner_recall.den).toBe(0);
    expect(v.summary.secondary_owner_hit).toEqual({ num: 1, den: 1 });
  });

  test('page slugs match with or without the people/ folder', () => {
    const g = gold([fact('f1', 'Varnimel', OWNER, 'owner_recall')]);
    const v = gradeOwnerIdentity({ store: store([page('ilsa-marrowby', 'Varnimel gym')]), gold: g, people });
    expect(only(v, 'f1').owner_hit).toBe(true);
  });
});

describe('arm N: a notes directory', () => {
  test("lines of the owner's file are owner surfaces; another person's file is theirs", () => {
    const dir = join(tmp, 'notes');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${OWNER}.md`), '# Ilsa\n- climbs at Varnimel Works\n- prefers Quellanor coffee\n');
    writeFileSync(join(dir, 'dov-quarrel.md'), '# Dov\n- sends the Ostrevin deck Friday\n');
    writeFileSync(join(dir, 'README.txt'), 'Varnimel');
    const s = dumpNotesStore(dir);
    expect(s.notes.map((n) => n.person_id)).toEqual(['dov-quarrel', OWNER]);
    const g = gold([fact('f1', 'Varnimel', OWNER, 'owner_recall'), fact('f2', 'Quellanor', 'dov-quarrel', 'false_owner', 'owner_quotes_other'), fact('f3', 'Ostrevin', 'dov-quarrel', 'false_owner')]);
    const v = gradeOwnerIdentity({ store: s, gold: g, people });
    expect(v.store_kind).toBe('notes');
    expect(v.summary.owner_recall).toEqual({ num: 1, den: 1 });
    expect(v.summary.false_owner).toEqual({ num: 1, den: 2 });
    expect(only(v, 'f3').on_claimant_page).toBe(true);
    expect(v.summary.by_source.notes).toEqual({ false_owner: 1, owner_recall: 1 });
  });
});

describe('gold-brain self-test', () => {
  const HARD = ['owner_quoted_by_other', 'owner_quotes_other', 'owner_aliases', 'forwarded_email', 'assistant_on_behalf', 'group_chat', 'swapped_or_anonymous_labels', 'similar_name_decoy', 'me_contact_decoy', 'assistant_model_says_I', 'agent_brief_in_user_seat', 'control'];
  const tokens = ['Varnimel', 'Ostrevin', 'Quellanor', 'Brisovel', 'Tazomer', 'Lunarik', 'Corvessa', 'Draminor', 'Halvenor', 'Pirelline', 'Sorvelle', 'Tremova', 'Kestrova', 'Orbellin', 'Melbriar', 'Brendosy', 'Fennoric', 'Galestra', 'Hollimar', 'Istravel', 'Jovander', 'Kalimbor', 'Lurenta', 'Mossavin', 'Nerivale', 'Oskaline', 'Pentravo', 'Quorvela', 'Rossimer', 'Saverine', 'Tolvanni', 'Ulmarie', 'Vestrano', 'Wendalor', 'Xantrevi', 'Yoravel'];
  const facts: GoldFact[] = HARD.flatMap((hc, i) => [
    fact(`o${i}`, tokens[i * 3]!, OWNER, 'owner_recall', hc),
    fact(`p${i}`, tokens[i * 3 + 1]!, i % 2 ? 'dov-quarrel' : 'pell-asquith', 'false_owner', hc, i % 3 === 0 ? { claimant: 'agent:moss', correct_surface: 'not_owner' } : {}),
    fact(`s${i}`, tokens[i * 3 + 2]!, OWNER, 'secondary', hc, { reporter: 'wren-talbot', utterer: 'wren-talbot' }),
  ]);
  test('every fact on its correct surface gives 0 false-owner and full recall', () => {
    const pages: StorePage[] = [page('conversations/import/raw', facts.map((f) => `someone: ${f.token}`).join('\n'), { type: 'conversation' })];
    const rows: StoreFact[] = [];
    const ownerLines: string[] = [];
    for (const f of facts) {
      if (f.primary === 'owner_recall') ownerLines.push(`Ilsa's ${f.token}.`);
      else if (f.primary === 'secondary') ownerLines.push(`Wren Talbot says Ilsa has ${f.token}.`);
      else if (f.correct_surface === 'not_owner') rows.push(row(null, `unknown speaker: ${f.token}`));
      else rows.push(row(people.people.find((p) => p.id === f.claimant)!.page_slug, `has ${f.token}`, { attributed_to: 'other' }));
    }
    pages.push(page('people/ilsa-marrowby', ownerLines.join('\n')));
    const v = gradeOwnerIdentity({ store: store(pages, rows), gold: gold(facts), people });
    expect(v.summary.false_owner).toEqual({ num: 0, den: HARD.length });
    expect(v.summary.owner_recall).toEqual({ num: HARD.length, den: HARD.length });
    expect(v.summary.owner_precision).toEqual({ num: HARD.length, den: HARD.length });
    expect(v.summary.secondary_owner_hit).toEqual({ num: HARD.length, den: HARD.length });
    expect(Object.keys(v.summary.by_hard_case).sort()).toEqual([...HARD].sort());
    for (const hc of HARD) expect(v.summary.by_hard_case[hc]!.false_owner.num).toBe(0);
  });
});

describe('answer check and the file entry', () => {
  test('a reply passes a question only when it holds every required string, case-insensitively', () => {
    const g = gold([fact('f1', 'Varnimel', OWNER, 'owner_recall')], [{ n: 1, kind: 'owner_fact', token: 'Varnimel', answer_must_contain: ['Varnimel'] }, { n: 2, kind: 'who_said', token: 'Ostrevin', answer_must_contain: ['Dov', 'Ostrevin'] }]);
    expect(answerCheck(g, 'Your gym is varnimel works. Dov mentioned it.')).toEqual([
      { n: 1, kind: 'owner_fact', token: 'Varnimel', contains_all: true, missing: [] },
      { n: 2, kind: 'who_said', token: 'Ostrevin', contains_all: false, missing: ['Ostrevin'] },
    ]);
  });
  test('gradeOwnerIdentityFiles reads the three files and writes verdicts with the answers apart', () => {
    const g = gold([fact('f1', 'Varnimel', OWNER, 'owner_recall')], [{ n: 1, kind: 'owner_fact', token: 'Varnimel', answer_must_contain: ['Varnimel'] }]);
    const files = { store: join(tmp, 'store.json'), gold: join(tmp, 'gold.json'), people: join(tmp, 'people.json'), out: join(tmp, 'out', 'verdicts.json') };
    writeFileSync(files.store, JSON.stringify(store([page('people/ilsa-marrowby', 'Varnimel')])));
    writeFileSync(files.gold, JSON.stringify(g));
    writeFileSync(files.people, JSON.stringify(people));
    const v = gradeOwnerIdentityFiles({ ...files, reply: 'Varnimel', arm: 'G' });
    expect(JSON.parse(readFileSync(files.out, 'utf8')).summary.owner_recall).toEqual({ num: 1, den: 1 });
    expect(v.arm).toBe('G');
    expect(v.answers![0]!.contains_all).toBe(true);
  });
});

describe('the store reader', () => {
  test('gbrainStoreFrom marks raw pages, unattributed and expired rows, sources and reasons', () => {
    const s = gbrainStoreFrom({
      gbrain_version: '0.60.747.0', owner_member: 'ilsa',
      pages: [{ slug: 'conversations/sessions/abc', type: 'note', title: 't', frontmatter: {}, compiled_truth: '', timeline: '', source_kind: null, timeline_entries: [] }, { slug: 'meetings/x', type: 'meeting', title: 'm' }, { slug: 'people/dov-quarrel', type: 'person', title: 'Dov' }],
      facts: [{ id: 1, entity_slug: null, fact: 'a', source: 'hook:compact', expired_at: null, superseded_by: null }, { id: 2, entity_slug: 'team/memory/unattributed', fact: 'b', source: 'sweep:corpus', expired_at: '2026-01-01' }, { id: 3, entity_slug: 'people/dov-quarrel', fact: 'c', source: 'notes 2026-03-01', attributed_to: 'other' }],
      absorb_log: [{ id: 4, source_ref: 'x', summary: 'gateway_rate_limit: provider request failed', created_at: '2026-11-19T00:00:00.000Z' }],
      absorb_jobs: [{ status: 'waiting', created_at: '2026-11-19T00:00:00.000Z' }],
    });
    expect(s.pages.map((p) => p.raw_kind)).toEqual(['session', 'meeting', null]);
    expect(s.facts.map((f) => [f.unattributed, f.expired, f.source_category])).toEqual([[true, false, 'hook'], [true, true, 'sweep'], [false, false, 'model_write']]);
    expect(s.absorb_log[0]!.reason).toBe('gateway_rate_limit');
    expect(factSourceCategory('sync:import')).toBe('import');
  });
  test('the docker dump is offline, read-only mounted script, gbrain home at /brain', () => {
    const argv = dumpDockerArgs('harness-eval/gbrain:dev', '/x/brain', '1000:1000');
    expect(argv.slice(argv.indexOf('--network'), argv.indexOf('--network') + 2)).toEqual(['--network', 'none']);
    expect(argv).toContain('/x/brain:/brain');
    expect(argv.some((a) => a.endsWith('owner-identity-dump.ts:/he-dump/owner-identity-dump.ts:ro'))).toBe(true);
    expect(argv.join(' ')).not.toMatch(/API_KEY|TOKEN/);
  });
});

describe('the facts drain', () => {
  const since = '2026-11-19T10:00:00.000Z';
  test('gbrainLlmOn reads the cell field, off by default', () => {
    expect(gbrainLlmOn({ surface: 'starter' })).toBe(false);
    expect(gbrainLlmOn(undefined)).toBe(false);
    expect(gbrainLlmOn({ surface: 'starter', llm: 'proxy' } as never)).toBe(true);
  });
  test('waitFactsIdle waits out the quiet window and gives up at the timeout', async () => {
    let t = 0;
    const clock = { now: () => t, sleep: async (ms: number) => { t += ms; } };
    const seq = ['a', 'b', 'b', 'b', 'b', 'b', 'b', 'b', 'b', 'b', 'b'];
    let i = 0;
    const quiet = await waitFactsIdle({ probe: async () => ({ backlog: 0, signature: seq[Math.min(i++, seq.length - 1)]!, signals: ['get_stats'] }), quietMs: 6_000, pollMs: 2_000, ...clock });
    expect(quiet).toEqual({ idle: true, wait_ms: 8_000, polls: 5, signals: ['get_stats'] });
    t = 0;
    const busy = await waitFactsIdle({ probe: async () => ({ backlog: 1, signature: 'same', signals: [] }), timeoutMs: 10_000, quietMs: 1_000, pollMs: 2_000, ...clock });
    expect(busy.idle).toBe(false);
    expect(busy.wait_ms).toBe(10_000);
  });
  test('probeFactsIdle counts only the trial\'s queued jobs and skips tools that fail', async () => {
    const call = async (tool: string) => {
      if (tool === 'get_ingest_log') return [{ id: 1, source_type: 'facts:absorb' }, { id: 2, source_type: 'sync' }];
      if (tool === 'list_jobs') return { jobs: [{ id: 7, status: 'waiting', created_at: '2026-11-19T09:00:00.000Z' }, { id: 8, status: 'active', created_at: '2026-11-19T10:00:01.000Z' }] };
      throw new Error('not callable');
    };
    const p = await probeFactsIdle(call, since);
    expect(p.backlog).toBe(1);
    expect(p.signals).toEqual(['get_ingest_log', 'list_jobs']);
  });
  test('drainCounts and drainProblem: drops by reason, queued jobs time out, old jobs are the image\'s', () => {
    const s = store([], [row('people/dov-quarrel', 'x')]);
    s.absorb_log = [
      { id: 1, source_ref: 'a', reason: 'queue_overflow', summary: 'queue_overflow: x', created_at: '2026-11-19T10:00:05.000Z' },
      { id: 2, source_ref: 'b', reason: 'write_pending_accepted', summary: 'write_pending_accepted: y', created_at: '2026-11-19T10:00:06.000Z' },
      { id: 3, source_ref: 'c', reason: 'parse_failure', summary: 'parse_failure: z', created_at: '2026-11-19T09:00:00.000Z' },
    ];
    s.absorb_jobs = [{ status: 'completed', created_at: '2026-11-19T10:00:01.000Z' }, { status: 'dead', created_at: '2026-11-19T10:00:02.000Z' }, { status: 'waiting', created_at: '2026-11-19T10:00:03.000Z' }, { status: 'waiting', created_at: '2026-11-19T08:00:00.000Z' }];
    const c = drainCounts(s, since, 2);
    expect(c).toEqual({ drained: 3, dropped: { queue_overflow: 1, job_dead: 1 }, timed_out: 1, preexisting_backlog: 1, facts_rows: 1 });
    const d: TrialGbrainDrain = { queue_idle: true, wait_ms: 1, quiet_ms: 1, timeout_ms: 120_000, polls: 1, signals: [], cli_drain: 'ran', ...c, wall_ms: 1 };
    expect(drainProblem('t1', d)).toMatch(/^HE-GBRAIN-018 trial t1: 2 extraction job\(s\) dropped \(queue_overflow 1, job_dead 1\); 1 facts-absorb job\(s\) still queued/);
    expect(drainProblem('t1', { ...d, dropped: {}, timed_out: 0 })).toBeNull();
    expect(drainProblem('t1', { ...d, dropped: {}, timed_out: 0, queue_idle: false })).toMatch(/did not go quiet within 120 s/);
  });
  test('factsDrainPhase finds the phase in a dream --json document', () => {
    expect(factsDrainPhase({ report: { phases: [{ phase: 'lint' }, { phase: 'facts_drain', status: 'ok', details: { outcome: 'drained', completed: 3 } }] } })).toEqual({ outcome: 'drained', completed: 3 });
    expect(factsDrainPhase({ phases: [] })).toBeNull();
  });
  test('drainGbrain halts before copying, runs the CLI drain only with a queued trial job, writes the store', async () => {
    const trialDir = join(tmp, 'trial');
    const calls: string[] = [];
    let dumps = 0;
    const doc = (queued: boolean) => JSON.stringify({ gbrain_version: 'v', owner_member: null, pages: [], facts: [{ id: 1, entity_slug: 'people/ilsa-marrowby', fact: 'f', source: 'mcp:put_page' }], absorb_log: [], absorb_jobs: queued ? [{ status: 'waiting', created_at: '2026-11-19T10:00:09.000Z' }] : [{ status: 'completed', created_at: '2026-11-19T10:00:09.000Z' }] });
    const run = async (argv: string[]) => {
      calls.push(argv[0] === 'docker' ? `docker ${argv[1]}${argv.includes('-c') ? ' cli' : argv.some((a) => a.includes('owner-identity-dump')) ? ' dump' : ''}` : argv[0]!);
      if (argv[1] === 'cp') mkdirSync(join(argv[4]!, '.gbrain'), { recursive: true });
      if (argv.some((a) => a.includes('owner-identity-dump'))) return { status: 0, stdout: doc(dumps++ === 0), stderr: '' };
      if (argv.includes('-c')) return { status: 0, stdout: JSON.stringify({ phases: [{ phase: 'facts_drain', details: { outcome: 'drained', completed: 1 } }] }), stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const sidecar = { url: 'http://x', token: 't', image: 'harness-eval/gbrain:dev', container: 'he-gbrain-x', cliRunArgs: ['--user', '1:1', '--network', 'n'], cliEnv: [], halt: async () => { calls.push('halt'); } };
    const { record, store: s } = await drainGbrain({ sidecar, trialId: 't1', trialDir, since, log: () => undefined, quietMs: 0, pollMs: 1, run, callTool: async () => { throw new Error('none'); } });
    expect(calls).toEqual(['halt', 'docker cp', 'bash', 'docker run dump', 'docker run cli', 'docker run dump']);
    expect(record).toMatchObject({ queue_idle: true, cli_drain: 'ran', cli_outcome: 'drained', drained: 2, dropped: {}, timed_out: 0, facts_rows: 1, signals: [] });
    expect(s!.facts).toHaveLength(1);
    expect(existsSync(join(trialDir, 'owner-identity', 'store.json'))).toBe(true);
    expect(existsSync(join(trialDir, 'gbrain', 'brain-after'))).toBe(false);
    expect(DRAIN_DEFAULTS.timeoutMs).toBe(120_000);
  });
  test('a failed copy is a drain error, never a silent empty store', async () => {
    const run = async () => ({ status: 1, stdout: '', stderr: 'no such container' });
    const sidecar = { url: 'http://x', token: 't', image: 'i', container: 'c', cliRunArgs: [], cliEnv: [], halt: async () => undefined };
    const { record, store: s } = await drainGbrain({ sidecar, trialId: 't2', trialDir: join(tmp, 'trial2'), since, log: () => undefined, quietMs: 0, pollMs: 1, run, callTool: async () => null });
    expect(s).toBeNull();
    expect(record.error).toMatch(/docker cp of \/brain failed: no such container/);
    expect(drainProblem('t2', record)).toMatch(/^HE-GBRAIN-018/);
  });
});

describe('the pilot audit helper', () => {
  const verdictsFor = (arm: string, n: number) => gradeOwnerIdentity({ arm, people, gold: gold(Array.from({ length: n }, (_, i) => fact(`f${i}`, `Tokanel${String.fromCharCode(97 + (i % 26), 97 + Math.floor(i / 26))}`, i % 2 ? OWNER : 'dov-quarrel', i % 2 ? 'owner_recall' : 'false_owner'))), store: store([page('people/ilsa-marrowby', 'Tokanelaa | Tokanelba')]) });
  test('draws n per arm deterministically, with the deciding line, and scores a filled table', () => {
    const files = [{ file: 'g/t1/verdicts.json', verdicts: verdictsFor('G', 30) }, { file: 'g/t2/verdicts.json', verdicts: verdictsFor('G', 30) }, { file: 'n/t1/verdicts.json', verdicts: verdictsFor('N', 20) }];
    const a = drawAudit(files, 40, 's1');
    expect(a.filter((r) => r.arm === 'G')).toHaveLength(40);
    expect(a.filter((r) => r.arm === 'N')).toHaveLength(20);
    expect(drawAudit(files, 40, 's1')).toEqual(a);
    expect(drawAudit(files, 40, 's2')).not.toEqual(a);
    const hit = a.find((r) => r.fact === 'f0')!;
    expect(hit.grader).toBe('false_owner_hit yes');
    expect(hit.evidence).toContain('page:people/ilsa-marrowby#compiled_truth:1');
    const table = renderAudit(a, 's1', 40);
    const lines = table.split('\n');
    const filled = lines.map((l, i) => (l.startsWith('| ') && /^\| \d+ \|/.test(l) ? l.replace(/\|  \|  \|$/, i % 3 ? '| agree |  |' : '| disagree | wrong page |') : l)).join('\n');
    const score = scoreAudit(filled);
    const all = score.find((s) => s.arm === 'all')!;
    expect(all.rows).toBe(60);
    expect(all.filled).toBe(60);
    expect(all.agree + all.disagree).toBe(60);
    expect(score.map((s) => s.arm)).toEqual(['G', 'N', 'all']);
    expect(scoreAudit(table).find((s) => s.arm === 'all')!.filled).toBe(0);
  });
});
