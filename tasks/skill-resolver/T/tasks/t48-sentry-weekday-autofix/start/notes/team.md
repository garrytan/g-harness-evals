# checkout-web team notes

- Repo: acme/checkout-web, default branch main. CI runs on every PR (unit tests, lint, Playwright smoke).
- Local checks: pnpm test, pnpm lint, pnpm typecheck.
- On-call channel: #checkout-oncall. Me (Rosa) for anything about the autofix work.
- Payments code lives in src/payments/ and needs a second human reviewer; nobody automates changes there.
- Mornings: I review PRs around 9:30 Pacific, so anything ready by 9 gets looked at the same day.
