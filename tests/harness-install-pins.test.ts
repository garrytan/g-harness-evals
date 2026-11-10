import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (path: string) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
type Lock = { lockfileVersion: number; packages: Record<string, { version?: string; integrity?: string; dependencies?: Record<string, string>; link?: boolean }> };

// Value: protects=the DeepSeek Harness and Pi install manifests install only the reviewed tree: package.json asks for one
// package at an exact version, package-lock.json locks that version, and every locked package carries a sha512 integrity,
// so npm ci in the image can't resolve anything else; fails_when=package.json or the lockfile is bumped without the other,
// a range replaces the exact version, or a lock entry loses its integrity; why_new=the manifests land before their adapters,
// whose own tests cover the image and the turn; seam=the committed JSON files only; no_claim=that the image builds or runs.
for (const files of [
  { harness: 'dsh', pkg: 'harnesses/dsh/package.json', lock: 'harnesses/dsh/package-lock.json' },
  { harness: 'pi', pkg: 'harnesses/pi/package.json', lock: 'harnesses/pi/package-lock.json' },
]) {
  describe(`harnesses/${files.harness} install manifest`, () => {
    test('package.json pins one package at an exact version, and package-lock.json locks it and every package by sha512', () => {
      const deps = read(files.pkg).dependencies as Record<string, string>;
      expect(Object.keys(deps)).toHaveLength(1);
      const [name, version] = Object.entries(deps)[0];
      expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/);
      const lock = read(files.lock) as Lock;
      expect(lock.lockfileVersion).toBe(3);
      expect(lock.packages[''].dependencies).toEqual(deps);
      expect(lock.packages['node_modules/' + name].version).toBe(version);
      const unpinned = Object.entries(lock.packages).filter(([k, p]) => k !== '' && !p.link && !/^sha512-/.test(p.integrity ?? '')).map(([k]) => k);
      expect(unpinned).toEqual([]);
    });
  });
}

// Value: protects=dsh's pin.json records the same package, version and npm integrity package-lock.json installs;
// fails_when=one of them is bumped alone; why_new=as above; seam=the committed JSON files; no_claim=the registry's tarball.
test('harnesses/dsh/pin.json names the package, version and npm integrity harnesses/dsh/package-lock.json locks', () => {
  const pin = read('harnesses/dsh/pin.json') as { version: string; integrity: { npm_package: string; npm_integrity: string } };
  const name = pin.integrity.npm_package.slice(0, pin.integrity.npm_package.lastIndexOf('@'));
  expect(pin.integrity.npm_package).toBe(name + '@' + pin.version);
  expect(read('harnesses/dsh/package.json').dependencies).toEqual({ [name]: pin.version });
  expect((read('harnesses/dsh/package-lock.json') as Lock).packages['node_modules/' + name]).toMatchObject({ version: pin.version, integrity: pin.integrity.npm_integrity });
});
