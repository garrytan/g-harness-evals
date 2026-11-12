# checkout-web Sentry autofix: loop plan

Status: not armed. This is the playbook draft and the shadow run plan; nothing is scheduled until the shadow run below produces a PR Rosa would have merged.

Why a loop and not a plain cron: each Sentry issue is a work item that persists across mornings, must not be worked twice, and produces a PR someone should see before it goes out.

## Interview

| What | Answer |
|---|---|
| Source of work | New unresolved Sentry issues in project checkout-web (level error), first seen since the last fire. Dedupe key: the Sentry issue id (for example 4719201833), never the title. |
| Trigger | Cron 0 7 * * 1-5, America/Los_Angeles: weekdays at 7:00, so PRs are ready before Rosa reviews around 9:30. |
| Success condition | See below. |
| Ship actions | open_pr only, at hold. |
| Caps | Proposed: at most 3 items per fire, at most 5 turns per item. |
| Escalation | The governor pings Rosa in #checkout-oncall. |

## Success condition

The Sentry issue has a linked PR against main in acme/checkout-web whose change touches only the module named in the issue's culprit (never src/payments/), pnpm test, pnpm lint and pnpm typecheck pass, and CI is green on the PR; or park the item with a written diagnosis after 5 turns.

successChecks:
- pnpm test
- pnpm lint
- pnpm typecheck

## Ship actions

- open_pr: hold. Every PR is held for Rosa's review. Nothing ships on auto at creation; graduation to auto for a slice comes later, only after several PRs from that slice shipped unchanged.
- Anything else (commenting on Sentry, resolving issues, merging) is not declared, so it would be quarantined if attempted.

## Playbook (draft, to be rewritten from the shadow run)

1. Intake: list new unresolved error-level issues in checkout-web since the last fire; drop ids already in the ledger; skip culprits under src/payments/.
2. For each item (up to the cap): read the stack trace and the culprit file, reproduce with a unit test, make the smallest fix in the implicated module, run the three checks.
3. Prepare the PR: title "fix(<module>): <Sentry short id>", body with the Sentry permalink, root cause, the test and check output.
4. If the item cannot be fixed within 5 turns, park it with a diagnosis in the ledger.

## Shadow run (before arming)

Work one real item end to end in a conversation with Rosa watching, with no loop created yet:

- Item: CHECKOUT-WEB-2KQ (id 4719201833), "TypeError: Cannot read properties of undefined (reading 'amount')" in src/cart/summary.ts formatDiscount, 1,840 events since 2026-11-03.
- Do the whole job up to the ship line: write the failing test, the fix and the actual PR text, then stop before opening it.
- Ask Rosa directly: would you have sent this? Fix what she flags; if it needed real correction, repeat on CHECKOUT-WEB-2L1.
- Then rewrite the playbook above from what actually worked.

Items not suited to the loop from this export: CHECKOUT-WEB-2KT (an AbortError warning, usually expected behaviour) and CHECKOUT-WEB-2L4 (a ChunkLoadError from deploys, not a code fix in one module).

## When armed

It will fire weekdays at 7:00 Pacific, take up to 3 new checkout-web errors, prepare one PR each, and hold every PR for Rosa. To pause it, ask to pause the loop or use the loop's pause control.
