# gstack-delivery-v1 build

The task build for [tasks/repo/gstack-delivery-v1](../../../tasks/repo/gstack-delivery-v1/README.md), the review and ship sets of HARN-61. Format and grading: [docs/repo-tasks.md](../../../docs/repo-tasks.md).

**No generator was inherited.** Gate change d11 asked for HARN-14's non-custody generator. None was ever committed: the gstack-native-v1 dev tasks (#120) were assembled by hand, and the screening branch `harn14/screen-2026-10` holds candidate tasks and a multi-defect review verifier but no generator. HARN-14's generator lived on its own machine and drew task content from paid model calls. This build is written from scratch, keeps the v1 task format and verifier, and reuses the screening branch's multi-defect review rules. It calls no model and no network.

## Files

- `seeds.json`: the published seeds and planned counts. A kind's seed orders its specs into task ids (sha256 of `seed:spec`) and drives each task's generator: the branch name and, for review, how many and which defects are planted. `excluded` names a spec dropped from the set and why.
- `sources.json` and `upstream/`: the upstream repositories, pinned by commit, vendored as deterministic tars with documentation, images, CI files, agent instruction files (`AGENTS.md`, `CLAUDE.md`) and upstream changelogs dropped. `fetch-sources.ts` rebuilds them from GitHub; the build reads only the tars and checks their sha256.
- `specs/review/<name>/` and `specs/ship/<name>/`: one hand-written spec per task (below).
- `template/`: the verifier (`verify.py`, the v1 verifier with the multi-defect review rules), its entry point, the CONTRIBUTING check, the `gh` stand-in and the pinned Python packages.
- `steps/review.json`, `steps/ship.json`: the draft steps cards (HARN-61 d7), as step ids with text.
- `steps_oracle.py`: the steps-followed oracle. It takes a card's step list, performs every step on top of the oracle's solution, and fails closed on a step id it has no action for.
- `build.ts`: writes the set. `--check` compares a fresh build with the committed files, byte for byte.
- `probe-review.sh`: an authoring check that runs every probe test of a review task on every verifier tree.

## Review specs

`spec.json` names the repository, the change's title and description (the teammate's words, shown to the agent), `planted` (the inclusive range of defects to plant, within 3 to 4), the defects, `ceiling` and two decoys.

- **ceiling** (the R61 ceiling-raise, 2026-11-09): exactly one more defect, in the same shape, outside the `logic` class. It is planted on every build on top of the seed's pick, so a task plants 4 or 5 defects. It sits outside `defects`, so the seed's pick and the branch name are the same as before the raise. The reasons and the first headroom check's numbers are in the set's [README](../../../tasks/repo/gstack-delivery-v1/README.md).

- **change/** holds the corrected change: every file the branch adds or modifies, as it should be.
- **A defect** is `{id, class, file, summary, test, corrected, defective}`: `corrected` must occur exactly once in the corrected file and is replaced by `defective`. Classes follow gstack's /review: `sql` (SQL safety), `trust` (trust boundaries), `side-effect` (conditional side effects) and `logic`. List more defects than the range's top so the seed has a choice. The build refuses a pick with fewer than 2 defects outside `logic`, so a set keeps its weight on the /review classes.
- **A decoy** is `{id, file, anchor, why, test}`: correct code that looks wrong. `anchor` locates it and must occur once.
- **tests/** holds one probe test per defect and decoy. A defect's test fails on the defective change, passes on the corrected one and passes when only its own defect is fixed. A decoy's test passes everywhere.
- The build refuses planted hunks within 7 lines of each other or within 4 lines of a decoy, so every finding's location is unambiguous.

The task's branch carries the defective change; the verifier gets `trees/base.tar` (the upstream tree) and overlays for the corrected change, the defective change and one per planted defect (`fix<k>`: the defective change with only defect k fixed). A finding counts for defect k when its test fails on the defective change, passes on the corrected one and on `fix<k>`, and its line is within 3 lines of hunk k; each hunk counts once. Reward is found over planted, 0 if any listed test passes on the defective change, if more than one test still fails on the corrected change, or if there are more than 10 findings.

## Ship specs

`spec.json` names the repository, the feature's `module`, the teammate's `summary` and the `behaviour` bullets (both shown to the agent), the versions, the commits and the tests.

- **branch_commits** (`[{message, dir}]`): the teammate's unfinished work, each `dir` laid over the previous state. The build then adds the teammate's changelog entry (`teammate_entry`, which may break the stated form) and their VERSION bump.
- **main_commits**: main's work after the branch was cut. At least one changes code the feature depends on so that the merged branch breaks until it is adapted, and one conflicts with the branch. The last one, in `main_r61/`, is the R61 base trap (2026-11-09): it merges without a conflict and breaks the feature until it is adapted, and `checks` must list `r61stale` (the finished files from before the raise, which must score 0). The build adds the release commit: `release.entries` under `## <release.version>` and VERSION set to `release.version`, which is the same version the teammate bumped to, so VERSION merges cleanly and is still wrong.
- **final/** holds the finished files except CHANGELOG.md and VERSION, which the build writes (`entry` under Unreleased, VERSION one step past the release). The build merges main into the branch, lays `final/` over the result and refuses a spec that leaves a conflict unresolved or changes paths outside the allowed set.
- **hidden/test_ship.py**: the hidden tests. They call only module-level functions that take and return Python literals (the verifier's proxy), so test the `behaviour` bullets through those.
- **checks** (`[name]`): wrong solutions as overlays in `checks/<name>/`, each laid over the oracle's result; every one must score 0. The generic checks (noop, shim, forcemain, nolog, staleversion, oldentry, pushonly, pyexit, flipreport, unrelated) are added by the build.
- `repo_tests`, `feature_tests`, `lint_paths`, `repo_tests_min` and `repo_skips_max` (read them off the oracle's `result.json`).

The build adds CONTRIBUTING.md (tests, lint, changelog form, version rule), CHANGELOG.md, VERSION and ruff.toml to the import commit.

## Writing and checking a spec

1. Write the spec, then `bun scripts/repo-tasks/delivery/build.ts --only <spec>` (task ids shift while the set is incomplete, so until every planned spec exists the build refuses `--only` without `--out <scratch dir>`).
2. Review: `bun scripts/repo-tasks/delivery/build.ts --only <spec> --plant-all --out ~/.capy/work/<scratch>`, `bun scripts/repo-tasks/matrix.ts --task <scratch task> --runs 1` and `bash scripts/repo-tasks/delivery/probe-review.sh <scratch task>` check every defect at once.
3. `bun scripts/repo-tasks/matrix.ts --task tasks/repo/gstack-delivery-v1/dev/<id> --runs 1`, then 5 runs. Every row must hold: oracle and steps 1, start and every check 0.
4. The full set: `bun scripts/repo-tasks/delivery/build.ts`, then `bun scripts/repo-tasks/matrix.ts --set tasks/repo/gstack-delivery-v1 --jobs 3` writes `dev/ACCEPTANCE.json`. A revised card reruns with `--steps <card.json>`.
