# Adapter baselines

Byte copies of `harnesses/<harness>` at the commit each folder is named for, less each README.md:

- `a1bc7088c`: Claude Code and Codex, the head lane B started from (`tests/official-minimal.test.ts`).
- `31a109a9c`: OpenClaw and Hermes, main when the instruction-route work started (`tests/instruction-route.test.ts`).

The byte-identity tests run each adapter against its baseline from here, so they pass in a clone without that history.
Where the commit is reachable, each test first checks that its copy still equals `git ls-tree` at that commit.
