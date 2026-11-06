// internal-task (H10) PR 5: harness provenance from harnesses/<name>/provenance.json (runner/trial/provenance.ts). Keyless. The
// checkout side runs everywhere; the image side builds a small fixture image from busybox (skipped without a docker daemon or
// the base image): a clean build passes with an installed runtime present beside the listed files, and a changed or missing
// listed file is refused with HE-ADAPTER-005.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkoutProvenance, harnessProvenance, provenanceDigest, readProvenanceManifest } from '../runner/trial/provenance.ts';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'he-provenance-'));
const IMAGE = `harness-eval/provfix:test-${process.pid}`;
const cleanEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? tmp };
afterAll(() => { spawnSync('docker', ['rmi', '-f', IMAGE], { stdio: 'ignore', env: cleanEnv }); rmSync(tmp, { recursive: true, force: true }); });
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** A fixture checkout: harnesses/provfix with an adapter, a config file, a pin, a Dockerfile and a provenance manifest. */
function fixture(name: string, files: Array<{ checkout: string; image: string }> | null = null): string {
  const root = join(tmp, name);
  const h = join(root, 'harnesses', 'provfix');
  mkdirSync(join(h, 'config'), { recursive: true });
  writeFileSync(join(h, 'adapter.sh'), '#!/bin/sh\necho adapter\n');
  writeFileSync(join(h, 'config', 'a.json'), '{"a": 1}\n');
  writeFileSync(join(h, 'pin.json'), '{"version": "1.0.0"}\n');
  writeFileSync(join(h, 'Dockerfile'), 'FROM busybox:1.37\nCOPY adapter.sh /opt/harness/adapter.sh\nCOPY config/ /opt/harness/config/\nCOPY pin.json /opt/harness/pin.json\nRUN mkdir -p /opt/harness/node_modules/runtime && echo installed > /opt/harness/node_modules/runtime/index.js\n');
  const listed = files ?? [
    { checkout: 'harnesses/provfix/adapter.sh', image: '/opt/harness/adapter.sh' },
    { checkout: 'harnesses/provfix/config/a.json', image: '/opt/harness/config/a.json' },
    { checkout: 'harnesses/provfix/pin.json', image: '/opt/harness/pin.json' },
  ];
  writeFileSync(join(h, 'provenance.json'), JSON.stringify({ harness: 'provfix', files: listed }, null, 2) + '\n');
  return root;
}

