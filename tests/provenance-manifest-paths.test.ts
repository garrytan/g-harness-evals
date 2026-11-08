import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const MANIFESTS = [
  'harnesses/openclaw/provenance.json',
  'harnesses/hermes/provenance.json',
  'harnesses/claude-code/provenance.json',
  'harnesses/codex/provenance.json',
  'harnesses/dsh/provenance.json',
];

describe('provenance manifest paths', () => {
  for (const manifest of MANIFESTS) {
    test(`${manifest} exists`, () => {
      expect(existsSync(join(ROOT, manifest))).toBe(true);
    });
  }
});
