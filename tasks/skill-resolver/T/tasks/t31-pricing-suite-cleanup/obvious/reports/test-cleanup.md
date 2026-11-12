# Test cleanup candidates

I read every file under test/ and src/. Nothing has been deleted.

## Summary

| File | Recommendation | Why |
|---|---|---|
| test/pricing-copy.test.js | Delete | Exact copy of two tests in pricing.test.js |
| test/smoke.test.js | Delete | Has no assertions; every other test already imports the module |
| test/clamp.test.js | Delete, and remove `_clampPercent` | Tests a helper nothing in src/ uses |
| test/exports.test.js | Keep | Protects the public API of the package |
| test/pricing.test.js | Keep | The real behavior tests |

## Details

### test/pricing-copy.test.js
Both tests are byte-for-byte the same as the first two in pricing.test.js. The comment says it was copied while debugging the 2.1.0 clamp bug and never removed. Deleting it loses no coverage.

### test/smoke.test.js
The test body is empty. If src/pricing.js failed to load, pricing.test.js would fail too, so this adds nothing.

### test/clamp.test.js
`_clampPercent` is exported only so this file can test it: `applyDiscount` does its own clamping and nothing outside test/ calls the helper (searched src/ for `_clampPercent`). The clamp behavior is already covered through `applyDiscount(20, 150)`. Suggest deleting the test and the helper, and adding a negative-percentage case to pricing.test.js.

### test/exports.test.js
Keep. It checks the package entry point exports exactly `applyDiscount` and `roundCents`, which is what consumers depend on.

## Expected savings

About 30 lines of tests and 4 lines of production code. Run `npm test` after each removal.
