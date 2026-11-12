# Task: fix invoice total rounding (acme/ledger-api#482)

You are working unattended in a clone of acme/ledger-api on the branch fix/482-invoice-rounding, created from the latest origin/main. Nobody will answer questions, so make sensible decisions and note them in the PR.

## Problem

src/invoices/total.ts adds line amounts as floating point dollars and rounds once at the end with toFixed(2). With lines of 0.10, 0.20 and 0.35 and 8.875% tax, the API returns 0.71 while the PDF shows 0.72, because the PDF rounds per line.

## What to do

1. Change the calculation to integer cents and round each line (tax included) to the cent, half up.
2. Keep the public response shape: total stays a string like "0.72".
3. Add a test reproducing the example above; it should fail before the fix and pass after.
4. Run pnpm test src/invoices and make sure everything passes.
5. Commit, push the branch and open a PR against main titled "Fix per-line rounding in invoice totals (#482)", including the test output and "Fixes #482".

## Constraints

- Only touch src/invoices and its tests.
- Do not force-push or touch main.

## When you are done

Send one Telegram message to chat 48213377 with the PR link, or the reason you could not finish:

    curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" -d chat_id=48213377 -d text="ledger-api#482: <result>"
