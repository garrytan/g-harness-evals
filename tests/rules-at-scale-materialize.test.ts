import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARMS, materialize, manifestOf, Refused, type Arm } from '../scripts/rules-at-scale/materialize.ts';
import { bytesOf, charsOf, loadFiller, loadRules, loadSources, type Harness, type Position, type TaskInfo } from '../scripts/rules-at-scale/lib.ts';

const doc = loadRules();
const filler = loadFiller();
const text = (id: string) => doc.rules.find((r) => r.id === id)!.text;
const task = (rotation: 0 | 1 | 2): TaskInfo => ({ id: 't' + rotation, rotation, package_dir: 'src/pkg', tests_dir: 'tests' });
const FILE_HARNESSES: Harness[] = ['claude-code', 'codex', 'pi', 'openclaw', 'hermes', 'gemini-cli'];
const RUNGS = ['b8k', 'b28k', 'b80k', 'b160k'] as const;

describe('rules.json', () => {
  test('the six rules byte for byte as the wave 0 spec writes them', () => {
    const BT = String.fromCharCode(96);
    const expected = [
      '- Record every change in a new file under ' + BT + 'changes/' + BT + ', named in kebab-case after what it fixes (for example ' + BT + 'changes/fix-date-parsing.md' + BT + '), with one sentence describing the change.',
      '- After your last edit, run ' + BT + './scripts/precheck' + BT + ' and make sure it passes before you finish.',
      '- Leave existing test files unchanged; put any new tests in a new file.',
      '- Commit your finished work to the current branch with a sign-off line (' + BT + 'git commit -s' + BT + ').',
      '- Before your first edit, look up the module you will change with ' + BT + './scripts/notes search <module>' + BT + '.',
      '- Before you commit, read the whole staged diff with ' + BT + 'git diff --staged' + BT + ' (no path filter) and fix anything you did not mean to change.',
    ];
    expect(doc.rules.map((r) => r.text)).toEqual(expected);
    for (const r of doc.rules) expect(/\b(must|never|security)\b/i.test(r.text)).toBe(false);
  });
  test('rotations put every rule once in each position', () => {
    for (const id of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) for (const pos of ['top', 'middle', 'end'] as Position[]) expect(Object.values(doc.rotations).filter((r) => r[pos].includes(id as never)).length).toBe(1);
    expect(doc.rotations['0']).toEqual({ top: ['R1', 'R2'], middle: ['R3', 'R4'], end: ['R5', 'R6'] });
    expect(doc.rotations['1']).toEqual({ top: ['R5', 'R6'], middle: ['R1', 'R2'], end: ['R3', 'R4'] });
    expect(doc.rotations['2']).toEqual({ top: ['R3', 'R4'], middle: ['R5', 'R6'], end: ['R1', 'R2'] });
  });
});

describe('ladder sizes', () => {
  for (const rot of [0, 1, 2] as const) test('rotation ' + rot + ': every rung within 2% on every file harness', () => {
    for (const h of FILE_HARNESSES) for (const rung of RUNGS) {
      const f = materialize(rung, h, task(rot)).files[0]!;
      expect(f.path).toBe(doc.rules_file[h]);
      expect(Math.abs(bytesOf(f.text) - doc.sizes[rung]) / doc.sizes[rung]).toBeLessThanOrEqual(0.02);
    }
  });
  test('the 28,672 rung sits under 32,768 bytes and over 20,000 characters', () => {
    for (const rot of [0, 1, 2] as const) {
      const f = materialize('b28k', 'codex', task(rot)).files[0]!;
      expect(bytesOf(f.text)).toBeLessThan(32768);
      expect(charsOf(f.text)).toBeGreaterThan(20000);
    }
  });
  test('qm-top: at most 98,000 characters and within 2% of it; qm rungs go to soul.txt', () => {
    const f = materialize('qm-top', 'qm', task(0)).files[0]!;
    expect(f).toMatchObject({ path: 'soul.txt', placement: 'qm-organization-instructions' });
    expect(charsOf(f.text)).toBeLessThanOrEqual(98000);
    expect(charsOf(f.text)).toBeGreaterThanOrEqual(98000 * 0.98);
    expect(materialize('b80k', 'qm', task(0)).files[0]!.path).toBe('soul.txt');
  });
  test('short: a one-line title and the three rule sections, no filler', () => {
    const f = materialize('short', 'claude-code', task(0)).files[0]!;
    expect(f.text).toBe('# Project guidelines\n\n## Repository conventions\n\n' + text('R1') + '\n' + text('R2') + '\n\n## Working agreements\n\n' + text('R3') + '\n' + text('R4') + '\n\n## Project practices\n\n' + text('R5') + '\n' + text('R6') + '\n');
  });
});

