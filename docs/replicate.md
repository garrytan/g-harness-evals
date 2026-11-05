# Check a finding yourself

**One command checks a finding from its trial bundle.** Two modes are free and need no key. The third reruns one cell with your own key, under a hard cap, and says whether the result lands where the published run predicts.

- **`--reanalyze`** (free): reruns the checked-in analyzers on the bundle and checks they print the finding's tables byte for byte.
- **`--estimate-only`** (free): prices a rerun of each cell from the run's own receipts.
- **Paid rerun**: one cell, your key, `--max-usd` as a hard cap. It prints `WITHIN BAND`, `OUTSIDE BAND`, `NO BAND` or `INCOMPLETE`.

A single-cell rerun checks **one cell's pass rate**. It does not recheck the finding's harness comparison; `--reanalyze` reproduces that from the bundle.

## Where the bundle comes from

A finding's front matter names its archive: `data: <URL> sha256 <digest>` and `rerun_commit: <sha>`. With `--finding <file>` the tool downloads and checks it for you.

**Until the repository is public, there is no public URL.** Get the archive from the person who sent you the finding, check its digest against the finding, and pass `--bundle <path> --sha256 <digest>` to every command below.

## The commands

```sh
git clone https://github.com/garrytan/harness-evals && cd harness-evals    # about 370 MB pack, 1.5 GB tree
git show origin/main:findings/<id>.md > ../finding.md                       # the finding lives on main, outside the pinned tree
git checkout <rerun_commit named in ../finding.md>
bun install --frozen-lockfile                                               # Bun 1.4.3 (package.json packageManager)

# Free: no key, no Docker, a few seconds to minutes
bun scripts/replicate.ts --bundle <archive> --sha256 <digest> --reanalyze
bun scripts/replicate.ts --bundle <archive> --sha256 <digest> --estimate-only

# Paid: your key, kept out of shell history
read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY
bun scripts/replicate.ts --bundle <archive> --sha256 <digest> --cell openclaw-sonnet-mu-heldout --max-usd 5
```

- **No terminal (a background job, CI)?** Add `--yes`. Without it the tool refuses before doing anything. With a terminal and no `--yes`, it asks you to type the cap back.
- **`--reps <n>`** sets repetitions per task (default 1). `--json` prints the report.
- **`--out <dir>`** is where a paid rerun keeps its state, ledger, logs, report and rerun bundle (default `replications/<run id>/` in this checkout). Git ignores everything there but `prereg.json` and `results/`. A downloaded archive goes to `replications/.bundles/`.
- With `--finding ../finding.md` instead of `--bundle` and `--sha256`, the tool reads both from the front matter.

## What H1's OpenClaw cell costs

**H1 is the tooling example only.** Its cells run Sonnet 5.5, and H1 is withdrawn from publication under R54 (frontier models only), so a rerun of it validates this tool and says nothing about a harness, gstack or gbrain. When the first frontier finding merges, the examples here move to it.

From `--estimate-only` on the H1 bundle (`m3-heldout-2026-10`, Sonnet 5.5), repriced at this commit:

| Reps | Trials | Expected | High (95th pct) | Smallest `--max-usd` | Time |
|---|---|---|---|---|---|
| 1 | 20 | $3.47 | $3.92 | $4.69 | about 30 min |
| 5 | 100 | $17.31 | $19.59 | $20.36 | about 2.5 h |

The smallest cap is the high estimate plus the largest single-request reservation ($0.77). The proxy reserves before each request, so the cap must leave room for one.

## What a paid rerun does

1. **Checks the bundle.** Its sha256 first, then every file against `bundle.json` (docs/trial-bundle.md).
2. **Checks this checkout matches the run (keyless).** Task files, preamble and seed world unchanged since the run commit; the harness pin (name, repo, version, commit, install) and image build arguments unchanged; and this commit's grader regrades every published trial of the cell to the same grade. It prints how much `runner/` and the harness directory changed since the run. Any mismatch refuses, unless `--accept-drift`, which labels the report a **drift experiment**.
3. **Estimates and checks the cap.** `--max-usd` below the smallest cap refuses (`--allow-short-cap` runs anyway).
4. **Runs the cell on this machine.** It builds the harness image from this checkout, plans with `run.ts plan --replication-of` (no openings-ledger row, docs/errors.md), and runs trials one at a time with `--stop-on-cap`. One lease in a local ledger under `--out` covers every request. Nothing goes to Ubicloud, Capy or any shared ledger.
5. **Checks completeness.** A cap stop, a trial with a refused-for-cap request, a trial that ended in a model, infra or exam error, or an interrupt makes the run **INCOMPLETE**: those trials are left out and nothing is extrapolated. The published counts leave out the same error terminations, as the run's own summary does.
6. **Compares.** Pass rate with a task-clustered 95% interval, the replication band (below) and the task-paired difference, rerun minus published.
7. **Reports.** One verdict line, `replicate-report.json` (schema version 1) under `--out`, and a bundle of the rerun (`rerun.bundle.tar.gz`) you can share.

