# Security policy

**Report vulnerabilities privately, never in a public issue.** Use GitHub's private form: open the repository's **Security** tab, then **Report a vulnerability** (GitHub private vulnerability reporting).

## In scope

- **The metering proxy** (`runner/proxy/`). Every model call goes through it, and it is the only process that holds a real provider key.
- **The budget ledger** (`runner/ledger/`). Leases and spend caps.
- **Sealed held-out tooling** (`scripts/sealed/`, `scripts/seal-heldout.ts`).
- **CI workflows** (`.github/workflows/`).
- **Anything that could leak a provider API key or a sealed task**, wherever it lives.

## Out of scope

- **Model behaviour inside a trial.** A model that does something bad in a task is a result we report, not a vulnerability.
- **Findings or numbers you disagree with.** Open an issue with the finding question form instead.

## What to include

- A repro on current `main`, step by step.
- The commit sha of `main` you tested.
- The impact: what an attacker gets, and who is affected.
- Logs, with any secret removed. Never paste a real API key, even an expired one.

## What happens next

- We read every report.
- We make no promise about response times.

## Sealed tasks

- Held-out sets that are still sealed publish only their digests ([docs/sealed-custody.md](docs/sealed-custody.md)). Spent sets are published, labelled spent.
- The custody record is private. A way to recover a sealed task body is in scope; please report it here and do not publish it.
