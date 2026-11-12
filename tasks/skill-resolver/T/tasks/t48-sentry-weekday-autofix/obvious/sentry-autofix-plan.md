# Plan: weekday Sentry autofix agent for checkout-web

## Goal

Each weekday morning, an agent picks up new Sentry errors from the checkout-web project, attempts a fix, and opens a pull request for Rosa to review. Nothing is merged without a human.

## Schedule

- Cron: 0 7 * * 1-5 (America/Los_Angeles), so PRs are ready before the 9:30 review.

## Input

- New unresolved Sentry issues in checkout-web with level error, first seen since the previous run.
- Skip warnings (like the AbortError in the sample) and deploy noise like ChunkLoadError.
- Skip anything whose culprit is under src/payments/.

## Steps for each issue

1. Read the stack trace, culprit file and recent events.
2. Write a failing unit test that reproduces the error.
3. Make the smallest fix in the affected module.
4. Run pnpm test, pnpm lint and pnpm typecheck.
5. Open a draft PR against main titled "fix: <Sentry short id> <title>" with the Sentry link, root cause, and test output.

## Avoiding duplicate work

Keep a state file of Sentry issue ids already handled, and check for an open PR that mentions the issue before starting.

## Guardrails

- At most 3 PRs per morning.
- Give up on an issue after 30 minutes or if the fix touches more than one module, and leave a note instead.
- PRs are drafts; the agent never merges, resolves Sentry issues or pushes to main.

## Success criteria

An issue counts as handled when there is a draft PR with a test reproducing the error, all checks pass locally and CI is green.

## Rollout

1. Dry run for the first week: the agent writes the proposed diff and PR text to a file but does not open PRs.
2. Review the dry-run output together; adjust the steps.
3. Turn on PR creation.

## Escalation

Failures and skipped issues are posted to #checkout-oncall, tagging Rosa.