**Requirements for the paid mode:** Linux x86_64, Docker, 20 GB free, a clean checkout at the rerun commit, the cell's provider key. macOS is refused: the metering proxy binds the Linux Docker bridge gateway.

**Your key** stays in the metering proxy's environment. Harness containers see only the proxy URL and a per-trial token. The tool checks the key is set, never prints it, and starts every child with an allowlisted environment.

## Interrupts and resume

- **Ctrl-C** stops the runner and its proxy and removes the trial's containers. The lease stays open. The report says INCOMPLETE. With no runner running (`--reanalyze`, `--estimate-only`, a download, the steps before the runner starts), Ctrl-C exits at once with status 130.
- **`--resume <out>`** continues the same run id under the same lease, from the commit the rerun started at. It never opens a new lease, so the cap cannot double.
- **A trial cut off mid-way** that was already charged is not replayed on its own. `--resume <out> --replay-charged` runs it again; its earlier spend still counts against the cap.
- **A cap stop is the end of that rerun.** Start a new one with a larger `--max-usd` if you want.

## The replication band

**The band says how many passes a rerun should get if nothing changed.** For each task, the true pass rate is drawn from Beta(k + 1/2, n - k + 1/2) on its published k of n, then the rerun's passes are drawn. The band is the central 95% of those totals, endpoints included (seed 20261101). A task the published run passed 5 of 5 can still miss; a band from the published rates alone would have zero width on 18 of H1 OpenClaw's 20 tasks.

**The band is only used where a simulation shows it works.** `scripts/replicate-band-coverage.ts` simulates published runs and reruns from the same truth and counts how often the band holds the rerun. The gate is 93%. Below it, the verdict is **NO BAND** and only the difference interval is printed.

H1 OpenClaw (`docs/replicate/band-coverage-m3-heldout-openclaw.json`, 4,000 rounds of 4,000 draws):

| Reps | Band (passes) | Attained | Coverage, posterior truth | Coverage, published rates | Gate |
|---|---|---|---|---|---|
| 1 | 12 to 17 of 20 | 97.5% | 98.3% | 100% | passes |
| 5 | 65 to 80 of 100 | 96.6% | 92.0% | 94.6% | **fails: NO BAND** |

**So for H1 OpenClaw, a 1-rep rerun gets a band verdict and a 5-rep rerun gets the difference only.** At 5 reps the band built from one noisy published run is too narrow about 8% of the time.

## Verdicts and exit codes

| Verdict | Exit | Meaning |
|---|---|---|
| WITHIN BAND | 0 | the rerun's passes are inside the band |
| OUTSIDE BAND | 4 | outside it |
| NO BAND | 5 | the band failed its coverage check at this rep count, or the published counts and the rerun cover different tasks (a task whose published trials all ended in errors); read the difference |
| INCOMPLETE | 3 | cap stop or interrupt; nothing compared |
| refusal | 2 | an HE-REPL or HE-BUNDLE code, with a fix line (docs/errors.md) |

`--reanalyze` exits 0 when the output matches and 4 when it differs.

**One miss is a signal to look, not a refutation.** A newer model snapshot behind the same model id, harness dependencies resolved when the image was built, or a provider-side change can all move a rerun.

## The report

`replicate-report.json`: `schema_version`, `mode`, `label`, `tool` (commit, Bun, platform), `bundle` (digest, run, commits), `rerun` (run id, commit, cell, reps, image, resumes, interrupted, drift_experiment), `equivalence`, `estimate`, `spend` (cap, committed, lease open), `completeness`, `published`, `rerun_result`, `band` (or null), `difference`, `verdict`, `exit_code`, `causes_of_a_miss`, `rerun_bundle`. A refusal with `--json` prints `{schema_version, error: {code, message, identities, trace}}`.

## Limits

- **gbrain cells are not rerun yet.** Their corpus, sidecar image and paid preflight probe are outside the equivalence check.
- **QM cells are not rerun yet.** QM needs its pinned `qm-sandbox` image and its sandbox teardown, which this tool does not build or clean.
- **Only held-out runs are rerun.** The rerun plans through `run.ts plan --replication-of`, which takes registered held-out runs only, so a dev-only run (matrix-mu, for example) gets `--reanalyze` and `--estimate-only` but no paid rerun.
- **Sealed sets are never rerun.** A sealed opening's bundle carries only its public export; `--replication-of` refuses any set in sealed custody.
- **The estimate is approximate** when the run's request lines lack cache-write counts; it is then rounded up.
