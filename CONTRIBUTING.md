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

### Limit for chronic submitters

Most contributors have no limit. A limit applies only to an author who, in the last 30 days in this repository:

- had 3 or more pull requests closed without being taken, **and**
- had fewer than 1 in 4 of their decided pull requests taken.

Such an author may have **at most 3 open pull requests**. We close the rest with a note that names the limit.

- The limit lifts once 2 of their pull requests in a row are taken.
- It never applies to an author with 3 or more taken pull requests in the last 30 days, whatever their ratio.

## Run the keyless checks

**These checks call no model API and need no keys.** Install [Bun](https://bun.sh/) and Python 3, then run from a clone:

```sh
bun install --frozen-lockfile
bun test tests/
bunx tsc --noEmit
python3 scripts/check-links.py
bun runner/prereg/prereg.ts
bun scripts/seal-heldout.ts --check
```

- `bun test tests/` takes about 25 minutes on a 4 vCPU machine.
- `bun runner/prereg/prereg.ts` reads git history and can take a long time on a clean clone.
- **CI is the reference.** If your local result differs from the GitHub Actions run on the same commit, trust CI and say so in your report.

## Maintainer-only work

Outside contributors can't do these, and pull requests that change them are not taken:

- **Paid runs.** Every paid model call goes through the metering proxy under a budget lease.
- **Tasks**, including task text, graders and world files.
- **Preregistrations.** They are committed before a run's results, and nothing they cover changes afterwards.
- **Held-out sets.** Bodies of sets still in use are sealed; spent sets are published, labelled spent.

You can still re-read every published run's receipts with the keyless scripts in the README.

## Docs style

- Plain English and short sentences.
- No em dashes: use commas, colons or parentheses.
- Bullets over long paragraphs.
- Every number ties to a receipt in the repository.
