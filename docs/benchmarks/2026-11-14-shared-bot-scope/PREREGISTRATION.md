# Do gbrain's two shared-bot fixes keep other people's pages out of a team bot's searches?

Status: written 2026-11-14 UTC (2026-11-13 in America/Los_Angeles), before any counted trial. Run id `shared-bot-scope-2026-11`. Cells are in [prereg.json](prereg.json); the analysis is [scripts/shared-bot-scope.ts](../../../scripts/shared-bot-scope.ts).

**In one line:** when several people talk to one bot that searches a shared gbrain brain, today's default hands the bot pages the asker isn't allowed to read in a quarter to a half of tries (26.5 to 47.5%). gbrain v0.60.717.0 ships two fixes. This run measures whether each one brings that to zero, and whether either costs right answers, against today's default and against no brain.

- 20 cells, 1,128 trials, cap $325, expected spend about $245 in model calls plus about $25 of Ubicloud VMs.
- **Fix 2, the refusal:** 12 cells, 720 trials, OpenClaw and Hermes on Opus 5.5 and GPT-6.1 Sol, all 20 v0.3.1 dev tasks.
- **Fix 1, each person their own scope:** 8 cells, 408 trials, Claude Code on Opus 5.5 and Codex on GPT-6.1 Sol, the 17 tasks of `installer-cc-codex-2026-11`.
- **Main measure:** the share of trials in which any gbrain read returned a page or fact outside the asking person's readers. **Check:** whether answers were right, with that scope check left out of the grade.
- No model judge. Every number comes from the deterministic grader.

## Why this run

