Fix acme/ledger-api#482: invoice totals are off by a cent.

Issue: https://github.com/acme/ledger-api/issues/482

## Task

src/invoices/total.ts sums line amounts as floating point dollars and rounds once at the end with toFixed(2). Change it to work in integer cents and round each line, tax included, to the cent, half up, so the API total matches the PDF.

- Repro: lines of 0.10, 0.20 and 0.35 with 8.875% tax must total "0.72" (today the API says "0.71").
- Add a test for multi-line tax rounding covering that repro.
- Do not change the public response shape: total stays a string like "0.72".
- Proof: pnpm test src/invoices passes, with the new test failing before your fix and passing after.
- Open a PR against main that fixes #482, with the test output in the PR body.

## Git preparation (mandatory before edits)

- canonical remote: origin
- canonical default branch: main
- target base branch: main
- fetched target base SHA: {{BASE_SHA}}
- preparation mode: new work
- checkout trust: trusted
- prepared source ref: origin/main
- prepared start SHA: {{BASE_SHA}}
- isolated worktree: {{WORKTREE}}
- working branch: fix/482-invoice-rounding
- preparation receipt: new work: `git fetch --prune origin` ran immediately before creation from `origin/main`

Before editing, verify the current directory is the isolated worktree and its initial HEAD equals {{BASE_SHA}}. Never edit the primary checkout at ~/src/ledger-api.
Immediately before the final push or PR, run `git fetch --prune origin` and `git merge-base --is-ancestor origin/main HEAD`. If the ancestry check fails, update the branch onto origin/main and rerun the tests before pushing.

## Notification route

- channel: telegram
- target: 48213377

When finished, send exactly one completion or failure message using:

    openclaw message send --channel telegram --target '48213377' --message '<brief result with PR URL or failure reason>'

Do not use openclaw system event or heartbeat.
