// The release version is written in three places that must agree: VERSION, package.json and the newest CHANGELOG.md section
// (CLAUDE.md: versions follow VERSION and package.json; every pull request cuts a release since 0.0.6).
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');

test('VERSION, package.json and the newest CHANGELOG.md section name the same release', () => {
  const version = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
  expect(pkg.version).toBe(version);
  const heading = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8').match(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/m);
  expect(heading?.[1]).toBe(version);
});
