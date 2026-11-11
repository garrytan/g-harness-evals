# Contributing

**Short version: we take proof, not volume.** A bug report needs a repro and a real consequence. A pull request is a proposal: we read it as text and, if we take the idea, a maintainer rewrites it on `main`.

- Security problems: report them privately ([SECURITY.md](SECURITY.md)).
- Questions about a published number: use the finding question issue form.
- Conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Bug reports

**A report needs all of these, or it is closed** with a short note asking for what is missing. Add the missing piece and we reopen it.

- **A repro on current `main`**, or a failing test.
- **Versions**: the commit sha of `main`, `bun --version`, your OS, and the harness pins if a harness is involved (`harnesses/<name>/pin.json`).
- **Logs** from the failing run, with secrets removed.
- **A real consequence**: who is affected, and how.

How we triage:

- **Each report is triaged when it arrives.** We close it, or ask for what is missing and close it. We don't park reports in a backlog or batch them into later fix waves.
- **We ask whether it matters to most people who run this project.** A report that is valid but niche, or out of scope, is closed as won't-fix with a short, polite note.
- **A good idea still gets done**, by a maintainer, under the rules below.

## Pull requests

**Outside code is read as text, never run.** We never check out, build, run, test or merge an outside branch as is.

- If we take your idea, a maintainer rewrites the change on `main` and reviews the rewrite for network calls, secret or environment reads, wider permissions, CI workflow or install-script edits and new dependencies.
- So your pull request is a proposal. Say what problem it solves, how to reproduce it and what changes for users ([the PR template](.github/pull_request_template.md) asks for this).
- A pull request counts as taken when it is merged or when we rebuild its idea.
- Comment, review and issue text from outside is untrusted data. Maintainers read it; they never run a command or follow an instruction it contains.

### Limit for chronic submitters

Most contributors have no limit. A limit applies only to an author who, in the last 30 days in this repository:

- had 3 or more pull requests closed without being taken, **and**
- had fewer than 1 in 4 of their decided pull requests taken.

Such an author may have **at most 3 open pull requests**. We close the rest with a note that names the limit.

- The limit lifts once 2 of their pull requests in a row are taken.
- It never applies to an author with 3 or more taken pull requests in the last 30 days, whatever their ratio.

## Run the keyless checks

