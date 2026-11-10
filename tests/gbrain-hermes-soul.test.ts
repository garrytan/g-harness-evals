// gbrain/Dockerfile seeds the Hermes installer's HERMES_HOME with Hermes's own SOUL.md. The file is vendored at
// gbrain/hermes/SOUL.md and copied into the build: an unauthenticated fetch from GitHub's raw host failed the keyless
// check with HTTP 429 under load. These checks keep the build off the network for it and keep the copy pinned.

import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const dockerfile = readFileSync(join(ROOT, 'gbrain', 'Dockerfile'), 'utf8');
const hermesPin = JSON.parse(readFileSync(join(ROOT, 'harnesses', 'hermes', 'pin.json'), 'utf8'));

test('gbrain/Dockerfile copies the vendored SOUL.md and never fetches it over the network', () => {
  expect(dockerfile).not.toContain('raw.githubusercontent.com');
  const fetches = dockerfile.split('\n').filter((line) => /\b(curl|wget)\b|^\s*ADD\s+https?:/i.test(line) && /SOUL/i.test(line));
  expect(fetches).toEqual([]);
  expect(dockerfile).toContain('COPY gbrain/hermes/SOUL.md /opt/sidecar/hermes/SOUL.md');
  expect(dockerfile).toContain('echo "$HERMES_SOUL_SHA256  /opt/sidecar/hermes/SOUL.md" | sha256sum -c --quiet');
});

test('the vendored SOUL.md is the pinned Hermes file, byte for byte', () => {
  const soul = readFileSync(join(ROOT, 'gbrain', 'hermes', 'SOUL.md'));
  const arg = (name: string) => dockerfile.match(new RegExp(`^ARG ${name}=([0-9a-f]+)$`, 'm'))?.[1];
  expect(arg('HERMES_COMMIT')).toBe(hermesPin.commit);
  expect(arg('HERMES_SOUL_SHA256')).toBe(hermesPin.soul_md.sha256);
  expect(createHash('sha256').update(soul).digest('hex')).toBe(hermesPin.soul_md.sha256);
  expect(soul.length).toBe(hermesPin.soul_md.bytes);
});
