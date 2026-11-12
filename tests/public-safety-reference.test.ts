// The Claude Code reference shingles (scripts/public-safety/lib/reference.ts), shared by the private admission pack
// builder and the public export's reference-overlap gate, on synthetic repositories only.
//
// Value: protects=a file that holds a near-copy of the private reference text is found however it is laid out, and the
// reference is read from a commit the same way the pack builder reads a checkout; fails_when=a file sharing 20 distinct
// 8-word shingles with the reference is not counted at 20, a file sharing 19 is, a JSON-escaped copy is missed, a
// shingle a world/ file or another harness capture holds still counts, a user-role blob or a nested file is read as
// reference, the git reader and the checkout reader disagree, or a commit with no reference files yields reference
// text; why_new=the export caught the prompt only through three exact marker lines (internal-task); seam=lib/reference.ts on
// throwaway git repositories; no_claim=the export gate itself (tests/public-export-cli.test.ts, private repository
// only) and the pack (tests/private-admission-pack.test.ts).
import { afterAll, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { dropCommon, isReferencePath, overlap, PRESET_PROMPT, reference, referenceFiles, referenceFilesAt, referenceShingles, referenceTexts, SHINGLE_K, SHINGLE_THRESHOLD } from '../scripts/public-safety/lib/reference.ts';
import { repo } from './public-safety-fixture.ts';

const tmp = mkdtempSync(join(tmpdir(), 'he-public-safety-reference-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const word = () => 'w' + randomBytes(5).toString('hex');
const sentence = (n: number) => Array.from({ length: n }, word);
const CC = 'docs/harness-anatomy/receipts/anatomy-capture-claude-code-synth-20261101t000000/blobs/';
const PROMPT = sentence(60);
const QUOTED = ['He said "' + sentence(12).join(' ') + '"', ...Array.from({ length: 4 }, () => sentence(10).join(' '))].join('\n');
const PRESET = sentence(40);
const USER = sentence(40);
const COMMON = PROMPT.slice(0, 20);
const blob = (v: unknown) => gzipSync(Buffer.from(JSON.stringify(v)));

const src = repo(join(tmp, 'source'));
const SOURCE = src.commit({
  [CC + 'a.json.gz']: blob({ role: 'system', content: [{ type: 'text', text: PROMPT.join(' ') }, { type: 'text', text: QUOTED }] }),
  [CC + 'b.json']: JSON.stringify([{ type: 'text', text: PRESET.slice(0, 10).join(' ') + ' tail words are here' }]),
  [CC + 'c.json.gz']: blob({ role: 'user', content: [{ type: 'text', text: USER.join(' ') }] }),
  [CC + 'nested/d.json']: JSON.stringify({ role: 'system', content: USER.join(' ') }),
  [PRESET_PROMPT]: PRESET.join(' ') + '\n',
  'docs/harness-anatomy/receipts/anatomy-capture-hermes-synth-20261101t000000/blobs/e.json.gz': blob({ role: 'system', content: COMMON.join(' ') }),
}, 'synthetic source');
const env = src.env;
const gitDir = join(src.dir, '.git');

async function shared(staged: Record<string, string>, text: string) {
  const ref = referenceShingles(referenceTexts(await referenceFilesAt({ gitDir, env }, SOURCE)).texts);
  const s = repo(join(tmp, 'staged-' + randomBytes(4).toString('hex')));
  const commit = s.commit(staged, 'staged');
  const dropped = await dropCommon({ gitDir: join(s.dir, '.git'), env: s.env }, commit, ref);
  const set = new Set<string>();
  const first = overlap(text, reference(ref), set);
  return { count: set.size, first, dropped: dropped.dropped };
}

test('the reference is the system-role blobs directly inside a Claude Code capture\'s blobs/ and the preset prompt, read alike from git and from a checkout', async () => {
  expect(isReferencePath(CC + 'a.json.gz')).toBe(true);
  expect(isReferencePath(CC + 'nested/d.json')).toBe(false);
  expect(isReferencePath('docs/harness-anatomy/receipts/anatomy-capture-hermes-x/blobs/a.json')).toBe(false);
  expect(isReferencePath(PRESET_PROMPT)).toBe(true);
  const fromGit = referenceTexts(await referenceFilesAt({ gitDir, env }, SOURCE));
  const fromDisk = referenceTexts(referenceFiles(src.dir));
  expect(fromGit.blobs).toBe(3);
  expect(fromDisk.blobs).toBe(3);
  expect([...referenceShingles(fromGit.texts)].sort()).toEqual([...referenceShingles(fromDisk.texts)].sort());
  const all = fromGit.texts.join('\n');
  for (const w of USER) expect(all).not.toContain(w);
});

test('a commit with no reference file yields no reference text', async () => {
  const empty = repo(join(tmp, 'empty'));
  const c = empty.commit({ 'docs/methods.md': '# Methods\n' + sentence(40).join(' ') + '\n' }, 'no reference');
  expect(referenceTexts(await referenceFilesAt({ gitDir: join(empty.dir, '.git'), env: empty.env }, c))).toEqual({ texts: [], blobs: 0 });
});

test('a text sharing 20 distinct reference shingles counts 20, one sharing 19 counts 19, and the offset is the first shared word', async () => {
  const at20 = PROMPT.slice(30, 30 + SHINGLE_THRESHOLD + SHINGLE_K - 1).join(' ');
  const at19 = PROMPT.slice(30, 30 + SHINGLE_THRESHOLD + SHINGLE_K - 2).join(' ');
  const lead = 'unrelated words first\n';
  const r20 = await shared({ 'docs/x.md': 'x\n' }, lead + at20);
  expect(r20.count).toBe(SHINGLE_THRESHOLD);
  expect(r20.first).toBe(lead.length);
  expect((await shared({ 'docs/x.md': 'x\n' }, lead + at19)).count).toBe(SHINGLE_THRESHOLD - 1);
  expect((await shared({ 'docs/x.md': 'x\n' }, at20 + ' ' + at20.toUpperCase())).count).toBe(SHINGLE_THRESHOLD);
  expect((await shared({ 'docs/x.md': 'x\n' }, sentence(60).join(' '))).count).toBe(0);
});

test('a JSON-escaped copy, quotes and line breaks included, is found', async () => {
  const escaped = JSON.stringify({ system: QUOTED });
  expect(escaped).toContain('\\n');
  expect((await shared({ 'docs/x.md': 'x\n' }, escaped)).count).toBeGreaterThanOrEqual(SHINGLE_THRESHOLD);
  expect((await shared({ 'docs/x.md': 'x\n' }, JSON.stringify(JSON.stringify({ system: QUOTED })))).count).toBeGreaterThanOrEqual(SHINGLE_THRESHOLD);
});

test('shingles another harness capture or world/ also holds are dropped, so they never count', async () => {
  const text = PROMPT.slice(0, 40).join(' ');
  const plain = await shared({ 'docs/x.md': 'x\n' }, text);
  expect(plain.count).toBe(40 - SHINGLE_K + 1);
  const world = await shared({ 'world/notes.md': PROMPT.slice(0, 30).join(' ') + '\n' }, text);
  expect(world.count).toBe(40 - 30);
  const capture = await shared({ 'docs/harness-anatomy/receipts/anatomy-capture-hermes-x/blobs/a.json': JSON.stringify({ text: PROMPT.slice(0, 30).join(' ') }) }, text);
  expect(capture.count).toBe(40 - 30);
  const claude = await shared({ [CC + 'z.json']: JSON.stringify({ text: PROMPT.slice(0, 30).join(' ') }) }, text);
  expect(claude.count).toBe(plain.count);
});
