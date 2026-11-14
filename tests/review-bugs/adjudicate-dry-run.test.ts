import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSheet, codeAt, firstObject, judgeRequest, loadBatch, pairStats, parseJudge, promptFor, readItems, runJudge, score, validateAnswer, type Transport } from '../../scripts/review-bugs/adjudicate-dry-run.ts';

const tmp = mkdtempSync(join(tmpdir(), 'adj-dry-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const dir = () => { const d = join(tmp, String(++n)); mkdirSync(d, { recursive: true }); return d; };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const FILE = 'packets/1.json';
const source = Array.from({ length: 80 }, (_, i) => 'line ' + (i + 1)).join('\n') + '\n';
const read = (path: string) => (path === 'src/a.ts' ? source : null);

/** A synthetic adjudication batch: one packet with two findings, its key and its evidence sheet. */
function fixture(known: unknown[] = []) {
  const d = dir();
  mkdirSync(join(d, 'packets', 'packets'), { recursive: true });
  const packet = JSON.stringify({ version: 1, kind: 'adjudicate', suite: 'synthetic', unit: { repo: 'example/repo', pr: 1, head: 'h'.repeat(40), base: 'b'.repeat(40) }, known_informational: known, findings: [{ id: 'F1', path: 'src/a.ts', line: 50, text: 'an invented finding' }, { id: 'F2', path: 'src/gone.ts', line: 3, text: 'another invented finding' }] }, null, 2) + '\n';
  const batch = 'batch-digest';
  writeFileSync(join(d, 'packets', FILE), packet);
  writeFileSync(join(d, 'packets', 'batch.json'), JSON.stringify({ version: 1, kind: 'adjudicate', batch, packets: [] }) + '\n');
  const key = join(d, 'key.json');
  writeFileSync(key, JSON.stringify({ version: 1, kind: 'adjudicate', batch, packets: [{ file: FILE, unit: 'example/repo#1', sha256: sha(packet) }], entries: [{ packet: FILE, opaque: 'F1' }, { packet: FILE, opaque: 'F2' }] }));
  const sheet = JSON.stringify({ version: 1, packet: FILE, packet_sha256: sha(packet), findings: [{ id: 'F1', evidence: 'invented', ...codeAt(read, 'src/a.ts', 50) }, { id: 'F2', evidence: 'invented', ...codeAt(read, 'src/gone.ts', 3) }] }, null, 2) + '\n';
  return { d, key, packetsDir: join(d, 'packets'), packet, sheet };
}

const reply = (findings: unknown[], extra: Record<string, unknown> = {}) => 'Here it is:\n' + '```json\n' + JSON.stringify({ batch: 'batch-digest', judge: 'x', packets: [{ file: FILE, sha256: 'x', findings, ...extra }] }) + '\n' + '```';

describe('inputs', () => {
  test('loadBatch reads a batch and refuses a packet that changed', () => {
    const f = fixture();
    const b = loadBatch(f.packetsDir, f.key);
    expect([...b.packets.keys()]).toEqual([FILE]);
    expect(b.packets.get(FILE)!.findings.map((x) => x.id)).toEqual(['F1', 'F2']);
    writeFileSync(join(f.packetsDir, FILE), f.packet.replace('invented finding', 'edited finding'));
    expect(() => loadBatch(f.packetsDir, f.key)).toThrow(/does not match the key/);
  });

  test('readItems refuses a duplicate and an unknown reference ruling', () => {
    const d = dir();
    writeFileSync(join(d, 'ok.tsv'), FILE + '\tF1\tdefect\n' + FILE + '\tF2\n');
    expect(readItems(join(d, 'ok.tsv'))).toEqual([{ packet: FILE, opaque: 'F1', reference: 'defect' }, { packet: FILE, opaque: 'F2', reference: null }]);
    writeFileSync(join(d, 'dup.tsv'), FILE + '\tF1\n' + FILE + '\tF1\n');
    expect(() => readItems(join(d, 'dup.tsv'))).toThrow(/listed twice/);
    writeFileSync(join(d, 'bad.tsv'), FILE + '\tF1\tmaybe\n');
    expect(() => readItems(join(d, 'bad.tsv'))).toThrow(/not one of/);
  });

  test('codeAt mirrors judge-run: 30 lines either side, the first 200 with no line, a note with no code', () => {
    const c = codeAt(read, 'src/a.ts', 50).code!;
    expect([c.from, c.to]).toEqual([20, 80]);
    expect(c.text.split('\n')[0]).toBe('20  line 20');
    expect(codeAt(read, 'src/a.ts', null).code!.to).toBe(80);
    expect(codeAt(read, 'src/a.ts', 99).code_note).toBe('line 99 is past the end of src/a.ts (80 lines) at the head');
    expect(codeAt(read, null, 1).code_note).toMatch(/names no file/);
    expect(codeAt(read, 'src/gone.ts', 3).code_note).toMatch(/is not a file in the repository/);
  });

  test('checkSheet binds the sheet to its packet and, with a clone, to the code at the head', () => {
    const f = fixture();
    const p = loadBatch(f.packetsDir, f.key).packets.get(FILE)!;
    expect(() => checkSheet(f.sheet, p, read)).not.toThrow();
    expect(() => checkSheet(f.sheet.replace('20  line 20', '20  line twenty'), p, read)).toThrow(/does not match the code at head/);
    expect(() => checkSheet(f.sheet.replace(p.sha256, 'x'.repeat(64)), p)).toThrow(/names another packet/);
  });
});

describe('requests and answers', () => {
  test('the prompt and request follow judge-run', () => {
    const f = fixture();
    const b = loadBatch(f.packetsDir, f.key);
    const prompt = promptFor('BRIEF', b, b.packets.get(FILE)!, f.sheet);
    expect(prompt.startsWith('=== Judge brief ===\nBRIEF\n=== Instructions: batch.json ===\n')).toBe(true);
    expect(prompt.indexOf('=== Packet: ' + FILE + ' ===')).toBeLessThan(prompt.indexOf('=== Evidence sheet: ' + FILE + ' ==='));
    expect(judgeRequest(parseJudge('openai:gpt-6-astra'), 'P')).toEqual({ model: 'gpt-6-astra', input: [{ role: 'user', content: 'P' }], store: false, max_output_tokens: 16000, reasoning: { effort: 'medium' } });
    expect(judgeRequest(parseJudge('anthropic:claude-opus-5-5'), 'P')).toEqual({ model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'P' }], max_tokens: 16000 });
    expect(() => parseJudge('gemini:carbon')).toThrow(/takes anthropic/);
  });

  test('firstObject reads the first JSON object around prose and fences', () => {
    expect(firstObject('note {"a": "}{", "b": {"c": 1}} trailing {"d": 2}')).toEqual({ a: '}{', b: { c: 1 } });
    expect(() => firstObject('no json')).toThrow(/no JSON object/);
  });

  test('validateAnswer keeps the extra fields and refuses what judge-run refuses', () => {
    const f = fixture();
    const p = loadBatch(f.packetsDir, f.key).packets.get(FILE)!;
    const ok = validateAnswer(reply([{ id: 'F1', ruling: 'defect', test: 'defect', lines: ['src/a.ts:50'] }, { id: 'F2', ruling: 'not-defect', test: 'unshown' }], { verifiable: { F1: true, F2: false } }), p);
    expect(typeof ok).not.toBe('string');
    expect((ok as any[]).map((r) => [r.id, r.ruling, r.verifiable, r.test])).toEqual([['F1', 'defect', true, 'defect'], ['F2', 'not-defect', false, 'unshown']]);
    expect(validateAnswer(reply([{ id: 'F1', ruling: 'defect' }]), p)).toMatch(/leaves 1 of the 2 findings unruled: F2/);
    expect(validateAnswer(reply([{ id: 'F9', ruling: 'defect' }]), p)).toMatch(/does not have/);
    expect(validateAnswer(reply([{ id: 'F1', ruling: 'maybe' }, { id: 'F2', ruling: 'defect' }]), p)).toMatch(/not one of/);
    expect(validateAnswer(reply([{ id: 'F1', ruling: 'known-informational' }, { id: 'F2', ruling: 'defect' }]), p)).toMatch(/no known informational case/);
    const k = fixture([{ id: 'B2' }]);
    const withCase = loadBatch(k.packetsDir, k.key).packets.get(FILE)!;
    expect(typeof validateAnswer(reply([{ id: 'F1', ruling: 'known-informational' }, { id: 'F2', ruling: 'defect' }]), withCase)).not.toBe('string');
  });
});

