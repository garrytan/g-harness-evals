# Code quality snapshot

```
CODE HEALTH DASHBOARD
=====================

Project: harbor-cli
Branch:  main
Date:    2026-11-07

Category      Tool              Score   Status     Details
----------    ----------------  -----   --------   -------
Type check    tsc --noEmit       7/10   WARNING    1 error (src/sync/upload.ts:41)
Lint          biome check .      8/10   WARNING    4 warnings
Tests         vitest run        10/10   CLEAN      61/61 passed
Dead code     knip               8/10   WARNING    2 unused exports
Shell lint    shellcheck          -     SKIPPED    not installed here, not run in CI

COMPOSITE SCORE: 8.3 / 10 (partial coverage)
Coverage: 4/5 categories checked
Checked: typecheck, lint, test, deadcode
Unavailable: shell (shellcheck not installed)
```

Scores come from the 2026-11-06 CI run in notes/last-ci-run.txt; dependencies are not installed in this checkout, so nothing was rerun.

## Top issues

1. Type check: `src/sync/upload.ts:41` assigns `string | undefined` to `string`.
2. Dead code: `formatBytes` (src/util/format.ts) and `legacyPlan` (src/sync/plan.ts) are unused exports.
3. Lint: `noExplicitAny` at src/sync/plan.ts:30 is the one warning worth fixing first.
