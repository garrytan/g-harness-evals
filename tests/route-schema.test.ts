/**
 * internal-task (H10) PR 1, the cross-PR route schema (harnesses/routes/README.md, docs/adapters.md "Route config"). Keyless, no
 * docker, no model call. Checks what later H10 PRs build against:
 *
 * 1. harnesses/routes/placebo.md is 289 bytes at its pinned sha256, and instruction.md is still the internal-task rule.
 * 2. parseRouteConfig accepts the grammar [<driver>+]<route>[@<slot_id>] and refuses a driver prefix off claude-code, unknown
 *    names and misplaced slot ids, with HE-ADAPTER-007.
 * 3. TurnWindow and RouteTurnStatus round-trip through JSON; committed turns.jsonl lines without the new fields still parse.
 * 4. scripts/routes/slot-check.ts accepts a fixture bundle and refuses each broken bundle in its refusals table (a symlink, a
 *    ".." path, an executable, a digest mismatch, a missing or wrong SKILL.md, a stray file, among others); its digest equals the sha256sum recipe the adapters use; every slot byte copy under harnesses/claude-code
 *    matches its source (vacuous until H10 PR 6).
 * 5. Every harnesses/<name>/provenance.json parses, names only files that exist, and lists exactly the files its Dockerfile
 *    copies under /opt/harness from the build context.
 *
 * Files under test: runner/contracts.ts, harnesses/routes/placebo.md,
 * harnesses/routes/instruction.md, harnesses/routes/README.md, scripts/routes/slot-check.ts,
 * harnesses/{openclaw,hermes,claude-code,codex}/provenance.json and Dockerfile.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRouteConfig, type HarnessProvenanceManifest, type RouteTurnStatus, type TurnWindow } from '../runner/contracts.ts';
import { bundleSha256, checkSlot } from '../scripts/routes/slot-check.ts';

const ROOT = join(import.meta.dir, '..');
const ROUTES = join(ROOT, 'harnesses', 'routes');
const INSTRUCTION_SHA256 = '4a81cb9b35d6ad6f205723618f15e6c3dc66586cbb41f0ebc72141b74669230f';
const PLACEBO_SHA256 = 'b66810fe132a2a9988100dcd01a9c8a03665265ff01555f17cd9b1955047dd34';
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const scratch = mkdtempSync(join(tmpdir(), 'route-schema-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('route texts', () => {
  test('placebo.md is 289 bytes, no trailing newline, at its pinned sha256, and the README pins the same sha256', () => {
    const placebo = readFileSync(join(ROUTES, 'placebo.md'));
    expect(placebo.length).toBe(289);
    expect(placebo[placebo.length - 1]).not.toBe(0x0a);
    expect(sha256(placebo)).toBe(PLACEBO_SHA256);
    expect(readFileSync(join(ROUTES, 'README.md'), 'utf8')).toContain(PLACEBO_SHA256);
  });
  test('instruction.md is still the internal-task rule, the same length as the placebo', () => {
    const instruction = readFileSync(join(ROUTES, 'instruction.md'));
    expect(sha256(instruction)).toBe(INSTRUCTION_SHA256);
    expect(instruction.length).toBe(289);
  });
});

describe('parseRouteConfig', () => {
  test('accepts the grammar', () => {
    expect(parseRouteConfig('route-hook', 'openclaw')).toEqual({ driver: 'cli', route: 'route-hook' });
    expect(parseRouteConfig('route-once', 'hermes')).toEqual({ driver: 'cli', route: 'route-once' });
    expect(parseRouteConfig('route-placebo', 'codex')).toEqual({ driver: 'cli', route: 'route-placebo' });
    expect(parseRouteConfig('sdk-preset+route-told', 'claude-code')).toEqual({ driver: 'sdk-preset', route: 'route-told' });
    expect(parseRouteConfig('sdk-default+route-skill', 'claude-code')).toEqual({ driver: 'sdk-default', route: 'route-skill' });
    expect(parseRouteConfig('sdk-preset+route-slot-told@x', 'claude-code')).toEqual({ driver: 'sdk-preset', route: 'route-slot-told', slot: 'x' });
    expect(parseRouteConfig('route-slot-skill@geva-2', 'codex')).toEqual({ driver: 'cli', route: 'route-slot-skill', slot: 'geva-2' });
    expect(parseRouteConfig('cli+route-system', 'claude-code')).toEqual({ driver: 'cli', route: 'route-system' });
    expect(parseRouteConfig('', 'openclaw')).toEqual({ driver: 'cli', route: 'default' });
    expect(parseRouteConfig('default', 'hermes')).toEqual({ driver: 'cli', route: 'default' });
  });
  test('refuses a driver prefix on any harness but claude-code', () => {
    for (const h of ['openclaw', 'hermes', 'codex', 'qm', '_fake']) {
      expect(() => parseRouteConfig('sdk-preset+route-hook', h)).toThrow(/^HE-ADAPTER-007 .*only claude-code/);
      expect(() => parseRouteConfig('cli+route-hook', h)).toThrow(/^HE-ADAPTER-007/);
    }
  });
  test('refuses unknown names and misplaced slot ids', () => {
    const bad: Array<[string, RegExp]> = [
      ['route-sytem', /no known route/], ['route-hook ', /no known route/], ['sdk+route-hook', /no known driver/],
      ['sdk-preset+', /no known route/], ['route-slot-told', /needs @<slot_id>/], ['route-slot-told@', /needs @<slot_id>/],
      ['route-slot-told@../x', /needs @<slot_id>/], ['route-slot-told@X', /needs @<slot_id>/], ['route-hook@x', /gives a slot id/],
      ['sdk-preset+sdk-default+route-hook', /no known route/], ['official-minimal', /no known route/],
    ];
    for (const [config, why] of bad) {
      expect(() => parseRouteConfig(config, 'claude-code')).toThrow(/^HE-ADAPTER-007 HE_HARNESS_CONFIG=/);
      expect(() => parseRouteConfig(config, 'claude-code')).toThrow(why);
    }
  });
});

describe('TurnWindow and RouteTurnStatus', () => {
  test('round-trip through JSON with the new fields', () => {
    const w: TurnWindow = {
      turn: 4, actor: 'pree', slack_user_id: 'U1', channel: 'C9', channel_name: 'site', channel_type: 'channel', text: 'hi',
      request_ts: '1730000000.000100', started_wall: '2026-11-01T00:00:00.000Z', ended_wall: '2026-11-01T00:00:05.000Z',
      started_seq: 10, ended_seq: 14, exit: 0, reply_ts: null, reply_text: null,
      thread_ts: '1730000000.000100', session_key: 'C9:1730000000.000100',
    };
    expect(JSON.parse(JSON.stringify(w)) as TurnWindow).toEqual(w);
    const s: RouteTurnStatus = { config: 'route-once', driver: 'cli', route: 'route-once', session_key: 'C9', session_turn: 2, emitted: false };
    expect(JSON.parse(JSON.stringify(s)) as RouteTurnStatus).toEqual(s);
    const t: RouteTurnStatus = { ...s, config: 'route-system', route: 'route-system', emitted: null };
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
  });
  test('committed turns.jsonl lines without the new fields still parse as TurnWindow', () => {
    const files = [
      'docs/benchmarks/2026-10-23-m2-pilot/results/trials/hermes-sonnet-mu-dev/ho-01-sev1-recap/r1/turns.jsonl',
    ];
    const latest = spawnSync('git', ['ls-files', 'docs/benchmarks/2026-10-31-anatomy-instruction-route'], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } })
      .stdout.split('\n').find((f) => f.endsWith('/turns.jsonl'));
    if (latest) files.push(latest);
    for (const f of files) {
      const lines = readFileSync(join(ROOT, f), 'utf8').split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const w = JSON.parse(line) as TurnWindow;
        expect(typeof w.turn).toBe('number');
        expect(typeof w.channel).toBe('string');
        expect([0, 2, 3, 124]).toContain(w.exit);
        expect(w.session_key).toBeUndefined();
      }
    }
  });
});

describe('slot-check', () => {
  const instruction = readFileSync(join(ROUTES, 'instruction.md'));
  /** A bundle as internal-task would hand it over: skill/<name>/SKILL.md carrying the rule, a reference file, slot.json last. */
  function fixture(name: string, edit?: (dir: string) => void): string {
    const dir = join(scratch, name, 'geva-fixture');
    mkdirSync(join(dir, 'skill', 'brain-first', 'references'), { recursive: true });
    const description = 'Check GBrain first, before answering any turn.';
    writeFileSync(join(dir, 'skill', 'brain-first', 'SKILL.md'), Buffer.concat([Buffer.from(`---\nname: brain-first\ndescription: ${description}\n---\n\n`), instruction, Buffer.from('\n')]));
    writeFileSync(join(dir, 'skill', 'brain-first', 'references', 'notes.md'), 'Reference notes.\n');
    const slot = { slot_id: 'geva-fixture', owner: 'internal-task', skill_name: 'brain-first', description, told_sentence: 'Use the brain-first skill.', bundle_sha256: '', source: 'garrytan/gstack-evals@0000000', notes: '' };
    slot.bundle_sha256 = bundleSha256(dir);
    writeFileSync(join(dir, 'slot.json'), JSON.stringify(slot, null, 2) + '\n');
    edit?.(dir);
    return dir;
  }
  test('accepts a fixture bundle, from the module and the CLI', () => {
    const dir = fixture('ok');
    expect(checkSlot(dir).slot_id).toBe('geva-fixture');
    const cli = spawnSync(process.execPath, [join(ROOT, 'scripts', 'routes', 'slot-check.ts'), dir], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
    expect(cli.status).toBe(0);
    expect(cli.stdout).toStartWith('ok geva-fixture ');
  });
  test('the digest equals the sha256sum recipe an adapter runs in its image', () => {
    const dir = fixture('recipe');
    const sh = spawnSync('bash', ['-c', "find . -type f ! -path ./slot.json | sed 's|^\\./||' | LC_ALL=C sort | xargs -d '\\n' sha256sum | sha256sum"], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
    expect(sh.status).toBe(0);
    expect(sh.stdout.split(' ')[0]).toBe(bundleSha256(dir));
  });
  const refusals: Array<[string, (dir: string) => void, RegExp]> = [
    ['symlink', (d) => symlinkSync('/etc/hostname', join(d, 'skill', 'brain-first', 'references', 'link.md')), /is a symlink/],
    ['dotdot', (d) => { const p = join(d, 'slot.json'); const s = JSON.parse(readFileSync(p, 'utf8')); s.skill_name = '../brain-first'; writeFileSync(p, JSON.stringify(s)); }, /"\.\." path/],
    ['exec', (d) => chmodSync(join(d, 'skill', 'brain-first', 'references', 'notes.md'), 0o755), /executable bit/],
    ['digest', (d) => writeFileSync(join(d, 'skill', 'brain-first', 'references', 'notes.md'), 'Changed.\n'), /bundle_sha256 .* does not match/],
    ['description', (d) => { const p = join(d, 'slot.json'); const s = JSON.parse(readFileSync(p, 'utf8')); s.description = 'x'.repeat(58); writeFileSync(p, JSON.stringify(s)); }, /at most 57 characters/],
    ['told', (d) => { const p = join(d, 'slot.json'); const s = JSON.parse(readFileSync(p, 'utf8')); s.told_sentence = 'y'.repeat(61); writeFileSync(p, JSON.stringify(s)); }, /at most 60 bytes/],
    ['size', (d) => writeFileSync(join(d, 'skill', 'brain-first', 'references', 'big.md'), 'z'.repeat(256 * 1024)), /over the 262144-byte cap/],
    ['backslash', (d) => writeFileSync(join(d, 'skill', 'brain-first', 'references', 'a\\b.md'), 'x\n'), /refused path/],
    ['stray', (d) => writeFileSync(join(d, 'extra.md'), 'x\n'), /files outside slot.json/],
    ['dirname', (d) => { const p = join(d, 'slot.json'); const s = JSON.parse(readFileSync(p, 'utf8')); s.slot_id = 'other'; writeFileSync(p, JSON.stringify(s)); }, /is not the directory name/],
    ['no-skill-md', (d) => rmSync(join(d, 'skill', 'brain-first', 'SKILL.md')), /has no skill\/brain-first\/SKILL\.md/],
    ['no-front-matter', (d) => writeFileSync(join(d, 'skill', 'brain-first', 'SKILL.md'), 'No front matter.\n'), /has no front matter/],
    ['fm-name', (d) => writeFileSync(join(d, 'skill', 'brain-first', 'SKILL.md'), '---\nname: other\ndescription: Check GBrain first, before answering any turn.\n---\n'), /front matter name is not brain-first/],
    ['fm-description', (d) => { const p = join(d, 'slot.json'); const s = JSON.parse(readFileSync(p, 'utf8')); s.description = 'Different.'; writeFileSync(p, JSON.stringify(s)); }, /front matter description/],
    ['extra-key', (d) => writeFileSync(join(d, 'skill', 'brain-first', 'SKILL.md'), Buffer.concat([Buffer.from('---\nname: brain-first\ndescription: Check GBrain first, before answering any turn.\ndisable-model-invocation: true\n---\n\n'), instruction])), /keys other than name and description: disable-model-invocation/],
    ['yaml-comment', (d) => {
      const p = join(d, 'slot.json'); const s = JSON.parse(readFileSync(p, 'utf8')); s.description = 'Check the brain # first'; writeFileSync(p, JSON.stringify(s));
      writeFileSync(join(d, 'skill', 'brain-first', 'SKILL.md'), Buffer.concat([Buffer.from('---\nname: brain-first\ndescription: Check the brain # first\n---\n\n'), instruction]));
    }, /front matter description is not/],
    ['invalid-yaml', (d) => writeFileSync(join(d, 'skill', 'brain-first', 'SKILL.md'), Buffer.concat([Buffer.from('---\nname: brain-first\ndescription: Check: first\n---\n\n'), instruction])), /front matter is not valid YAML/],
    ['rule-in-front-matter', (d) => writeFileSync(join(d, 'skill', 'brain-first', 'SKILL.md'), Buffer.concat([Buffer.from('---\nname: brain-first\ndescription: Check GBrain first, before answering any turn.\n# '), instruction, Buffer.from('\n---\n\nNo rule here.\n')])), /body does not carry the H10 rule bytes/],
    ['no-rule', (d) => writeFileSync(join(d, 'skill', 'brain-first', 'SKILL.md'), '---\nname: brain-first\ndescription: Check GBrain first, before answering any turn.\n---\n\nNo rule.\n'), /does not carry the H10 rule bytes/],
  ];
  for (const [name, edit, why] of refusals) {
    test(`refuses: ${name}`, () => {
      const dir = fixture(name, edit);
      expect(() => checkSlot(dir)).toThrow(/^HE-ADAPTER-007 slot bundle /);
      expect(() => checkSlot(dir)).toThrow(why);
      const cli = spawnSync(process.execPath, [join(ROOT, 'scripts', 'routes', 'slot-check.ts'), dir], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
      expect(cli.status).toBe(1);
      expect(cli.stderr).toStartWith('HE-ADAPTER-007 ');
    });
  }
  test('every slot byte copy under harnesses/claude-code/routes/slots/ matches its source bundle (vacuous until H10 PR 6)', () => {
    const copies = join(ROOT, 'harnesses', 'claude-code', 'routes', 'slots');
    const ids = existsSync(copies) ? readdirSync(copies).filter((n) => statSync(join(copies, n)).isDirectory()) : [];
    for (const id of ids) {
      const source = join(ROUTES, 'slots', id);
      const slot = checkSlot(source);
      expect(bundleSha256(join(copies, id))).toBe(slot.bundle_sha256);
      expect(readFileSync(join(copies, id, 'slot.json'))).toEqual(readFileSync(join(source, 'slot.json')));
    }
  });
});

describe('provenance manifests', () => {
  const HARNESSES = ['openclaw', 'hermes', 'claude-code', 'codex'];
  const filesUnder = (dir: string, rel = ''): string[] => readdirSync(join(dir, rel)).flatMap((n) => {
    const p = rel ? `${rel}/${n}` : n;
    return statSync(join(dir, p)).isDirectory() ? filesUnder(dir, p) : [p];
  });
  /** Every {checkout, image} pair a Dockerfile's COPY or ADD from the build context puts under /opt/harness. */
  function dockerfileCopies(h: string): Array<{ checkout: string; image: string }> {
    const ctx = join(ROOT, 'harnesses', h);
    const text = readFileSync(join(ctx, 'Dockerfile'), 'utf8').replace(/\\\n/g, ' ');
    const out: Array<{ checkout: string; image: string }> = [];
    for (const line of text.split('\n')) {
      const m = /^\s*(COPY|ADD)\s+(.*)$/i.exec(line);
      if (!m) continue;
      const words = m[2].trim().split(/\s+/);
      if (words.some((w) => w.startsWith('--from'))) continue;
      const args = words.filter((w) => !w.startsWith('--'));
      const dest = args.pop()!;
      if (!dest.startsWith('/opt/harness')) continue;
      for (const src of args) {
        const abs = join(ctx, src);
        if (statSync(abs).isDirectory()) {
          for (const f of filesUnder(abs)) out.push({ checkout: `harnesses/${h}/${join(src, f)}`, image: join(dest, f) });
        } else {
          out.push({ checkout: `harnesses/${h}/${src}`, image: dest.endsWith('/') ? join(dest, src.split('/').pop()!) : dest });
        }
      }
    }
    return out.sort((a, b) => a.checkout.localeCompare(b.checkout));
  }
  for (const h of HARNESSES) {
    test(`${h}: provenance.json parses, names existing files, and matches the Dockerfile's /opt/harness copies`, () => {
      const m = JSON.parse(readFileSync(join(ROOT, 'harnesses', h, 'provenance.json'), 'utf8')) as HarnessProvenanceManifest;
      expect(m.harness).toBe(h);
      expect(Array.isArray(m.files)).toBe(true);
      for (const f of m.files) {
        expect(Object.keys(f).sort()).toEqual(['checkout', 'image']);
        expect(f.checkout.startsWith(`harnesses/${h}/`)).toBe(true);
        expect(f.checkout.split('/')).not.toContain('..');
        expect(statSync(join(ROOT, f.checkout)).isFile()).toBe(true);
        expect(f.image.startsWith('/opt/harness/')).toBe(true);
      }
      const listed = [...m.files].sort((a, b) => a.checkout.localeCompare(b.checkout));
      expect(listed).toEqual(dockerfileCopies(h));
      expect(new Set(m.files.map((f) => f.image)).size).toBe(m.files.length);
    });
  }
});