describe('agreement', () => {
  test('pairStats gives Cohen\'s kappa and the agreement table', () => {
    const p = pairStats('a', 'b', ['defect', 'defect', 'not-defect', 'not-defect'], ['defect', 'not-defect', 'not-defect', 'not-defect']);
    expect([p.n, p.agree, p.kappa]).toEqual([4, 3, 0.5]);
    expect(p.table.defect).toEqual({ defect: 1, 'not-defect': 1, 'known-informational': 0 });
  });

  test('score compares every pair of raters and the reference, counting a missing ruling as unruled', () => {
    const items = [{ packet: FILE, opaque: 'F1', reference: 'defect' }, { packet: FILE, opaque: 'F2', reference: 'not-defect' }];
    const pairs = score(items, [{ name: 'j1', rulings: new Map([[FILE + ' F1', 'defect'], [FILE + ' F2', 'not-defect']]) }, { name: 'j2', rulings: new Map([[FILE + ' F1', 'defect']]) }]);
    expect(pairs.map((p) => p.a + '/' + p.b)).toEqual(['j1/j2', 'j1/reference', 'j2/reference']);
    expect(pairs[1]!.kappa).toBe(1);
    expect(pairs[0]!.table['not-defect']!.unruled).toBe(1);
  });
});

describe('runJudge', () => {
  const good = reply([{ id: 'F1', ruling: 'defect' }, { id: 'F2', ruling: 'not-defect' }], { verifiable: { F1: true, F2: false } });
  const wrap = (provider: string, text: string) => JSON.stringify(provider === 'openai' ? { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] } : { content: [{ type: 'text', text }] });

  test('asks again once after a refused answer and writes the rulings', async () => {
    const f = fixture();
    const b = loadBatch(f.packetsDir, f.key);
    const out = dir();
    let calls = 0;
    const send: Transport = async (j) => ({ status: 200, text: wrap(j.provider, ++calls === 1 ? 'no json here' : good) });
    const r = await runJudge(parseJudge('anthropic:claude-opus-5-5'), 'BRIEF', b, new Map([[FILE, f.sheet]]), [FILE], out, send);
    expect([r.answered, r.requests, r.unjudged.length, r.refused]).toEqual([1, 2, 0, null]);
    expect(readFileSync(join(out, 'claude-opus-5-5', 'rulings.tsv'), 'utf8')).toBe('packet\topaque\truling\tverifiable\ttest\n' + FILE + '\tF1\tdefect\ttrue\t\n' + FILE + '\tF2\tnot-defect\tfalse\t\n');
  });

  test('a second refused answer leaves the packet unjudged', async () => {
    const f = fixture();
    const b = loadBatch(f.packetsDir, f.key);
    const send: Transport = async (j) => ({ status: 200, text: wrap(j.provider, 'still no json') });
    const r = await runJudge(parseJudge('openai:gpt-6-astra'), 'BRIEF', b, new Map([[FILE, f.sheet]]), [FILE], dir(), send);
    expect([r.answered, r.requests, r.unjudged.length]).toEqual([0, 2, 1]);
  });

  test('a cyber_policy refusal stops that judge and is reported as a refusal', async () => {
    const f = fixture();
    const b = loadBatch(f.packetsDir, f.key);
    const send: Transport = async () => ({ status: 400, text: JSON.stringify({ error: { code: 'cyber_policy', message: 'refused' } }) });
    const r = await runJudge(parseJudge('openai:gpt-6-astra'), 'BRIEF', b, new Map([[FILE, f.sheet]]), [FILE], dir(), send);
    expect(r.refused).toMatch(/^cyber_policy on packets\/1\.json/);
    expect(r.stopped).toBeNull();
  });
});
