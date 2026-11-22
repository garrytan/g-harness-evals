// The export starts gitleaks in the background while its other gates run (scripts/public-export/export.ts): awaiting
// gitleaksInBackground gives the same findings as gitleaks() on the same directory, a deadline kills the tool and throws the
// same timeout error, and no report file is left in the work directory.
import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitleaks, gitleaksInBackground, readLock, readyTool } from '../scripts/public-safety/lib/tools.ts';
import { CACHE, GATE, gitleaksReady, scrubbedEnv, tokenCanary } from './public-safety-fixture.ts';

const READY = gitleaksReady();
const tmp = mkdtempSync(join(tmpdir(), 'he-gitleaks-bg-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const env = scrubbedEnv(tmp);
const CONFIG = join(GATE, 'gitleaks.toml');
const tool = () => readyTool('gitleaks', readLock(join(GATE, 'tools.lock')).tools.gitleaks!, { cache: join(CACHE, 'harness-evals', 'public-safety', 'tools'), dest: join(tmp, 'bin'), env });

test.skipIf(!READY)('gitleaks in the background finds what gitleaks finds, and leaves no report behind', async () => {
  const dir = join(tmp, 'scan');
  mkdirSync(join(dir, 'sub'), { recursive: true });
  writeFileSync(join(dir, 'clean.md'), 'nothing to see here\n');
  writeFileSync(join(dir, 'sub', 'notes.txt'), 'token = ' + tokenCanary() + '\n');
  const gl = tool();
  const sync = gitleaks(gl, dir, CONFIG, join(tmp, 'work-sync'), env);
  const bg = await gitleaksInBackground(gl, dir, CONFIG, join(tmp, 'work-bg'), env);
  expect(sync.ok).toBe(true);
  expect(sync.findings.length).toBeGreaterThan(0);
  expect(bg).toEqual(sync);
  expect(readdirSync(join(tmp, 'work-bg')).filter((f) => f.startsWith('gitleaks-report-'))).toEqual([]);
});

test.skipIf(!READY)('a deadline kills gitleaks in the background with the timeout error gitleaks() throws', async () => {
  const dir = join(tmp, 'big');
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 400; i++) writeFileSync(join(dir, i + '.txt'), ('line ' + i + ' of filler text\n').repeat(4000));
  await expect(gitleaksInBackground(tool(), dir, CONFIG, join(tmp, 'work-deadline'), env, 1)).rejects.toMatchObject({ code: 'PS-TOOL-TIMEOUT' });
});
