# Test value sweep: test/

Scope: test/ (5 files, 11 tests). Budget: well under the 8-minute discovery budget. Report only: nothing was edited.

Pre-filter leads: NO_ASSERTION test/smoke.test.js; EXPORT_LIST test/exports.test.js; NEAR_DUPLICATE test/pricing.test.js test/pricing-copy.test.js.

## Owner boundary: src/pricing.js

### test/pricing-copy.test.js (verdict: retire)

- test: test/pricing-copy.test.js, both tests
- detects: applyDiscount 10% off and the clamp above 100
- non_test_callers: n/a (test file); the symbols it calls have production callers in src/index.js
- search_command: `git grep -n -F -w -e 'applyDiscount' -- . ':!test/'` (2 hits: src/pricing.js, src/index.js)
- stronger_proof: test/pricing.test.js has the identical two tests plus the negative-price and rounding cases
- history: comment says it was copied while debugging the 2.1.0 clamp bug; git history not available in this checkout
- unlocks: nothing beyond the file
- validation: `npm test` (node --test test/) must stay green with the same remaining assertions

### test/clamp.test.js and _clampPercent (verdict: retire, with production code)

- test: test/clamp.test.js, both tests
- detects: _clampPercent caps at 100 and floors at 0
- non_test_callers: 0; applyDiscount inlines its own clamp and never calls _clampPercent
- search_command: `git grep -n -F -w -e '_clampPercent' -- . ':!test/' ':!tests/' ':!**/*.test.*'` (1 hit: its definition in src/pricing.js)
- stronger_proof: test/pricing.test.js "clamps percentages above 100" covers clamping at the real boundary; add one row for a negative percentage there
- history: not available in this checkout
- unlocks: delete the test-only export _clampPercent from src/pricing.js (4 production lines); it is not exported from src/index.js
- validation: `npm test`, plus `node -e "import('./src/index.js')"` after removing the export

### test/smoke.test.js (verdict: retire)

- test: test/smoke.test.js
- detects: only that src/pricing.js imports without throwing (assertion-free coverage probe)
- non_test_callers: n/a
- search_command: n/a (no symbol)
- stronger_proof: every test in test/pricing.test.js imports the same module and fails on a load error
- history: not available in this checkout
- unlocks: nothing
- validation: `npm test`

## Retained

- test/exports.test.js (retain): an export-list check matches the low-value catalog, but here it guards the package entrypoint contract (`exports` points at src/index.js), which the retention bar keeps.
- test/pricing.test.js (retain): the owning behavior tests.

## LOC per batch

| Batch | Production LOC removed | Test LOC removed |
|---|---|---|
| src/pricing.js owner | 4 | 32 |

## Validation

Validation was not run (report only). Command for the batch: `npm test`.

## Suppressed

None (no `gstack:test-value keep` markers).
