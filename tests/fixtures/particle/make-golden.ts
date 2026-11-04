#!/usr/bin/env bun
// Writes golden/<harness>-<entry>-openai.json from a harness tree: what each adapter hands its harness on an OpenAI cell
// (the turn arguments and provider environment, the serve response and the ready file), captured at process level with
// the stand-ins in ../openai-branch/stub/ (captureProcess, no image). tests/particle-branch.test.ts compares the checkout's
// adapters against them, so adding the Particle branch cannot change an OpenAI cell. The files in golden/ were written
// from a worktree of main at 3a9b403be, before the Particle branch:
//
//   git worktree add /tmp/he-3a9b403be 3a9b403be
//   bun tests/fixtures/particle/make-golden.ts --from /tmp/he-3a9b403be/harnesses
//
// The config file is left out: an OpenAI cell's config is the checkout's template copied verbatim, which the test checks
// directly, so a later change to that template (internal-task's memory setting) does not break these goldens.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { captureProcess, sha256, type Entry, type Harness } from '../openai-branch/capture.ts';

export const PARTICLE_GOLDEN_DIR = join(import.meta.dir, 'golden');
export const OPENAI_CELL = { baseUrl: 'http://host.docker.internal:18999/golden/openai', model: 'gpt-6-luna' };
export const openaiGoldenPath = (harness: Harness, entry: Entry) => join(PARTICLE_GOLDEN_DIR, `${harness}-${entry}-openai.json`);

/** What the image supplies besides the CLI: node and python3 on PATH, and its OPENCLAW_VERSION or HERMES_VERSION. */
export function hostEnv(harnessDir: string, harness: Harness, node: string): Record<string, string> {
  const version = JSON.parse(readFileSync(join(harnessDir, 'pin.json'), 'utf8')).version as string;
  return { PATH: [dirname(node), '/usr/local/bin', '/usr/bin', '/bin'].join(':'), ...(harness === 'openclaw' ? { OPENCLAW_VERSION: version } : { HERMES_VERSION: version }) };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const from = argv[argv.indexOf('--from') + 1];
  if (!argv.includes('--from') || !from) throw new Error('usage: make-golden.ts --from <harnesses dir>');
  const node = Bun.which('node');
  if (!node) throw new Error('node is not on PATH');
  mkdirSync(PARTICLE_GOLDEN_DIR, { recursive: true });
  for (const harness of ['openclaw', 'hermes'] as Harness[]) {
    for (const entry of ['run', 'serve'] as Entry[]) {
      const dir = join(from, harness);
      const c = await captureProcess({ harness, entry, harnessDir: dir, ...OPENAI_CELL, env: hostEnv(dir, harness, node) });
      if (c.exit !== 0 || c.turns.length !== 1) throw new Error(`${harness} ${entry}: exit ${c.exit}, ${c.turns.length} turns\n${c.logs}`);
      writeFileSync(openaiGoldenPath(harness, entry), JSON.stringify({ adapter_sha256: sha256(join(dir, 'adapter.sh')), turns: c.turns, response: c.response, ready: c.ready }, null, 1) + '\n');
      console.log(`${openaiGoldenPath(harness, entry)}: ${c.turns.length} turn(s)`);
    }
  }
}
