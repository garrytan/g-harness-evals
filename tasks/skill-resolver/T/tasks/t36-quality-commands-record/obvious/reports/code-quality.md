# Code quality snapshot (2026-11-07)

Based on the latest CI run on main (notes/last-ci-run.txt); dependencies are not installed here, so I did not rerun the tools.

| Area | Tool | Result | Score |
|---|---|---|---|
| Types | tsc --noEmit | 1 error | 7/10 |
| Lint | biome | 4 warnings | 8/10 |
| Tests | vitest | 61/61 passing | 10/10 |
| Unused code | knip | 2 unused exports | 8/10 |
| Shell scripts | shellcheck | not run (not in CI, not installed) | n/a |

**Overall: about 8/10.** Tests are solid; the type error is the only real defect.

## What to fix first

1. `src/sync/upload.ts:41`: `string | undefined` assigned to `string`; handle the undefined case.
2. Remove or use `formatBytes` (src/util/format.ts) and `legacyPlan` (src/sync/plan.ts).
3. Fix the `noExplicitAny` warning at src/sync/plan.ts:30, then the three style warnings.
4. Add shellcheck to CI for scripts/release.sh and scripts/install-hooks.sh.
