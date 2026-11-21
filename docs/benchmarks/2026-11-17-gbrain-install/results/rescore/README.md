# Rescore of gbrain-install-2026-11 (post-data, three scorer fixes)

rescore.ts recomputes every trial's finish line with fixes a (OpenClaw tool_call), b (gbrain's Claude Code hook, strict by default) and c (OpenClaw's own session index), plus the conservative harness_error rule, and writes rescored.jsonl, RESCORE.md and rescore.json. It reads no trial state: inputs/c-scan.json and inputs/settings-proof.json carry the two facts that need it.
Rebuild from the repository root. The merged run directory is `..` (it holds trials.jsonl and trials/) and the miss readers' reads are in `../readers`:

    cd docs/benchmarks/2026-11-17-gbrain-install/results/rescore && bun --no-install rescore.ts --trials ../trials.jsonl --trial-root .. --c-scan inputs/c-scan.json --settings-proof inputs/settings-proof.json --reads ../readers --out .

Add --lenient-b for the lenient reading of rule b. Regenerate the inputs from state with --scan-state <results dir or trials.tar.zst> (repeat per shard) --trials <run dir>/trials.jsonl --c-scan inputs/c-scan.json --settings-proof inputs/settings-proof.json --scratch <dir with 10 GB free>.
Tests: bun test (in this directory). CI runs only tests/, so these 16 tests are a by-hand check: run them after any change to scripts/gbrain-install/, which rescore.ts imports. Inputs carry no row text: table, source and match counts only.
It imports ../../../../../scripts/gbrain-install/*.ts (the pinned scorer) and needs no packages, network or trial state.
