// harnesses/hermes/Dockerfile links the hermes command at /usr/local/bin/hermes, where Hermes's own install.sh puts it.
// Hermes's terminal tool starts login shells, and Debian's /etc/profile resets PATH there, so without the link an
// agent's own hermes command (for example "hermes mcp add") is not found. The gbrain install reruns on 757 and 760
// (#551) ran with this link; this keeps it from being dropped by a later image change.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const dockerfile = readFileSync(join(ROOT, 'harnesses', 'hermes', 'Dockerfile'), 'utf8');
const steps = dockerfile.replace(/\\\n/g, ' ').split('\n').filter((line) => /^(RUN|COPY|ADD)\s/.test(line));
const runs = steps.filter((line) => /^RUN\s/.test(line));

test('the Hermes image links the venv hermes at /usr/local/bin/hermes', () => {
  const install = runs.find((line) => line.includes('uv venv') && line.includes('/opt/harness/venv/bin/hermes --version'));
  expect(install).toBeDefined();
  expect(install).toContain('ln -s /opt/harness/venv/bin/hermes /usr/local/bin/hermes');
  expect(install!.indexOf('/opt/harness/venv/bin/hermes --version')).toBeLessThan(install!.indexOf('ln -s /opt/harness/venv/bin/hermes'));
});

test('no later RUN, COPY or ADD step touches /usr/local/bin', () => {
  const link = steps.findIndex((line) => line.includes('ln -s /opt/harness/venv/bin/hermes'));
  expect(link).toBeGreaterThan(-1);
  expect(steps.slice(link + 1).filter((line) => line.includes('/usr/local/bin'))).toEqual([]);
});
