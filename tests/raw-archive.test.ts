import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { applyBlock, block, checkIndex, dropReason, END, entryHead, INDEX_SCHEMA, pack, scan, START, strip, verifyDir } from '../scripts/archive/raw.ts';

const p = (...s: string[]) => s.join('');
const fakeAnthropic = p('sk-', 'ant-', 'api03-', 'A'.repeat(40));
const fakeGithub = p('gh', 's_', 'b'.repeat(36));
const fakeEnv = p('OPENAI', '_API_KEY=', 'c'.repeat(30));
const hasZstd = Bun.spawnSync(['sh', '-c', 'command -v zstd && command -v split']).exitCode === 0;

describe('strip', () => {
  test('redacts key shapes in text and names only the pattern', () => {
    const { out, hits } = strip(new TextEncoder().encode('a ' + fakeAnthropic + ' b ' + fakeGithub + '\n' + fakeEnv + '\nWintermute said hi'));
    const s = new TextDecoder().decode(out);
    expect(s).not.toContain(fakeAnthropic);
    expect(s).not.toContain(fakeGithub);
    expect(s).toContain('[REDACTED:anthropic]');
    expect(s).toContain('[REDACTED:personal]');
    expect(hits.anthropic).toBe(1);
    expect(hits.github_other).toBe(1);
    expect(hits.key_assignment).toBe(1);
    expect(Object.keys(scan(out))).toEqual([]);
  });
  test('masks binary files to the same length', () => {
    const data = new Uint8Array([0, 1, 2, ...new TextEncoder().encode(' ' + fakeAnthropic + ' '), 0]);
    const { out, hits } = strip(data);
    expect(out.length).toBe(data.length);
    expect(hits.anthropic).toBe(1);
    expect(Object.keys(scan(out))).toEqual([]);
  });
  test('a mask that makes a new match is masked again', () => {
    const data = new Uint8Array([0, ...new TextEncoder().encode('Authorization: Bearer ' + p('trial-', 'token:', 'abcdefghijklmnopqrstuv') + ' ')]);
    const { out, hits } = strip(data);
    expect(hits.run_token).toBe(1);
    expect(hits.bearer).toBe(1);
    expect(Object.keys(scan(out))).toEqual([]);
  });
  test('redacts run tokens and keeps reviewed placeholders', () => {
    const { out } = strip(new TextEncoder().encode(p('sk-', 'trial-', 'abc123def') + ' Bearer <token> ' + p('trial-', 'token:', 'r1-xyz789')));
    const s = new TextDecoder().decode(out);
    expect(s).toContain('[REDACTED:run_token]');
    expect(s).toContain('Bearer <token>');
    expect(s).not.toContain('abc123def');
  });
});

describe('drop rules', () => {
  test.each([
    ['grade/sealed/catalog/x.json', 'sealed'],
    ['ubi-state/vm.json', 'ssh'],
    ['internal-task/ubi-runner-state/vms.json', 'ssh'],
    ['home/.ssh/id_ed25519', 'ssh'],
    ['work/.env', 'credentials'],
    ['custody/identity.age-key', 'sealed'],
    ['set-r/turns.jsonl', 'set-r'],
    ['results/trials/openclaw-sonnet-mu-heldout/ho-03/turns.jsonl', 'sealed'],
    ['in/grade/payload/sealed-records/r.json', 'sealed'],
  ])('%s is dropped as %s', (path, name) => expect(dropReason(path)?.name).toBe(name));
  test('ordinary run paths are kept', () => {
    for (const path of ['grid/c1/vm/logs/ship.log', 'results/matrix-mu-2026-11/trials.jsonl', 'units/garrytan_gstack_3567/diff.patch']) expect(dropReason(path)).toBeNull();
  });
});

describe('tar entries', () => {
  test('long paths get a PAX record', () => {
    const parts = entryHead('a/'.repeat(80) + 'f.txt', 3, 0);
    expect(parts.length).toBe(4);
    expect(String.fromCharCode(parts[0]![156]!)).toBe('x');
  });
});

