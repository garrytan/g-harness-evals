# Check every published analysis against its receipts

**`bun run verify` rebuilds every published run's analysis files from the files saved during the run, and fails if a single value differs.** It needs no API keys and calls no model. CI runs it on every pull request and on main.

```sh
bun install --frozen-lockfile
bun run verify                                 # every published run, then the README and scoreboard page (a few minutes)
bun run verify --run 2026-11-04-matrix-mu      # one run
bun run verify --list                          # what each run rebuilds, and what it can't
```

## What it checks

- **Receipts** are the files a run saved while it ran: `trials.jsonl` (one line per trial), ledgers and proxy logs.
- **Analysis files** are what our scripts computed from them: `summary.json`, `comparisons*.json`, `analysis.json` and the tables in them. Reports and the README quote these.
- For each run, verify reruns that run's own scripts (as they are today) on its receipts, in a scratch copy, and compares the result with the committed analysis file, value by value.
- **Values the published file has are what count.** If a script gained a new field or table row after a run was published, the rebuild has values the published file doesn't. Those aren't published, so verify counts them in the run's line and doesn't compare them. A published value that is missing from the rebuild, or differs, is a mismatch.
- Then it rebuilds the README's rankings block and `docs/scoreboard.md` from those analysis files and compares them too. Each README row is printed with the status of the run it comes from.
- Last, it rebuilds `docs/receipts-manifest.json` and confirms the receipts themselves still match the hashes, trial counts and cell counts recorded when they were committed.

## What it does not check

- **Numbers typed into report prose.** A report's sentences are written by hand. verify checks them only where a recipe compares a printed table with the report it was pasted into (`contained_in`, below).
- **A published file that lost values.** verify compares the values the published file has. For now, a committed file with fewer values than the rebuild (rows cut off, or the file emptied) still passes; the run's line counts the extra values the rebuild has. A file listed under `public_copy_omits` whose committed copy is missing is rebuilt but not compared, in the full repository too.
- **Runs with nothing to rebuild from.** Some runs never committed the inputs, or the script that made their numbers is gone. Their recipe says so under `not_rebuilt`, and verify prints every one of them on every run as `CAN'T REBUILD`, so CI stays green without hiding them.
- **The public copy** (`garrytan/g-harness-evals`) leaves some private folders out. A run that needs one is printed as `UNAVAILABLE` there: not a pass, and not a failure. In the full repository (it has a `publication/` folder) an `UNAVAILABLE` run fails verify, because a missing script or input there means the run is no longer checked.
- **Labels the public copy rewrites.** The public copy replaces internal task codes with `internal-task` and cloud machine names with `<vm name>` in its scripts, but keeps the result files exactly as committed. So those two kinds of label compare as equal. Numbers, model names and every other word still have to match.
- **Commit ids.** The manifest also records the commit that added each preregistration. Those ids only exist in the history they came from. The public copy has its own history, so there verify compares them only when the clone has that commit, and the output counts the ones it skipped. In the full repository every recorded commit must be in the history, and one that isn't is a mismatch. When the public copy holds a run's trial list back for a later export, that run's manifest row is skipped, and the output names the run. A ledger, usage log or extra trial list that the manifest names but the public copy leaves out is counted in the output, not compared. These skips apply only in the public copy (a checkout with no `publication/manifest.json`); in the full repository a missing receipt is a mismatch. CI checks out the full history, so it compares the commit ids too. The preregistration check (`bun runner/prereg/prereg.ts`) covers preregistration order.

## Reading the output

| Line | Meaning |
| --- | --- |
| `MATCH` | Every value in the run's published files equals the rebuilt one. |
| `KNOWN` | It matches apart from differences listed in the recipe, each printed with its reason. |
| `DIFFERS` | A published value doesn't match. Each `MISMATCH` line names the file, the value's path, the published value and what the receipts give. The command exits 1. |
| `CAN'T REBUILD` | Nothing in this run can be rebuilt from receipts; the recipe says why. |
| `UNAVAILABLE` | This copy of the repository lacks a file the rebuild needs. A failure in the full repository; allowed only in the public copy. |

A typical mismatch:

```text
DIFFERS 2026-11-04-matrix-mu: 2 published files rebuilt, 458 numbers compared, 1 s
    MISMATCH results/matrix-analysis.json: the number at cost_split.unallocated_share.qm-pi-opus-none-mu-v03-dev is published as 0.235865, but rebuilding from the receipts gives 0.236.
```

