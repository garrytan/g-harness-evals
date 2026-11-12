# Invoice totals off by a cent (acme/ledger-api#482)

Issue: https://github.com/acme/ledger-api/issues/482

- Repo: acme/ledger-api, default branch main. My clone is at ~/src/ledger-api (remotes: origin = acme/ledger-api).
- `src/invoices/total.ts` adds line amounts as JavaScript numbers in dollars and rounds once at the end with toFixed(2).
- Repro: three lines of 0.10, 0.20 and 0.35 with 8.875% tax gives 0.71 in the API and 0.72 on the PDF, which rounds per line.
- Finance wants per-line rounding to the cent, half up, in integer cents, matching the PDF.
- Tests: `pnpm test src/invoices`. There is no test for multi-line tax rounding yet.
- Do not change the public response shape (`total` stays a string like "0.72").
