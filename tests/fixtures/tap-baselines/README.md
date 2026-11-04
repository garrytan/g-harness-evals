# Tap baselines

Byte copies of files at the commit each folder is named for:

- `7da83ed94`: `world/services/gbrain-tap.ts`, main when provider-aware scoring started (`tests/gbrain-provider-off-identity.test.ts`).

The identity test runs the tap at that commit from here, so it passes in a clone without that history.
Where the commit is reachable, the test first checks that the copy still equals the file at that commit.