describe.skipIf(!hasZstd)('pack and verify', () => {
  test('strips, drops, expands and verifies a run tree', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'raw-archive-'));
    const src = join(dir, 'src');
    mkdirSync(join(src, 'logs'), { recursive: true });
    mkdirSync(join(src, 'sealed'), { recursive: true });
    mkdirSync(join(src, 'inner'), { recursive: true });
    writeFileSync(join(src, 'logs', 'proxy.log'), 'request with ' + fakeAnthropic + '\n');
    writeFileSync(join(src, 'logs', 'plain.txt'), 'nothing secret\n');
    writeFileSync(join(src, 'logs', 'capture.json.gz'), gzipSync('{"x-api-key": "' + 'd'.repeat(40) + '"}'));
    writeFileSync(join(src, 'sealed', 'task.json'), '{}');
    writeFileSync(join(src, 'inner', 'a.txt'), fakeGithub);
    Bun.spawnSync(['tar', '-c', '--zstd', '-f', join(src, 'trials.tar.zst'), '-C', join(src, 'inner'), 'a.txt']);
    symlinkSync('/etc/hostname', join(src, 'link'));
    const out = join(dir, 'out');
    const r = await pack({ runId: 'demo-run', sources: [{ path: src, as: 'run' }], out, excludes: [{ glob: 'inner/**', reason: 'duplicate of the expanded tarball' }], expandArchives: true, level: 3, partBytes: 1024 * 1024 });
    const m = JSON.parse(readFileSync(r.manifest, 'utf8'));
    expect(m.schema).toBe('harness-evals/raw-archive/1');
    expect(m.excluded.sealed.count).toBe(1);
    expect(m.excluded.symlink.count).toBe(1);
    expect(m.excluded['excluded:inner/**'].count).toBe(1);
    expect(m.redactions.anthropic.files).toBe(1);
    expect(m.redactions.auth_header.files).toBe(1);
    expect(m.redactions.github_other.files).toBe(1);
    const files = readFileSync(join(out, 'demo-run.files.jsonl.gz'));
    expect(files.length).toBeGreaterThan(0);
    const v = await verifyDir(out, 'demo-run', r.sha256);
    expect(v.ok).toBe(true);
    expect(v.files).toBe(4);
    expect(readdirSync(out).filter((f) => f.includes('.part-')).length).toBeGreaterThan(0);
    const bad = await verifyDir(out, 'demo-run', '0'.repeat(64)).catch((e: Error) => e.message);
    expect(String(bad)).toContain('does not match');
  });

  test('excludes corrupt and nested compressed files and withholds paths that hold a secret', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'raw-archive-'));
    const src = join(dir, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'broken.json.zst'), 'not zstd at all');
    writeFileSync(join(src, 'capture.txt.gz.gz'), gzipSync(gzipSync('token ' + fakeAnthropic)));
    writeFileSync(join(src, 'key-' + fakeGithub + '.txt'), 'plain');
    writeFileSync(join(src, 'ok.txt'), 'fine');
    writeFileSync(join(src, '.env-' + fakeGithub), 'x');
    symlinkSync('/etc/hostname', join(src, 'ln-' + fakeGithub));
    const inner = join(dir, 'inner');
    mkdirSync(inner);
    writeFileSync(join(inner, 'cap.json.gz'), gzipSync('{"x-api-key": "' + 'e'.repeat(40) + '"}'));
    Bun.spawnSync(['tar', '-c', '-f', join(dir, 'bundle.tar'), '-C', inner, 'cap.json.gz']);
    writeFileSync(join(src, 'bundle.gz'), gzipSync(readFileSync(join(dir, 'bundle.tar'))));
    const out = join(dir, 'out');
    const r = await pack({ runId: 'edge-run', sources: [{ path: src, as: 'run' }], out, excludes: [], expandArchives: true, level: 3, partBytes: 1024 * 1024 });
    const text = readFileSync(r.manifest, 'utf8');
    const m = JSON.parse(text);
    expect(m.excluded['compressed-unscannable'].count).toBe(1);
    expect(m.excluded['compressed-nested'].count).toBe(1);
    expect(m.excluded['secret-in-path'].count).toBe(3);
    expect(text).not.toContain(fakeGithub);
    expect(m.redactions.auth_header.files).toBe(1);
    const v = await verifyDir(out, 'edge-run', r.sha256);
    expect(v.ok).toBe(true);
    expect(v.files).toBe(2);
  });
});

describe('report block', () => {
  const e = { status: 'archived' as const, raw: [{ visibility: 'private' as const, manifest_url: 'https://github.com/garrytan/harness-evals/releases/download/raw-x/x.manifest.json', manifest_sha256: 'a'.repeat(64), bytes: 2e9, files: 10, parts: 2 }] };
  test('goes before Disclosures and is replaced in place', () => {
    const once = applyBlock('# R\n\n## Results\n\n## Disclosures\n\nD\n', block('x', e));
    expect(once.indexOf(START)).toBeLessThan(once.indexOf('## Disclosures'));
    const twice = applyBlock(once, block('x', { ...e, raw: [{ ...e.raw[0]!, files: 11 }] }));
    expect(twice.split(START).length).toBe(2);
    expect(twice).toContain('11 files');
    expect(twice).toContain(END);
  });
});

describe('docs/archive/index.json', () => {
  test('every run folder with results has an archive entry and an up-to-date report link', () => {
    expect(checkIndex()).toEqual([]);
  });

  test('refuses an other entry with a foreign URL, a bad sha256 or a short covers note', () => {
    const t = mkdtempSync(join(tmpdir(), 'raw-index-'));
    mkdirSync(join(t, 'docs/benchmarks'), { recursive: true });
    mkdirSync(join(t, 'docs/archive'), { recursive: true });
    const good = { visibility: 'private', manifest_url: 'https://github.com/garrytan/g-harness-evals/releases/download/raw-a/a.manifest.json', manifest_sha256: 'a'.repeat(64), bytes: 1, files: 1, parts: 1, covers: 'a drive folder of checkpoint files' };
    const other = { a: good, b: good, c: { ...good, manifest_url: 'https://example.com/releases/download/raw-c/c.manifest.json' }, d: { ...good, manifest_url: good.manifest_url.replace(/a\.manifest/, 'd.manifest'), manifest_sha256: 'abc' }, e: { ...good, manifest_url: good.manifest_url.replace(/a\.manifest/, 'e.manifest'), covers: 'short' } };
    writeFileSync(join(t, 'docs/archive/index.json'), JSON.stringify({ schema: INDEX_SCHEMA, runs: {}, other }));
    expect(checkIndex(t)).toEqual([
      "other b: manifest URL is not this archive's manifest in a release of this repository",
      "other c: manifest URL is not this archive's manifest in a release of this repository",
      'other d: sha256 must be 64 hex characters',
      'other e: needs a covers note of at least 20 characters',
    ]);
  });
});
