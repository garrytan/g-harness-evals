# gstack-delivery-v1

Repository tasks for testing whether delivering gstack's review and ship steps by hook or startup file makes agents follow them and pass more (HARN-61). Format and grading: [docs/repo-tasks.md](../../../docs/repo-tasks.md). This file is written by `scripts/repo-tasks/delivery/build.ts`.

- **dev/**: 16 review tasks and 16 ship tasks, all public. There is no held-out split.
- **Seeds:** review `gstack-delivery-v1/review/2026-11-09`, ship `gstack-delivery-v1/ship/2026-11-09` (`scripts/repo-tasks/delivery/seeds.json`). The seed orders the specs into task ids and picks each branch name and, for review, which of a spec's defects are planted.
- **Specs:** hand-written, one per task, under `scripts/repo-tasks/delivery/specs/`. No model call wrote them.

## R61 ceiling-raise (2026-11-09)

The set was made harder once, under rule R61, after the first headroom check (HARN-61 plan step 7: none arm, 1 try, tasks at d17fd9bc).

- **What the check found.** Claude Code with Opus 5.5 passed review 13/16 (mean reward 0.906) and ship 16/16. Codex with GPT-6.1 Sol passed review 8/16 (0.50) and ship 13/16. Review rewards differed between the two cells on 7 of 16 tasks and ship on 3 of 16.
- **Why that fails the gate.** Big decision 7 needs the none arm between 15% and 80% per kind and at least half the tasks varying. Ship was at 91% and review had too few varying tasks.
- **Review change.** Every review task plants one more defect: the spec's `ceiling` defect, always outside the logic class (SQL safety, trust boundaries or conditional side effects), on top of the seed's pick, which is unchanged. The two decoys stay. On the 8 tasks both cells passed (review-04, 05, 07, 08, 09, 10, 14 and 16) the added defect is one that looks correct inside its hunk and needs the surrounding code to see.
- **Ship change.** Every ship task has one more commit on main before the release (`main_r61/` in its spec): a base change that merges without a conflict and breaks the feature until it is adapted, so only a merge followed by a full test run catches it. The `r61stale` check (the old finished files, not adapted) must score 0. On the 13 tasks both cells passed (all but ship-08, 15 and 16) the break shows only in a repository test outside the feature's own tests.
- **Room for the new defect.** Planted hunks must sit more than 7 lines apart and more than 4 from a decoy. To make room, 8 review changes moved existing code without changing what it does (review-02, 04, 07, 08, 09, 13, 15 and 16: a function moved, or a few lines pulled into a helper), review-03 plants its defect in a base line the change relies on, and review-12 adds a two-line interval guard that the defect then drops. Review-16's added defect is the same kind of bug as one it already plants, so it is the weakest of the 8 hard additions.
- **Wrong solutions kept honest.** Where a ship task's existing per-task check is a whole file, it was rebuilt on the adapted finished file so it still fails for its own reason, not for missing the R61 adaptation.
- **Unchanged.** 16 + 16 tasks, the seeds, the task ids, the instructions' wording and the steps cards.

| Task | Kind | Spec | Source | Shape |
|---|---|---|---|---|
| gd-dev-review-01 | review | tabulate-html-export | tabulate (MIT) | 4 planted defects, 2 decoys |
| gd-dev-review-02 | review | cachetools-async | cachetools (MIT) | 5 planted defects, 2 decoys |
| gd-dev-review-03 | review | bottle-static-route | bottle (MIT) | 4 planted defects, 2 decoys |
| gd-dev-review-04 | review | cachetools-sqlite-cache | cachetools (MIT) | 4 planted defects, 2 decoys |
| gd-dev-review-05 | review | bottle-json-signed-cookies | bottle (MIT) | 4 planted defects, 2 decoys |
| gd-dev-review-06 | review | schedule-run-history | schedule (MIT) | 5 planted defects, 2 decoys |
| gd-dev-review-07 | review | peewee-query-args | peewee (MIT) | 5 planted defects, 2 decoys |
| gd-dev-review-08 | review | tinydb-sqlite-storage | tinydb (MIT) | 5 planted defects, 2 decoys |
| gd-dev-review-09 | review | more-itertools-replayable | more-itertools (MIT) | 4 planted defects, 2 decoys |
| gd-dev-review-10 | review | tinydb-directory-storage | tinydb (MIT) | 4 planted defects, 2 decoys |
| gd-dev-review-11 | review | jmespath-sqlite-where | jmespath (MIT) | 4 planted defects, 2 decoys |
| gd-dev-review-12 | review | schedule-config | schedule (MIT) | 5 planted defects, 2 decoys |
| gd-dev-review-13 | review | peewee-archive-rows | peewee (MIT) | 5 planted defects, 2 decoys |
| gd-dev-review-14 | review | jmespath-query-library | jmespath (MIT) | 4 planted defects, 2 decoys |
| gd-dev-review-15 | review | tabulate-sql-export | tabulate (MIT) | 4 planted defects, 2 decoys |
| gd-dev-review-16 | review | more-itertools-ranges | more-itertools (MIT) | 5 planted defects, 2 decoys |
| gd-dev-ship-01 | ship | inflection-custom-rules | inflection (MIT) | main released 0.6.0 |
| gd-dev-ship-02 | ship | bottle-html-attrs | bottle (MIT) | main released 0.15.0 |
| gd-dev-ship-03 | ship | bottle-accept-best-match | bottle (MIT) | main released 0.15.0 |
| gd-dev-ship-04 | ship | schedule-12-hour | schedule (MIT) | main released 1.3.0 |
| gd-dev-ship-05 | ship | jmespath-string-functions | jmespath (MIT) | main released 1.2.0 |
| gd-dev-ship-06 | ship | more-itertools-argmin-options | more-itertools (MIT) | main released 11.3.0 |
| gd-dev-ship-07 | ship | more-itertools-weighted-mean | more-itertools (MIT) | main released 11.3.0 |
| gd-dev-ship-08 | ship | tabulate-records | tabulate (MIT) | main released 0.10.0 |
| gd-dev-ship-09 | ship | schedule-spec-text | schedule (MIT) | main released 1.3.0 |
| gd-dev-ship-10 | ship | more-itertools-tensor-shape | more-itertools (MIT) | main released 11.3.0 |
| gd-dev-ship-11 | ship | jmespath-group-by | jmespath (MIT) | main released 1.2.0 |
| gd-dev-ship-12 | ship | inflection-identifier | inflection (MIT) | main released 0.6.0 |
| gd-dev-ship-13 | ship | inflection-acronyms | inflection (MIT) | main released 0.6.0 |
| gd-dev-ship-14 | ship | bottle-stpl-raw-blocks | bottle (MIT) | main released 0.15.0 |
| gd-dev-ship-15 | ship | tabulate-bbcode | tabulate (MIT) | main released 0.10.0 |
| gd-dev-ship-16 | ship | tabulate-column-names | tabulate (MIT) | main released 0.12.0 |

**Licenses.** Each task copies files from its source repository, pinned by commit in `scripts/repo-tasks/delivery/sources.json`: the working tree inside `environment/work.tar` (with the repository's own license file), the review base tree in `verifier/trees/base.tar`, and single files under `verifier/trees/`, `verifier/protected/` and `oracle/final/`. Every copy stays under its upstream license; the texts are in [LICENSES/](LICENSES/) (all MIT).

**Acceptance.** [dev/ACCEPTANCE.json](dev/ACCEPTANCE.json) holds each task's matrix from `scripts/repo-tasks/matrix.ts`: the image ids it ran on and the reward of every run of the oracle, the steps-followed oracle, the starting state and each check.
