**Notice for outside contributors:** we read your diff as text only. We never check out, run or merge an outside branch. If we take the idea, a maintainer rewrites it on `main` (CONTRIBUTING.md at the repository root).

## What problem does this solve?

## Repro or failing test

<!-- Steps on current main, or a test that fails before this change and passes after. -->

## Consequence

<!-- Who is affected and how, without this change. -->

## Does this change any of these?

- [ ] Network calls (new hosts, new requests)
- [ ] Reads of environment variables or secrets
- [ ] CI workflows (`.github/`)
- [ ] Install scripts or Dockerfiles
- [ ] Dependencies (`package.json`, `bun.lock`, or any other lockfile)

<!-- For each box you tick, say what and why. -->

## Keyless checks run

- [ ] `bun install --frozen-lockfile`
- [ ] `bun test tests/`
- [ ] `bunx tsc --noEmit`
- [ ] `python3 scripts/check-links.py`
- [ ] `bun runner/prereg/prereg.ts` (private repository only; it fails in the public copy)
- [ ] `bun scripts/seal-heldout.ts --check`