describe('the checkout side', () => {
  test('every harness manifest in the repository lists files the checkout has, and its digest is over their sha256', () => {
    for (const harness of ['openclaw', 'hermes', 'claude-code', 'codex']) {
      const p = checkoutProvenance(harness, ROOT)!;
      expect(p.files.length).toBe(readProvenanceManifest(harness, ROOT)!.files.length);
      for (const f of p.files) expect(f.sha256).toBe(sha(join(ROOT, f.checkout)));
      expect(p.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(provenanceDigest([...p.files].reverse())).toBe(p.digest);
    }
  });
  test('the digest is the sha256 of the sorted sha256sum listing of the image paths', () => {
    const files = [{ image: '/opt/harness/b', sha256: 'b'.repeat(64) }, { image: '/opt/harness/a', sha256: 'a'.repeat(64) }];
    expect(provenanceDigest(files)).toBe(createHash('sha256').update(`${'a'.repeat(64)}  /opt/harness/a\n${'b'.repeat(64)}  /opt/harness/b\n`).digest('hex'));
  });
  test('a harness without a manifest has no checkout provenance; a listed file the checkout lacks, or a bad manifest, is HE-ADAPTER-005', () => {
    expect(checkoutProvenance('qm', ROOT)).toBeNull();
    const root = fixture('missing-in-checkout', [{ checkout: 'harnesses/provfix/routes/gone.md', image: '/opt/harness/routes/gone.md' }]);
    expect(() => checkoutProvenance('provfix', root)).toThrow(/^HE-ADAPTER-005 harnesses\/provfix\/provenance.json lists harnesses\/provfix\/routes\/gone.md/);
    const bad = fixture('bad-manifest', [{ checkout: 'harnesses/provfix/adapter.sh', image: '/etc/adapter.sh' }]);
    expect(() => checkoutProvenance('provfix', bad)).toThrow(/^HE-ADAPTER-005 .* is not a provenance manifest/);
  });
});

const haveDocker = spawnSync('docker', ['info'], { stdio: 'ignore', env: cleanEnv }).status === 0;
const haveBase = haveDocker && (spawnSync('docker', ['image', 'inspect', 'busybox:1.37'], { stdio: 'ignore', env: cleanEnv }).status === 0
  || spawnSync('docker', ['pull', '-q', 'busybox:1.37'], { stdio: 'ignore', env: cleanEnv }).status === 0);
const build = (root: string) => { const b = spawnSync('docker', ['build', '-q', '-t', IMAGE, join(root, 'harnesses', 'provfix')], { encoding: 'utf8', env: cleanEnv }); expect(b.status, b.stderr).toBe(0); };

describe.skipIf(!haveBase)('the image side, against a fixture image', () => {
  test('a clean build passes with an installed runtime beside the listed files; the image id is a receipt', async () => {
    const root = fixture('clean');
    build(root);
    const p = await harnessProvenance('provfix', IMAGE, root);
    expect(p.check).toBe('manifest');
    expect(p.files.map((f) => f.image)).toEqual(['/opt/harness/adapter.sh', '/opt/harness/config/a.json', '/opt/harness/pin.json']);
    expect(p.digest).toBe(checkoutProvenance('provfix', root)!.digest);
    expect(p.image_id).toMatch(/^sha256:[0-9a-f]{64}$/);
  }, 120_000);
  test('a listed file changed in the checkout after the build is refused, naming the file and both digests', async () => {
    const root = fixture('changed');
    build(root);
    writeFileSync(join(root, 'harnesses', 'provfix', 'config', 'a.json'), '{"a": 2}\n');
    await expect(harnessProvenance('provfix', IMAGE, root)).rejects.toThrow(/^HE-ADAPTER-005 harness image .* changed: \/opt\/harness\/config\/a.json is [0-9a-f]{12} in the image and harnesses\/provfix\/config\/a.json is [0-9a-f]{12}.*fix: docker build/);
  }, 120_000);
  test('a listed file the image does not carry is refused as missing', async () => {
    const root = fixture('missing-in-image');
    build(root);
    mkdirSync(join(root, 'harnesses', 'provfix', 'routes'), { recursive: true });
    writeFileSync(join(root, 'harnesses', 'provfix', 'routes', 'instruction.md'), 'rule');
    const m = JSON.parse(readFileSync(join(root, 'harnesses', 'provfix', 'provenance.json'), 'utf8'));
    m.files.push({ checkout: 'harnesses/provfix/routes/instruction.md', image: '/opt/harness/routes/instruction.md' });
    writeFileSync(join(root, 'harnesses', 'provfix', 'provenance.json'), JSON.stringify(m));
    await expect(harnessProvenance('provfix', IMAGE, root)).rejects.toThrow(/^HE-ADAPTER-005 .*missing from the image: \/opt\/harness\/routes\/instruction.md/);
  }, 120_000);
  test('without a manifest the adapter.sh check still runs; an absent image is refused', async () => {
    const root = fixture('no-manifest');
    build(root);
    rmSync(join(root, 'harnesses', 'provfix', 'provenance.json'));
    const p = await harnessProvenance('provfix', IMAGE, root);
    expect(p.check).toBe('adapter');
    expect(p.files).toEqual([{ checkout: 'harnesses/provfix/adapter.sh', image: '/opt/harness/adapter.sh', sha256: sha(join(root, 'harnesses', 'provfix', 'adapter.sh')) }]);
    await expect(harnessProvenance('provfix', 'harness-eval/provfix:absent', fixture('absent'))).rejects.toThrow(/^HE-ADAPTER-005 harness image harness-eval\/provfix:absent is not present/);
  }, 120_000);
});