## Recipes

Each published run has one file, `scripts/verify/runs/<folder>.json`, named after its folder under `docs/benchmarks/`. verify and a test fail when a run folder that has a `report.md`, a row in `docs/scoreboard/reports.json` or a scoreboard row has no recipe, so a new results PR adds one.

```json
{
  "run": "2026-11-04-matrix-mu",
  "about": "One line on what this run publishes.",
  "requires": ["tasks/multiuser/v0.3"],
  "steps": [
    {
      "cmd": ["bun", "scripts/matrix-analysis.ts", "--results", "{run}/results", "--spec", "{run}/matrix-spec.json", "--out", "{run}/results"],
      "outputs": ["results/matrix-analysis.json", "results/matrix-analysis.md"]
    }
  ],
  "known": [
    { "file": "results/matrix-analysis.json", "path": "cost_split.unallocated_share.qm-pi-opus-none-mu-v03-dev", "committed": 0.235865, "rebuilt": 0.236, "reason": "Why, in one sentence." }
  ],
  "volatile": [
    { "file": "results/comparisons.json", "path": "exposure.grader_commit", "reason": "The checkout's commit id, different on every commit." }
  ],
  "not_rebuilt": [
    { "what": "The cost table in report.md", "reason": "The proxy log it was computed from was never committed." }
  ]
}
```

- **`steps`** run in order, from the repository root. `cmd` is a list of arguments, and may only start with `bun` or `python3`. `{run}` is the scratch copy of the run's folder; `{src}` is the committed folder, for reading only.
- **`outputs`** are the files the step writes, as paths inside the run folder. Each must have a committed copy, which is what gets compared. JSON is compared value by value (key order doesn't matter, and numbers must be equal as written). Any other file is compared line by line, with inserted lines lined up the way `git diff` does, so one new row doesn't shift everything after it.
- **`self_check`** marks a step that runs a script's own `--check` mode, for the few run scripts that can only read and write fixed paths in the committed folder. It passes on exit 0 and is a mismatch on exit 1; it may not list outputs.
- **`stdout`** compares what the step prints: `{ "file": "results/summary.md" }` against a committed file, or `{ "contained_in": "report.md" }` to require that the printed text appears, unchanged, inside that file.
- **`known`** lists differences we already know about: the file, the JSON `path` (or text `line`), the published value, the rebuilt value and why. Leave out `committed` or `rebuilt` when that side has no value. If the difference stops happening, verify fails and asks you to delete the entry, so the list can't go stale. Send every new one to whoever owns correcting published numbers.
- **`volatile`** lists values that change on every rebuild and are not results, such as a commit id or a timestamp. They are not compared. In a JSON file give the `path`; in a text file give a `pattern` (a regular expression) for the text to skip. A volatile value that holds a number, or a pattern that hides text with no letters in it, is refused: a number must match, or be listed under `known`.
- **`not_rebuilt`** lists published things the recipe can't rebuild, with the reason. A recipe with no steps must list at least one.
- **`public_copy_omits`** lists rebuilt files that the public copy leaves out on purpose, each with the reason, for example a file that carries a cost total. Where the committed copy is missing, the file is rebuilt but not compared, and the output says so. Where it is present, it is compared as usual.
- **`requires`** lists repository paths the rebuild needs besides the scripts its steps run (those count automatically). If one is missing, the run is `UNAVAILABLE`.

## How it stays safe

- **No keys.** Every step runs with an empty environment apart from `PATH`, `HOME` (a scratch folder), `TMPDIR`, `LANG=C.UTF-8`, `TZ=UTC` and `NO_COLOR=1`, and bun runs with `--no-env-file`. So no step can read an API key, even by accident.
- **Receipts are never rewritten.** Each run's folder is copied into `.verify-scratch/` (ignored by git), every file a real copy, with the files a step writes left out, so a step writes fresh files there and can't change a committed file. verify compares `git status` of `docs/benchmarks/` before and after, and fails if anything there changed.
- **Today's scripts.** verify runs the analysis scripts as they are now, not as they were when the run was published. So a script change that moves an old run's published number fails CI until the script is fixed or the difference is recorded under `known`.