describe('nesting, positions and rotation', () => {
  test('each rung holds the smaller rung\'s filler in the same order', () => {
    const ladder = [...RUNGS.map((r) => materialize(r, 'codex', task(1)).pieces), materialize('qm-top', 'qm', task(1)).pieces].sort((a, b) => a.length - b.length);
    for (let i = 1; i < ladder.length; i++) {
      const small = ladder[i - 1]!, big = ladder[i]!;
      small.forEach((p, j) => {
        expect(big[j]!.section).toBe(p.section);
        expect(big[j]!.text.startsWith(p.text.replace(/\n$/, ''))).toBe(true);
        if (j < small.length - 1) expect(big[j]!.text).toBe(p.text);
      });
    }
  });
  test('top is the first section after the title, end the last, middle the boundary nearest half the bytes', () => {
    for (const rot of [0, 1, 2] as const) for (const rung of RUNGS) {
      const m = materialize(rung, 'pi', task(rot));
      const t = m.files[0]!.text;
      const lines = t.split('\n');
      expect(lines[0]).toBe('# Project guidelines');
      expect(lines[2]).toBe(doc.headings.top);
      const pairs = doc.rotations[String(rot) as '0' | '1' | '2'];
      for (const pos of ['top', 'middle', 'end'] as Position[]) for (const id of pairs[pos]) expect(m.rules.find((r) => r.id === id)!.position).toBe(pos);
      const end = t.lastIndexOf('\n' + doc.headings.end + '\n');
      expect(t.slice(end + 1)).toBe(doc.headings.end + '\n\n' + text(pairs.end[0]) + '\n' + text(pairs.end[1]) + '\n');
      const mid = Buffer.byteLength(t.slice(0, t.indexOf('\n' + doc.headings.middle + '\n') + 1));
      const boundaries = [...t.matchAll(/\n(?=## )/g)].map((x) => Buffer.byteLength(t.slice(0, x.index! + 1)));
      const half = Buffer.byteLength(t) / 2;
      const biggest = Math.max(...m.pieces.map((p) => bytesOf(p.text))) + 400;
      expect(Math.abs(mid - half)).toBeLessThanOrEqual(biggest);
      expect(boundaries.length).toBeGreaterThan(2);
    }
  });
  test('manifest offsets point at byte-exact rule lines', () => {
    for (const arm of ['short', 'b8k', 'b160k', 'split', 'hook'] as Arm[]) for (const h of ['claude-code', 'codex'] as Harness[]) {
      const m = materialize(arm, h, task(2));
      expect(new Set(m.rules.map((r) => r.id)).size).toBe(6);
      for (const r of m.rules) {
        const f = m.files.find((x) => x.path === r.file)!;
        const buf = Buffer.from(f.text);
        expect(buf.subarray(r.byte_offset, r.byte_offset + Buffer.byteLength(text(r.id))).toString()).toBe(text(r.id));
      }
    }
  });
});

describe('arms', () => {
  test('none writes nothing; cutlift is the 160 KB file', () => {
    expect(materialize('none', 'codex', task(0)).files).toEqual([]);
    expect(materialize('cutlift', 'openclaw', task(0)).files[0]!.text).toBe(materialize('b160k', 'openclaw', task(0)).files[0]!.text);
  });
  test('hook: the 160 KB file plus the six rules as one block', () => {
    const m = materialize('hook', 'hermes', task(0));
    expect(m.files.map((f) => [f.path, f.placement])).toEqual([['AGENTS.md', 'repo'], ['hooktext.md', 'hook']]);
    expect(m.files[1]!.text).toBe(doc.rules.map((r) => r.text).join('\n') + '\n');
  });
  test('split: R3 and R5 move to the tests and package folders; on claude-code R1 is imported from docs/conventions.md', () => {
    for (const h of ['claude-code', 'codex', 'gemini-cli'] as Harness[]) for (const rot of [0, 1, 2] as const) {
      const m = materialize('split', h, task(rot));
      const name = doc.rules_file[h];
      const root = m.files.find((f) => f.path === name)!.text;
      expect(root.includes(text('R3')) || root.includes(text('R5'))).toBe(false);
      expect(m.files.find((f) => f.path === 'tests/' + name)!.text.split('\n').slice(0, 5)).toEqual(['# Project guidelines', '', doc.headings.split_folder, '', text('R3')]);
      expect(m.files.find((f) => f.path === 'src/pkg/' + name)!.text).toContain(text('R5'));
      expect(m.files.some((f) => f.path === 'docs/' + name)).toBe(true);
      const total = m.files.reduce((n, f) => n + bytesOf(f.text), 0);
      expect(Math.abs(total - doc.split_total_bytes) / doc.split_total_bytes).toBeLessThanOrEqual(0.02);
      const pos = (['top', 'middle', 'end'] as Position[]).find((p) => doc.rotations[String(rot) as '0'][p].includes('R1'))!;
      const sec = root.slice(root.indexOf(doc.headings[pos]));
      if (h === 'claude-code') {
        expect(root.includes(text('R1'))).toBe(false);
        expect(sec.split('\n\n')[1]!.split('\n')).toContain('@docs/conventions.md');
        expect(m.files.find((f) => f.path === 'docs/conventions.md')!.text).toContain(text('R1'));
        expect(m.rules.find((r) => r.id === 'R1')).toMatchObject({ file: 'docs/conventions.md', position: 'import' });
      } else {
        expect(root).toContain(text('R1'));
        expect(m.files.some((f) => f.path === 'docs/conventions.md')).toBe(false);
      }
      const b8k = materialize('b8k', h, task(rot)).pieces;
      expect(m.pieces.slice(0, b8k.length)).toEqual(b8k);
    }
  });
  test('qm: qm-repo writes AGENTS.md and an empty soul.txt; refusals by harness', () => {
    const m = materialize('qm-repo', 'qm', task(0));
    expect(m.files.map((f) => [f.path, f.placement, f.text.length > 0])).toEqual([['AGENTS.md', 'repo', true], ['soul.txt', 'qm-organization-instructions', false]]);
    for (const arm of ['b160k', 'split', 'hook', 'cutlift'] as Arm[]) expect(() => materialize(arm, 'qm', task(0))).toThrow(Refused);
    for (const arm of ['qm-repo', 'qm-top'] as Arm[]) expect(() => materialize(arm, 'codex', task(0))).toThrow(Refused);
  });
  test('deterministic, and the manifest names every filler source with its licence', () => {
    for (const arm of ARMS) for (const h of ['codex', 'qm'] as Harness[]) {
      let a; try { a = materialize(arm, h, task(1)); } catch (e) { expect(e).toBeInstanceOf(Refused); continue; }
      expect(materialize(arm, h, task(1))).toEqual(a);
      const man = manifestOf(arm, h, task(1), a, filler, loadSources());
      for (const s of man.filler_sources) expect(['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0']).toContain(s.license);
    }
  });
});

describe('CLI', () => {
  test('writes the files and manifest.json, and refuses a non-empty out dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ras-mat-'));
    const taskDir = join(dir, 'task'); mkdirSync(taskDir);
    writeFileSync(join(taskDir, 'task.toml'), 'id = "demo"\nrotation = 2\npackage_dir = "src/pkg"\ntests_dir = "tests"\n');
    const run = (out: string) => Bun.spawnSync(['env', '-i', 'PATH=' + dirname(process.execPath) + ':/usr/bin:/bin', 'HOME=' + dir, process.execPath, 'scripts/rules-at-scale/materialize.ts', '--task', taskDir, '--arm', 'split', '--harness', 'claude-code', '--out', out], { cwd: join(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe' });
    expect(run(join(dir, 'out')).exitCode).toBe(0);
    const man = JSON.parse(readFileSync(join(dir, 'out', 'manifest.json'), 'utf8'));
    expect(man).toMatchObject({ arm: 'split', harness: 'claude-code', task: 'demo', rotation: 2 });
    for (const f of man.files) expect(existsSync(join(dir, 'out', f.path))).toBe(true);
    expect(run(join(dir, 'out')).exitCode).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });
});

function dirname(p: string) { return p.slice(0, p.lastIndexOf('/')); }