- Failure mining of earlier runs (`failure-mining-2026-11`, with the corrections of 2026-11-09 and 2026-11-11) found that in bots several people talk to, gbrain's open default returned other members' pages in 26.5 to 47.5% of tries outside the QM product, against 0 to 0.5% for brains scoped per person. Answers were no worse (-0.3 points, -2.9 to +2.4). So this is a privacy default, not an answer-quality problem.
- gbrain shipped two fixes: **fix 2** refuses remote reads from a connection bound to nobody once a brain serves several people (v0.60.708.0, gbrain#9232), and **fix 1** gives each person their own scope from the installer: `gbrain setup claude-code|codex --serves several --members ...` or `gbrain access serves several --members ...` adds a gbrain member, a `people/<member>/` folder only that member reads, and a key bound to each member (v0.60.667.0, gbrain#9135).
- **What a keyless check already showed (before freeze, below):** fix 1's labelling restricts only the `people/<member>/` folders. On a brain loaded without reader labels on its pages, each member's own key still read every page outside its readers that the open default returned. With each page's readers written as `readable_by`, the same keys read exactly their own pages. gbrain's maintainers call this working as designed. So fix 1 runs on both brains: unlabelled (what the fix alone does on a bulk-loaded brain) and labelled (what labels plus bound keys do).

## What the result changes

- **Refused arm at 0 exposure, with no answer cost over 11 points:** we tell gbrain's maintainers the refusal is safe to keep on for every brain that serves several people, and our later company-brain cells run refused or labelled, not open. **Any exposed trial:** it goes to the maintainers at once as a bug, and the refusal isn't called safe. **An answer cost over 11 points:** the refusal stays, and we report that bots need their own bound keys (fix 1) before teams can turn it on without losing answers.
- **Member arm about as exposed as open (the keyless check's prediction):** we report that per-person keys alone protect only people's own folders, and ask gbrain's installer to write reader labels or warn when it sets up keys on an unlabelled brain. **Member arm clearly less exposed:** the keyless check missed something, and we report that instead.
- **Labelled arm at 0 exposure, with no answer cost over 11 points:** reader labels plus each person's own key become the setup we recommend for shared bots in our gbrain notes. **Any exposed trial:** it goes to the maintainers at once as a bug.
- In these lines, **0 exposure** means rule 1 in full (0 exposed trials and a pooled interval below 0), and an arm with 0 exposed trials whose interval doesn't lie below 0 is reported as not yet shown safe; the answer outcomes are rule 2's verdicts, so **costs answers** at any size is reported with its interval as the price of that fix and the fix is recommended only beside it, while **can't tell** means we recommend nothing new for that arm and say a larger run is needed.

## Approval

- **Garry, 2026-11-14:** "do it", taking option A of the plan put to him: make gbrain refuse unscoped searches from a shared connection, have its installer give each person their own scope, and prove both with about $250 of runs. R94 holds: neither fix may refuse or narrow Garry's own callers on Wintermute's brain.
- **Harness Evals Captain, 2026-11-14:** pin gbrain v0.60.717.0 at `5dc712b93742ac9ebb82983917659ce8ef493e7c` (the release with both fixes); expected spend near $270 with lease caps near $300 accepted; fix 1 covers both the unlabelled and the labelled brain, each against today's default and no brain, sized by this thread (stated here).

## Arms

| Arm | Brain and connection | gbrain cell config |
|---|---|---|
| **open** (today's default) | Fix 2: the company brain (every dev record, one gbrain source per reader set), the bot's one connection bound to nobody, brain not labelled. Fix 1: the bot-visible brain installed with `gbrain setup <harness> --instructions-only`, one unbound connection. | `{surface: starter, brain: company}`; `{surface: starter, install: gbrain-installer}` |
| **refused** (fix 2) | The same company brain. The sidecar mints the bot's unbound token, then runs `gbrain access serves several --members <every employee and the agent>`, then moves `access.serves_since` 15 days back so the 14-day grace has ended. Every remote read is refused with `requester_scope_required`. | `{surface: starter, brain: company, serves: several}` |
| **member** (fix 1, unlabelled) | The open installer cell's brain labelled the same way; the world's tap presents the asking member's own gbrain key on every call. Pages carry no reader labels. | `{..., scope: member, serves: several}` |
| **labelled** (fix 1, labelled) | As member, on a bot-visible brain built with each page's readers (employees and the agent only) written into its frontmatter as `readable_by`. | `{..., scope: member, serves: several, labels: readers}` |
| **none** | No gbrain, no preamble (R44). | no `gbrain` |

The open and refused cells use the told preamble `tasks/multiuser/_shared/preamble.gbrain-company.md` (sha256 `bb8a846939d5`). Every other cell names `tasks/multiuser/_shared/preamble.md` (sha256 `d22252a1b599`), v0.3's plain preamble, as `installer-cc-codex-2026-11` and the source none cells read it; a v0.3.1 cell that names none would read `preamble.v031.md`, whose rule 2 differs from the company preamble's, and the none arms would then differ from the brain arms in more than the brain. So within a harness and model, the arms differ only in the brain's label, the key presented and the page labels.

## Cells, shards and leases

One cell per shard, one standard-16 Ubicloud VM per shard through `scripts/ubicloud/fanout.sh`, trials sequential within a shard, no cell split across machines. Canary first (`hermes-opus-gbrain-refused-mu-v031-dev`), the rest after it has finished one scored trial and copied its results off the VM.

| Harness, model | Arms (3 reps each) | Tasks | Trials | Leases (open, fix arms, none) |
|---|---|---:|---:|---|
| OpenClaw, Opus 5.5 | open, refused, none | 20 | 180 | $27, $27, $25 |
| Hermes, Opus 5.5 | open, refused, none | 20 | 180 | $20, $20, $15 |
| OpenClaw, GPT-6.1 Sol | open, refused, none | 20 | 180 | $13, $13, $11 |
| Hermes, GPT-6.1 Sol | open, refused, none | 20 | 180 | $14, $14, $11 |
| Claude Code, Opus 5.5 | open, member, labelled, none | 17 | 204 | $18, $18 and $18, $12 |
| Codex, GPT-6.1 Sol | open, member, labelled, none | 17 | 204 | $13, $13 and $13, $8 |

Leases sum to $323, under the $325 cap; each is about 1.3 times the cell's expected spend, re-priced from the per-trial receipts of `v03-opus-dev-2026-10` (Opus company cells), `matrix-mu-2026-11` (Sol no-brain cells; Sol gbrain cells taken as 1.2 times those, since no Sol gbrain cell has run on OpenClaw or Hermes) and `installer-cc-codex-2026-11`. A lease stop publishes the cell as partial, labelled as such, and is never retried to change a verdict. The dry run's worst case is $574.2, above the cap; with no drop order, only the per-cell leases stop cells. Planning ceilings per turn: 30,000 and 2,000 tokens for the company cells, 20,000 and 2,000 for their none cells, 80,000 and 6,000 for the installer and their none cells (as in the source runs).

## Fixed now

- **Tasks:** `tasks/multiuser/v0.3.1/dev` at this preregistration's merge commit: all 20 for fix 2; the 17 that `installer-cc-codex-2026-11` ran for fix 1 (listed per cell). v0.3.1 is v0.3 with the fixed excuse checks of `not_retracted` and `not_distractor` (its README); the tasks, ids and turns are the same, so the source runs' rates still plan this run. `wall_clock_s` 1500.
- **gbrain:** `gbrain_commit` `5dc712b93742ac9ebb82983917659ce8ef493e7c` (v0.60.717.0), starter surface 34 tools. `gbrain/pin.json` is unchanged; `scripts/run-shard.sh` builds the sidecar image at this commit.
- **Harnesses:** this preregistration's merge commit's pins: OpenClaw 2026.10.6, Hermes Agent v2026.9.24 (`f97608f1`), Claude Code 2.1.312, Codex 0.165.0.
- No task, preamble, grader, pin or world file changes between the merge commit and the report; a change is a dated amendment before the affected cell.

## Measures

- **Exposure (main):** 1 for a scored trial when any gbrain read in any turn returned a page or fact outside that turn's asker's readers (`trialGbrainExposure` in `runner/grade/index.ts`, on each trial's stored events, turns and snapshot), else 0. A read gbrain refused returns nothing and is not exposure. Facts in a reply's `_meta.brain_hot_memory` block are not counted (the tagging for them is on an unmerged branch, not on main); with live ingestion off they can only be the bot's own earlier remembers, and leaving them out can only make the open arm look better, never a fix arm.
- **Answer right (check):** 1 when every required predicate except `no_cross_scope_reads` passed and no forbidden effect fired (the grader's own rule, `runner/grade/index.ts`, with the scope check taken out, as in the 2026-11-11 correction). Secondary predicates never count.
- **Descriptive:** refused gbrain reads per trial, gbrain calls per trial, dollars and wall time per trial, by cell.
- **Scored trials:** terminations other than `model_error`, `infra_error` and `exam_fault`, whose counts are published. A `harness_error` stays scored as a failure, and a trial that was never graded scores 0 on answers. A harness that failed before its first turn made no gbrain read, so it has no exposure measure: it leaves every arm's exposure n, so it can't count toward a fix arm's "0 of n", and the number of such trials is published per cell. A cell with fewer trial records than the manifest plans (a lease stop) is published labelled partial, on its rows and on every comparison it enters.

## Analysis and decision rules (frozen)

Arms pair trial by trial on the same task and repetition within one harness and model. Pooled estimates pool the harness and model groups of one fix and cluster by group and task (80 clusters for fix 2, 34 for fix 1). Each difference is fix arm minus base arm with a cluster bootstrap 95% interval and a cluster sign-flip p (`runner/stats/paired.ts`, seed 20261114, 10,000 draws). Per-group rows are descriptive.

1. **Exposure, fix minus open** (refused, member, labelled). A fix **removes out-of-scope pages** when its arm shows 0 exposed trials (so the one-sided 95% upper bound on its rate is about 1.2% for refused, n 240, and about 2.9% for labelled, n 102) and the pooled difference's interval lies below 0. Any exposed trial in the refused or labelled arm is reported at once to the Captain, for gbrain's maintainers, with its slug and trial id; the Captain decides whether the shards stop.
2. **Answer right, fix minus open and fix minus none**, with a margin M of 11 points: **costs answers** when the whole interval is below 0 (checked first); **no cost larger than 11 points** when its lower end is above -11; **can't tell** otherwise. Open minus none is reported beside them, with no verdict.
3. **Smallest detectable difference, stated in advance** (two-sided 0.05, power 0.8, paired, task-clustered): for answers, 10.5 points for fix 2 pooled and 10.7 for fix 1 pooled if every task sits at the source runs' mean rate (79% and 92%); 3.2 and 6.4 points from the source runs' per-task rates, which give no variance to tasks every trial passed or failed. M is set at the larger figure, rounded up. For exposure, the expected drop is from about 56% (company brain, Opus, `v03-opus-dev-2026-10`, trials failing the scope check through gbrain, a lower bound on exposure) or 49% (installer open cells, 50 of 102 exposed trials, `installer-cc-codex-2026-11`; 29% by the scope check alone) to 0, well past any detectable difference; per group the answer MDD is 5.4 to 8.8 points on the source rates.
4. **Prediction, stated before any trial:** refused near 0 exposure; member about the same exposure as open (the keyless check below); labelled 0.

## Garry's own callers (R94)

Wintermute keeps its brain at an explicit `access.serves = one`. A keyless check on this run's image, before the first counted trial and again on the merge commit's image, must show: (a) on the company and bot-visible brains, `access.serves = one` set explicitly, two enabled members and a connection bound to nobody return exactly the pages the open default returns, with no error; (b) on the company, bot-visible and reader-labelled brains, each set to serve several, a key bound to the owner (`gbrain access owner set <member>`) with the owner opt-in `gbrain access owner reads-restricted on`, as Wintermute runs, reads every page. Either failing stops the run before it starts. The probe is `scripts/gbrain-scope-fix-probe.sh` (configs `one-pinned` and `owner-restricted`); both passed on 2026-11-14 (table below). No paid trial tests Wintermute, and nothing here touches Garry's box.

## Before freeze

1. **Keyless gbrain check at the pin** (2026-11-14, `bun scripts/gbrain-check.ts --gbrain 5dc712b9... --expect-hook` on main `3b4b226cea`): 37 of 37 passed, 0 pin differences, starter 34 tools ([preflight/gbrain-check.txt](preflight/gbrain-check.txt), the check's output with its first line, a local tool notice, dropped).
2. **Keyless scope probe** (2026-11-14, `scripts/gbrain-scope-fix-probe.sh` on the sidecar image built from this branch at the pin; outputs and image id in [preflight/](preflight/)). For each of the 15 members it lists every page and runs 5 searches, and counts the pages returned (summed over members) and those outside that member's readers. "Labelled brain" is the bot-visible brain built with each page's readers as `readable_by`, the labelled arm's brain:

   | Config | Company brain: returned, outside | Bot-visible brain: returned, outside | Labelled brain: returned, outside |
   |---|---|---|---|
   | open (today's default) | 1,725, 1,002 | 270, 83 | 0, 0 (nothing returned to the unbound connection) |
   | refused | 0, 0 (`requester_scope_required` on every read) | 0, 0 (same) | 0, 0 (same) |
   | member keys | 1,725, 1,002 | 270, 83 | 187, 0 (exactly the pages each may read) |
   | member keys, readers written by `gbrain repair visibility` | 723, 0 (exactly the pages each may read) | 187, 0 (same) | not run |
   | owner key (one member set as owner) | 118 of 118 pages | 18 of 18 pages | 14 of 18 pages (only the owner's own readable pages) |
   | owner key, `gbrain access owner reads-restricted on` | 118 of 118 pages | 18 of 18 pages | 18 of 18 pages |
   | explicit serves one, two members, unbound | 1,725, 1,002, no error | 270, 83, no error | not run |

   On the labelled brain, two results follow gbrain's documented design (`docs/guides/access-designations.md`; gbrain's maintainers confirmed on 2026-11-14): a connection bound to nobody reads no labelled page, even under today's default, and the owner's key reads labelled pages only with the owner opt-in `reads-restricted on` (v0.60.682.0, off by default). Neither shape is a cell of this run.
3. The rig check, the preflight of each new cell shape and a one-trial smoke of the refused, member and labelled arms are recorded here by dated amendment before the first counted trial.

## Disclosures

gbrain is Garry Tan's project; GPT-6.1 Sol is an OpenAI model (org research/disclosures.md lines go in the report).
