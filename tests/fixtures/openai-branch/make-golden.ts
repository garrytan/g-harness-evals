#!/usr/bin/env bun
// Writes golden/<harness>-<entry>-anthropic.json from a harness tree, the Anthropic-cell captures
// tests/openai-branch.test.ts compares the checkout's adapters against. The files in golden/ were
// written from a worktree of c1c7ed1b3, before the OpenAI branch:
//
//   git worktree add /tmp/he-c1c7ed1b3 c1c7ed1b3
//   bun tests/fixtures/openai-branch/make-golden.ts --from /tmp/he-c1c7ed1b3/harnesses
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANTHROPIC_CELL, GOLDEN_DIR, capture, goldenOf, goldenPath, sha256, type Entry, type Harness } from './capture.ts';

const argv = process.argv.slice(2);
const from = argv[argv.indexOf('--from') + 1];
if (!argv.includes('--from') || !from) throw new Error('usage: make-golden.ts --from <harnesses dir>');
mkdirSync(GOLDEN_DIR, { recursive: true });
for (const harness of ['openclaw', 'hermes'] as Harness[]) {
  for (const entry of ['run', 'serve'] as Entry[]) {
    const c = await capture({ harness, entry, harnessDir: join(from, harness), image: `harness-eval/${harness}:dev`, ...ANTHROPIC_CELL, name: `he-golden-${harness}-${entry}-${process.pid}` });
    if (c.exit !== 0 || !c.turns.length) throw new Error(`${harness} ${entry}: exit ${c.exit}, ${c.turns.length} turns\n${c.logs}`);
    writeFileSync(goldenPath(harness, entry), JSON.stringify({ adapter_sha256: sha256(join(from, harness, 'adapter.sh')), ...goldenOf(c) }, null, 1) + '\n');
    console.log(`${goldenPath(harness, entry)}: ${c.turns.length} turn(s), config ${c.config.length} bytes`);
  }
}
