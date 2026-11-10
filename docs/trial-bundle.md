# Trial bundles

**A trial bundle is one archive per finding that holds the run's trial-level data, with a sha256 the finding file prints.** Anyone with a harness-evals checkout can check that the archive is the one we published, see exactly which files are in it and why, and recompute the finding's tables from it without trusting our report.

- Build: `bun scripts/bundle.ts build --run docs/benchmarks/<run> --finding <id> --out <dir> [--receipts-commit <ref>] [--run-commit <sha>] [--rerun-commit <sha>] [--local] [--analysis summarize-run,compare-run]`
- Check: `bun scripts/bundle.ts verify <archive> --sha256 <digest> [--rebuild] [--max-bytes <n>] [--max-entries <n>]`
- Keyless, no network, no model calls. Exit 0 on success, 2 on any refusal, with one `HE-BUNDLE-00x` line on stderr ([errors.md](errors.md#trial-bundles-harn-24)).

## What is in a bundle

The archive is a gzipped, reproducible ustar (sorted paths, mtime 0, owner 0, mode 0644, no gzip name or time). The same receipts built from the same checkout `HEAD` by the same Bun give the same bytes, so the digest is a stable name. `bundle.json` records the generator's `HEAD`, so a build from another commit gets another digest.

**Build a published bundle from main, after the results merge.** Pull requests are squash-merged, so a branch commit is not reachable from main afterwards and `--rebuild` could not find it. The finding file that prints the bundle's digest comes in a later pull request.

| Path | What |
|---|---|
| `bundle.json` | The manifest: schema, profile, run id, the commits, the cells, the rerun block and every other file with its sha256 and size. |
| `prereg.json` | The run's preregistration, verbatim. |
| `results/` | The run's results directory as committed, minus harness-owned files. `trials.jsonl` is byte for byte, so its sha256 still matches [receipts-manifest.json](receipts-manifest.json). |
| `sealed-results/` | Only in a sealed-export bundle: the opening's public export files. |
| `analysis.json`, `expected-output.txt` | Only with `--analysis`: which checked-in analyzers ran, with which fixed arguments, and what they printed. |
| `README.md` | A short note on the above. |

**What is left out is a rule, not a choice per bundle:** whatever [scripts/publish-audit.ts](../scripts/publish-audit.ts) `harnessOwned()` treats as harness-owned (`trial.json`, harness state and workspace, sidecar tokens, logs other than `adapter.log` and the per-trial receipts the preregistrations name). These files hold per-trial credentials of the simulated world, which is why they never reach main either.

## bundle.json

| Key | Meaning |
|---|---|
| `schema` | `eval-trial-bundle/1`. A reader refuses any other major version (HE-BUNDLE-006). |
| `profile` | `harness-evals/results-1` (a plaintext run) or `harness-evals/sealed-export-1` (a sealed opening's public export). Another repository adds its own profile under the same envelope. |
| `run_id`, `run_dir` | The run, and its directory in this repository. |
| `run_commit` | The commit the run executed from: by default the commit that added `prereg.json`. |
| `receipts_commit` | The commit the bundled files were read at: the last commit at or before `--receipts-commit` (default `HEAD`) that touched `prereg.json`, `results/` or `sealed-results/`. Later unrelated commits do not move it. `null` for a `--local` bundle. |
| `rerun_commit` | For a bundle of a fresh rerun, the commit the rerun executed from. Otherwise `null`. |
| `source` | `committed` or `local`, and the file rule above in words. |
| `prereg` | Path, sha256 and adding commit of the preregistration. |
| `cells` | The preregistration's cells, verbatim. |
| `held_out` | Whether the tasks are sealed. A results bundle is always a plaintext run. |
| `rerun` | `available`, the cell ids a rerun may name, and the default repetitions (1). False for a sealed export: nobody can rerun a sealed set until it retires. |
| `generator` | `scripts/bundle.ts`, the checkout's `HEAD` and whether the work tree was dirty. |
| `files` | Every file but `bundle.json`, sorted, with sha256 and bytes. |

H1 (`m3-heldout-2026-10`) shows why there are two commits: its preregistration was committed at `3c7e7653b` and its results later. `run_commit` is the first, `receipts_commit` the last commit that touched its results.

## What build refuses

- **A run on a sealed set** (HE-BUNDLE-002): a results tree that `scripts/check-sealed-publication.ts` flags, or a run whose `results/manifest.json` was planned with a sealed root. A sealed opening is bundled from its public export only. Once its set is released, the run's raw receipts are on main beside the export, and the bundle holds both under the results profile.
- **Custody material in a bundled file** (HE-BUNDLE-002): an age identity, a custody access log or age ciphertext, checked on the exact files going in, untracked `--local` files included. A `--local` run whose preregistration opens a set in sealed custody, or a set sharing its world slice or corpus with one that is, is refused too.
- **A token** (HE-BUNDLE-003): every file is scanned with publish-audit's token patterns and allowlist before it is packed. A hit stops the build and names the file and the pattern, never the token. A token in committed receipts is a leak: stop, do not strip and retry, and report the path and pattern to internal-task.
- **A bad flag or an unreadable run** (HE-BUNDLE-001).

`--local` bundles a fresh rerun whose results are not committed: the same rule over the files `git ls-files --cached --others --exclude-standard` lists, so git-ignored files are left out as a commit would leave them, and the same scan. When none of the run directory's files are tracked, the `check-sealed-publication.ts` scan is skipped, because it only reports tracked paths; the custody-material and token checks still run on every file. A symbolic link, or a file under a linked directory, is refused (HE-BUNDLE-001), never followed. A committed link or submodule is refused the same way.

## What verify checks

1. **The digest first** (HE-BUNDLE-005): the archive's size is checked against the caps and its sha256 is computed by streaming, and `--sha256` is compared, before the archive is read into memory. The `VERIFY:` line says `sha256_checked=yes` or `no`; without a digest, verify only checks the archive against its own manifest, which anyone who edits the archive can rewrite. `--sha256` with no value, `--sha256=<hex>` and any unknown flag are refused.
2. **Safe reading** (HE-BUNDLE-004, [runner/archive.ts](../runner/archive.ts)): gunzip under a byte cap, a walk over the tar headers that enforces the entry and byte caps before any entry is copied, then the tar reader sealed custody already uses, which refuses links, devices, absolute or `..` paths, duplicates and truncated entries. Caps default to 200,000 files and 2 GiB (`--max-entries`, `--max-bytes`).
3. **The manifest** (HE-BUNDLE-006 and 007): a known schema major and profile, then every file against `bundle.json`. A missing, extra or changed file refuses the whole bundle.
4. **`--rebuild`** (HE-BUNDLE-008): rebuild the bundle from this repository at `receipts_commit` and compare every data file and the manifest's `profile`, `run_id`, `run_dir`, `prereg`, `cells`, `held_out` and `rerun`. `run_commit` and `rerun_commit` must be full shas of commits in this repository, and `run_commit` an ancestor of `receipts_commit`. When the bundle has `analysis.json`, each step must be the checked-in step for its id, no step may repeat, and the analyzers are run again on the repository's files and must print `expected-output.txt` exactly; if `summarize-run` or `compare-run` changed since the bundle's generator commit, run `--rebuild` from that commit. `README.md` must be the one this repository writes. This shows the bundle holds what main holds, not just what its own manifest says.

**Nothing in an archive is ever executed.** `--analysis` names analyzers from a fixed list in `scripts/bundle.ts` (`summarize-run`, `compare-run`, each with `--seed 7`) and runs the checked-in copies on the bundle's files at build time. The archive records only their ids.

## Where it is used

A finding file's `data:` line names a bundle and its sha256. `scripts/replicate.ts --bundle <path>` ([replicate.md](replicate.md)) reads a bundle to re-analyze a finding or rerun one of its cells. Until the repository is public, outsiders get the archive by hand and pass its local path.