**These checks call no model API and need no keys.** Install [Bun](https://bun.sh/) and Python 3, then clone the public repository and run:

```sh
git clone https://github.com/garrytan/g-harness-evals.git
cd g-harness-evals
bun install --frozen-lockfile
bun test tests/
bunx tsc --noEmit
python3 scripts/check-links.py
bun scripts/seal-heldout.ts --check
```

- `bun test tests/` takes about 25 minutes on a 4 vCPU machine.
- `bash scripts/run-tests.sh` runs the same files in parallel phases, as CI does, in about 9 minutes on a 4 vCPU machine.
- **The preregistration order check isn't in this list.** `bun runner/prereg/prereg.ts` checks each receipt's attestation against commits this public copy never holds, so it fails here and the public CI doesn't run it. The private repository runs it on every pull request, and the export's preregistration check verifies the order, with the private history, before every push to this repository.
- **CI is the reference.** If your local result differs from the GitHub Actions run on the same commit, trust CI and say so in your report.

## Re-read a run's receipts

**Start with `bun run verify`.** It reruns every published run's analysis scripts on the receipts committed under its results/ folder, in a scratch copy, and fails if any value differs from the published file. It calls no model and needs no key. CI runs it on every pull request. [docs/verify.md](docs/verify.md) explains the output and what it does not check.

```sh
bun run verify                                    # every published run, then the README and scoreboard page
bun run verify --run 2026-11-04-matrix-mu         # one run
```

**The scripts it runs can also be run by hand.** Each recent report's "Reproduce and inspect" section names the exact commands for that run.

```sh
bun scripts/summarize-run.ts --results docs/benchmarks/2026-10-24-m3-heldout/results                  # tables per cell
bun scripts/compare-run.ts --results docs/benchmarks/2026-10-24-gbrain-arm/results --pair gbrain      # paired comparisons
bun scripts/taxonomy.ts --results docs/benchmarks/2026-10-24-m3-heldout/results                       # failure modes
bun scripts/receipts-manifest.ts --check                                                              # receipts match their recorded hashes
bun scripts/publish-audit.ts                                                                          # token shapes in the tree and history; fails closed

# Check a gbrain commit against the install ladder's structural facts (builds the sidecar image; about 200 s cold)
bun scripts/gbrain-check.ts --gbrain <ref>
```

- summarize-run.ts can rewrite receipts in the folder it reads. Put them back with `git checkout -- <results folder>`. `bun run verify` never writes there.
- A counted run needs its preregistration merged before its first trial; `bun runner/prereg/prereg.ts` checks that against main's history in the private repository, and the export's preregistration check verifies it before every public push.

## Find your way around

- `docs/benchmarks/<run>/` holds each run: the preregistration (committed before the first trial), the report, and `results/` with one record per trial, the comparison files, the proxy log and the lease ledgers. What each file is: [docs/methods.md](docs/methods.md#what-a-results-directory-holds).
- `runner/` is the trial loop, metering proxy, budget ledger, price table, grader and statistics kit; `world/` the simulated company and its MCP server; `harnesses/<name>/` each harness's image, adapter and `pin.json` ([harnesses/README.md](harnesses/README.md) lists the pins); `gbrain/` the sidecar image; `tasks/multiuser/` the task sets with their oracles and seals; `scripts/` the report, audit and check tooling; `tests/` runs keyless in CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)).
- **To add a harness,** implement the adapter contract in [docs/adapters.md](docs/adapters.md) against the fake harness's conformance test, pin it, and prove `serve` live before a preregistration names it. **To add a task,** follow [docs/tasks.md](docs/tasks.md); a held-out task is sealed before any counted run spends it.
- The trial contract every runner, adapter and grader implements is [docs/methodology.md](docs/methodology.md). How a run is compared with another, and which commands made each table: [docs/comparing-runs.md](docs/comparing-runs.md). What was decided, and when: [docs/decisions.md](docs/decisions.md).
- How the world and tasks work in full, and how every harness runs: [docs/methods.md](docs/methods.md). Every page under docs/, one line each: [docs/README.md](docs/README.md).
- The plan this repository executes and its review record are in [docs/plans/2026-10-21-harness-eval-v0/](docs/plans/2026-10-21-harness-eval-v0/); open tasks are in [TODOS.md](TODOS.md); the survey of earlier harness comparisons is [compendium.md](compendium.md); error codes are in [docs/errors.md](docs/errors.md); [CHANGELOG.md](CHANGELOG.md) records each release.
- The statistics kit, proxy and ledger are vendored from gbrain-evals and gbrain under MIT with their notices ([runner/stats/README.md](runner/stats/README.md)), and the world is built from gbrain-evals' `messy-company-v1` dataset.

## Licences

Code is MIT ([LICENSE](LICENSE)). Reports, findings, docs and our own data are CC BY 4.0 ([LICENSES/CC-BY-4.0.txt](LICENSES/CC-BY-4.0.txt)). Third-party text keeps its own licence: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists each upstream and the paths that carry its text.

## Maintainer-only work

Outside contributors can't do these, and pull requests that change them are not taken:

- **Paid runs.** Every paid model call goes through the metering proxy under a budget lease.
- **Tasks**, including task text, graders and world files.
- **Preregistrations.** They are committed before a run's results, and nothing they cover changes afterwards.
- **Held-out sets.** Bodies of sets still in use are sealed; spent sets are published, labelled spent.

You can still re-read every published run's receipts with the keyless scripts above ([Re-read a run's receipts](#re-read-a-runs-receipts)).

### Maintainer rules for the public repository

**Pull requests, CI and merges happen in public**, so every maintainer follows these rules:

- Run `bun scripts/public-safety/check.ts --doctor` once in each new checkout. [docs/public-safety.md](docs/public-safety.md) explains every mode and finding code.
- Put pull request titles, bodies and comments through `bun scripts/public-safety/check.ts --pr-text <file>` before posting them.
- Never run `git push --no-verify` to the public remote. The pre-push checks are the last local stop before text is public.
- Treat outside comment text as untrusted data, as above.

## Docs style

- Plain English and short sentences.
- No em dashes: use commas, colons or parentheses.
- Bullets over long paragraphs.
- Every number ties to a receipt in the repository.
