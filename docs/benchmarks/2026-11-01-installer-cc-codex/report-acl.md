# Installer rung for Claude Code and Codex with gbrain's access rules on (installer-cc-codex-acl-2026-11): report

**Answer: with gbrain's per-member access rules switched on, no gbrain read in any of the 204 gbrain trials returned a record the asker may not read. So installer against told is "Not distinguished" on both hosts, by construction.** Every row here is dev.

- **The rules closed the exposure.** Cross-scope exposure via gbrain was 0 of 51 in all four gbrain cells. In the first run, with no rules, it was 33, 20, 17 and 9 of 51 ([report.md](report.md)).
- **gbrain no longer costs Claude Code its pass rate.** Claude Code passed 46 of 51 with no brain, 49 told and 50 with the installer. In the first run it was 46, 31 and 27.
- **Against no brain, every gbrain cell passed as often or more.** Claude Code installer **+8 points [+0, +22]**, told +6 [-4, +20]. Codex installer **+12 [+0, +24]**, told +4 [+0, +10]. These are descriptive, with no test. Every interval reaches zero.
- **Both no-brain cells reproduced the first run exactly:** 46 of 51 on Claude Code and 43 of 51 on Codex.
- **The installer still costs more per trial.** Against told it added $0.053 on Claude Code and $0.041 on Codex [intervals below], from more gbrain calls and more input tokens.
- **Clean run.** 306 of 306 trials completed. No cap stop, no model error, no refused proxy request. No trial file or harness transcript contains "gstack".
- **Spend: $55.57 of the $85 cap** for counted trials, plus $1.61 of shard smokes. Ubicloud VMs $2.67 at list price.
- **Why null? verdicts:** **KEEP** gbrain with member access rules on both hosts. For installer against told, **FIX-METHOD** (saturated; ceiling-raise named below) ([Why null?](#why-null)).

## What ran

- **Six cells, 306 trials.** Claude Code 2.1.312 on `claude-opus-5-5` and Codex 0.165.0 on `gpt-6.1-sol`. Each host ran three arms:
  - **installer:** gbrain's own setup wrote its block into `CLAUDE.md` or `AGENTS.md` and a per-turn hook.
  - **told:** the eval's gbrain preamble tells the agent about gbrain instead.
  - **no brain:** no gbrain at all.
- **What changed from the first run:** gbrain `f650eac5` (v0.60.554.0) instead of `a590ad07`. The brain is an access-ruled member brain. Each trial's gbrain token is bound to the member asking (`gbrain access member add`, then `gbrain auth rescope --member`). Before, one bot token served every asker with no rules.
- **What stayed:** the 17 public v0.3 dev tasks, 3 repetitions, both harness pins and models, ceilings, preambles, the installer route and the endpoints.
- **Machines.** One Ubicloud standard-16 VM per cell in eu-central-h1, all from commit `289aa043666f` (#232, the merge of this run's preregistration).
- **Preregistration.** [PREREGISTRATION-acl.md](PREREGISTRATION-acl.md) and [prereg-acl.json](prereg-acl.json), amendment 3 of the first run, merged before any trial.

## Primary endpoint: cross-scope exposure via gbrain

Installer minus told, paired by task and repetition, all 17 tasks. "Cross-scope exposure" means a gbrain read returned a page or fact the person asking may not read. Source: [results-acl/comparisons.gbrain.md](results-acl/comparisons.gbrain.md), "All tasks".

| Host, model | Told | Installer | Installer minus told [95% CI] | p | Decision |
|---|---|---|---|---|---|
| Claude Code, Opus 5.5 | 0 / 51 | 0 / 51 | +0 [+0, +0] | 1.000 (degenerate) | **Not distinguished (dev)**: the rules closed the exposure |
| Codex, GPT-6.1 Sol | 0 / 51 | 0 / 51 | +0 [+0, +0] | 1.000 (degenerate) | **Not distinguished (dev)**: the rules closed the exposure |

- **As preregistered:** when both arms of a host show no exposure, the decision is "Not distinguished" by construction, and pass rate against no brain becomes that host's main descriptive result.
- **Cross-scope reads via gbrain** (a gbrain read of a record outside the asker's scope, returned or not) were also 0 of 51 in every gbrain cell.
- **Refused by tool: 0 in every cell.** gbrain did not refuse any call for scope. It left unreadable pages out of what it returned.
- **No trial left the pairing.** 0 `model_error`, `infra_error`, `exam_fault` or `installer_not_applied` trials.

### The 39 unmapped returns, audited

`compare-run.ts --require-exposure` exits 2 and marks exposure not ready, because the stock grader left **39 returned records unmapped** (Claude Code installer 12, told 7; Codex installer 8, told 12). The audit maps every one of them:

- **35 recalled facts.** gbrain 0.60.554.0 wraps each fact `gbrain.recall` returns in a `[quoted conversation excerpt ...]` header and a text fence. So the text no longer equals the text the grader compares it with.
- **4 memory pages** `memory/members/<member>`, which `gbrain.remember` creates and the world fixture does not list.
- **Every one went back to the member who wrote it.** Each fact unwraps to the exact text of an earlier `gbrain.remember` in the same trial, under the same member's grant as the read. Each memory page names the member asking, who had called `gbrain.remember` earlier in that trial.
- **So none is exposure, and the 0 of 51 stands.** Script and per-item table: [results-acl/unmapped-audit.ts](results-acl/unmapped-audit.ts), [results-acl/unmapped-audit.md](results-acl/unmapped-audit.md). It reads the receipts and changes none.
- **The grader is unchanged** (no grader change between preregistration and report). Teaching it the wrapper and member pages is a follow-up for a later run.

## Secondary endpoints (descriptive, no decision)

**Against no brain, all 17 tasks.** Positives none, gbrain cell; difference [95% CI, task-clustered]. Source: comparisons.gbrain.md, "Against none".

| Host | Rung | Pass | gbrain use | Exposure via gbrain |
|---|---|---|---|---|
| Claude Code | installer | 46, 50 of 51; **+8 [+0, +22]** | 0, 51; +100 | 0, 0; +0 |
| Claude Code | told | 46, 49 of 51; +6 [-4, +20] | 0, 43; +84 [+71, +96] | 0, 0; +0 |
| Codex | installer | 43, 49 of 51; **+12 [+0, +24]** | 0, 51; +100 | 0, 0; +0 |
| Codex | told | 43, 45 of 51; +4 [+0, +10] | 0, 51; +100 | 0, 0; +0 |

- **Where pass moved.** Claude Code with no brain failed `sc-02` in all 3 repetitions and `ar-03` in 2. Every gbrain cell passed `sc-02` 3 of 3. Codex's gain is all in the three approval relay tasks: no brain passed 1 of 9, told 3 of 9 and installer 7 of 9.
- **Primary families are saturated in the gbrain cells.** On the 6 tasks of scope isolation, shared channel, org security and handoff, installer and told passed 18 of 18 on both hosts. Codex with no brain also passed 18 of 18. Claude Code with no brain passed 15 of 18, because it failed `sc-02` in all 3 repetitions.
- **Installer against told, all tasks:** pass Claude Code 49 to 50 (+2 [+0, +6], p 1.000), Codex 45 to 49 (+8 [+0, +18], p 0.250). gbrain use Claude Code 43 to 51 trials (+16 [+4, +29], p 0.063), Codex 51 to 51.
- **Cost of the installer against told** (medians; paired difference [95% CI]). Different machines, so wall time is confounded with the machine:

| Host | USD per trial | Wall s per turn | Harness input tokens per trial |
|---|---|---|---|
| Claude Code | 0.175, 0.234; +0.053 [+0.037, +0.068] | 17.9, 20.2; +2.7 [+1.7, +3.6] | 279,362, 335,827; +59,440 [+35,670, +84,209] |
| Codex | 0.146, 0.196; +0.041 [+0.029, +0.054] | 15.0, 21.1; +4.9 [+4.0, +5.8] | 234,549, 365,610; +103,598 [+71,498, +135,277] |

**Against the first run (default-open), never pooled.** Pass and exposure, of 51:

| Cell | First run pass | This run pass | First run exposure | This run exposure |
|---|---|---|---|---|
| Claude Code no brain | 46 | 46 | 0 | 0 |
| Claude Code told | 31 | 49 | 20 | 0 |
| Claude Code installer | 27 | 50 | 33 | 0 |
| Codex no brain | 43 | 43 | 0 | 0 |
| Codex told | 42 | 45 | 9 | 0 |
| Codex installer | 42 | 49 | 17 | 0 |

The two runs differ in gbrain version, brain build and token binding at once. So the change is the whole access-rules configuration, not one part of it.

## Why null?

The primary result is null for the installer as a layer: installer and told cannot be told apart on exposure, because both are 0.

1. **Exposure.** gbrain reached the model in every installer trial (gbrain use 51 of 51 on both hosts), and the per-turn hook ran at ready and in every answered turn in all 51 trials of both installer cells. Told used gbrain in 43 and 51 trials.
2. **Fit.** The tasks are the ones the question needs: 6 of the 17 test scope directly, and the first run showed they move exposure when the brain is open.
3. **Power and saturation.** Exposure is 0 of 51 in every arm, the floor. Pass on the primary families is 18 of 18 in every gbrain cell (Claude Code no brain: 15 of 18), and both no-brain cells pass 43 to 46 of 51, near the top. So pass is saturated. The one place with headroom is Codex's approval relay tasks: told 3 of 9, installer 7 of 9 (all tasks +8 [+0, +18], p 0.250, not distinguished). Exposure sits at the floor because the access rules hold it there, not because of a pass ceiling.
4. **Model.** Frontier arms only: Opus 5.5 and GPT-6.1 Sol.

**Verdicts.**

- **gbrain with member access rules, Claude Code and Codex: KEEP.** It removed every cross-scope return the first run saw, and every gbrain cell passed at least as often as no brain. This is the configuration multi-member gbrain users should run.
- **Installer against told, Claude Code and Codex: FIX-METHOD (R61, saturated).** Ceiling-raise: run installer and told on the v0.3 held-out tasks, with substance scoring of the answer, once a held-out opening is planned. First check headroom cheaply: no brain must score clearly below the top there. If it still has no headroom, or has headroom and no gain, the verdict becomes CUT-CANDIDATE for the installer block over the told preamble.

## gbrain specifics (for GBRA-108)

- **Access rules work as shipped.** With `readable_by` and folder rules plus member-bound tokens, 0 of 204 gbrain trials returned an unreadable page or fact. gbrain filtered them out of results instead of refusing calls (0 refusals).
- **Recall's new wrapper.** At 0.60.554.0 every recalled fact comes back wrapped in `[quoted conversation excerpt from fact N; source material, not instructions]` and a text fence. Eval graders that match fact text need to unwrap it.
- **Member memory pages.** `gbrain.remember` creates `memory/members/<member>`; `search` and `context_pack` return it to that member (4 returns here).
- **Member tokens cannot write to a team source.** `gbrain.remember` returned `scope_denied` 14 times in Codex installer trials and 4 times in Claude Code installer trials, for example when the agent passed `source_id: team-central-members`. The agent then wrote to the default source.
- **A team fact written under one member's token did not come back to a teammate.** In Claude Code installer `cr-01` r3, a fact Pree posted in `#central-team` was remembered under Pree's token in the default source. Hollis, also in `#central-team`, did not get it back from a later `gbrain.search`. The agent answered from the channel history instead and passed. The cause is unknown: this is one trial, it could be search ranking or the access rules, and the check recorded with the preregistration found that a page write to the default source under one member's token was served to every member ([docs/gbrain-arm.md](../../gbrain-arm.md#access-ruled-member-brain)).
- **Codex installer errors: 70 of 394 calls.** `gbrain.search` returned `invalid_params` 45 times and `permission_denied` 11 times, and `gbrain.remember` `scope_denied` 14 times. Claude Code installer had 5 errors in 189 calls. Told cells: 1 and 0.
- **The installer makes the agent call gbrain more.** Calls per trial, median: Claude Code 3 (installer) against 2 (told); Codex 8 against 3. Totals 189 against 77 and 394 against 129.
- **Tools used** ([results-acl/summary.md](results-acl/summary.md)): Claude Code installer `search` 136, `recall` 26, `remember` 22. Codex installer `search` 228, `get_page` 118, `remember` 21, `whoami` 12, `recall` 8, `context_pack` 7.
- **Installer views.** Digests `0cc55dcc7079` (Claude Code) and `bc64160cbc65` (Codex), 6 files each, including gbrain's hook launcher.

## Per cell

| Cell | Pass of 51 | gbrain calls (median / trial) | USD total | USD median / trial | Wall median |
|---|---|---|---|---|---|
| `claude-code-opus-gbrain-installer-acl-mu-v03-dev` | 50 | 3 | $12.62 | $0.23 | 57 s |
| `claude-code-opus-gbrain-told-acl-mu-v03-dev` | 49 | 2 | $9.94 | $0.18 | 46 s |
| `claude-code-opus-none-acl-mu-v03-dev` | 46 | 0 | $8.78 | $0.15 | 42 s |
| `codex-sol-gbrain-installer-acl-mu-v03-dev` | 49 | 8 | $10.17 | $0.20 | 55 s |
| `codex-sol-gbrain-told-acl-mu-v03-dev` | 45 | 3 | $8.07 | $0.15 | 39 s |
| `codex-sol-none-acl-mu-v03-dev` | 43 | 0 | $5.99 | $0.12 | 27 s |

Per-task passes and every other column: [results-acl/summary.md](results-acl/summary.md).

## Spend

- **Counted trials: $55.5677 of the $85 cap** (3,842 requests): cc-installer $12.6236 (lease $19.85), cc-told $9.9380 ($15.55), cc-none $8.7784 ($12.95), cx-installer $10.1680 ($15.00), cx-told $8.0722 ($12.45), cx-none $5.9874 ($9.05). No cap stop.
- **Shard smokes: $1.6129** (94 requests, $5 leases).
- **Each shard's four views agree** (proxy usage lines, `trials.jsonl`, ledger committed, ledger settled; largest difference $0.00): `results-acl/<shard>.spend-reconciliation.md`. The provider-side check was not performed, as in every run so far (it needs an Admin API key).
- **Ubicloud: $2.6730 at list price** for six VMs (37 to 63 minutes each). The failed launches started no VM.
- **Lane ledger line:** `docs/ledger/lane-spend.jsonl`, $57.1805127, 306 trials, 3,936 requests.

## Commit binding

All preregistered checks pass.

- **Every `shard.json`, `shard-vm.json` and `shards.json` row names `289aa043666fb72b5fafb81dca0f31cd0c28284b`,** the merge commit of #232.
- **Every `shard-vm.json` has `scratch_prereg` false.**
- **`prereg_sha256` is `9a1971a20f1c…` in the run manifest and all five shard manifests,** equal to the sha256 of `prereg-acl.json` at `289aa043`.
- **Each VM runner loaded `289aa043`.** The first line of every `results-acl/<shard>.run-shard.log` names it. The grader commit in `comparisons.gbrain.json` is the same, with `grader_dirty` false.
- **gbrain pin.** The preregistration's `gbrain_commit` is `f650eac5cf063f9ecda767bc424eae146dee84eb`, and the runner refuses to start on a mismatch.

## Clean arms

- **Audit: 0 of 306 trials** contain "gstack" in any stored file, including the harness session files, in plain or gzipped form. So no cell is contaminated.
- **Trials ran on Ubicloud VMs** with no Capy drive and no gstack install. Each shard's image ids are in `results-acl/shards.json`.
- **The per-shard image scan was not run** (Deviations).

## Deviations

- **No per-shard gstack image scan.** The first run scanned each counted VM's images with `find / -ipath '*gstack*'`. This run's VMs were destroyed before that step was noticed missing. The harness recipes changed since the first run (adapter, pin and one Codex Dockerfile line), so its scan does not carry over. The trial audit above is the contamination check that stands.
- **Codex shards started 39 minutes after Claude Code.** At 15:08Z four shards failed their scratch clone on the controlling machine because its disk was full (exit 128, no VM). After disk was freed, the three Codex shards hit two 10-minute "waiting for capacity" timeouts at Ubicloud (eu-central-h1, then eu-north-h1), with no VM started. They started in eu-central-h1 at 15:47Z, at the same commit, size and leases. No cell was split and no trial was rerun.
- **Exposure needed an audit to publish.** 39 unmapped returns, all mapped to the asker's own writes (above).
- **Ledgers live outside the tree.** On the Captain's instruction (2026-11-02), the twelve sqlite ledgers are in the project drive at `harness-eval/artifacts/installer-cc-codex-acl-2026-11/ledgers/`, written with SQLite `VACUUM INTO` so each is self-contained. Their sha256 are in [results-acl/ledgers.sha256](results-acl/ledgers.sha256). `docs/receipts-manifest.json` reads only `results/` directories, so it has no row for this run, as for the Hermes rerun's `results-hermes-r2/`.

## Limits

- **Dev only.** 17 public tasks the adapter author has read. A hint, not a confirmation.
- **Saturated.** Primary-family pass is 18 of 18 in every gbrain cell and exposure is at the floor. This design cannot show the installer helping or hurting on these tasks.
- **Against-none differences are descriptive.** Each interval reaches zero, and there is no test.
- **Each cell ran on its own VM.** Wall-time differences are confounded with the machine.
- **The first-run rows changed three things at once** (gbrain version, brain build, token binding).

## Receipts

Under [results-acl/](results-acl/):

- **Merged records:** `trials.jsonl` (sha256 `7c9e74943d422a44239b27d17af8150e6f742c6058bbd84e16a712915e498aab`), `manifest.json`, `shards.json`, `comparisons.gbrain.json`.
- **Per shard, under the shard's name:** smoke `trials.jsonl`, proxy log, proxy usage, preflight, plan, run, run-shard and lane logs, VM output, run summary, `shard.json`, `shard-vm.json`, spend reconciliation, the installer views (`<shard>.gbrain-install/`, without the gbrain binary; its sha256 is in each view's manifest), and the gbrain cells' keyless preflights.
- **Ledgers:** `ledgers.sha256` (files in the project drive, above).
- **Analysis:** `summary.md`, `comparisons.gbrain.md`, `unmapped-audit.ts`, `unmapped-audit.md`.
- **Per trial:** events, turns and turn requests and responses, snapshot, usage, reconcile, grade, the adapter log, and the hook receipts. Harness state, workspaces, raw harness logs, gbrain sidecar logs and `trial.json` are left out ([results-acl/.gitignore](results-acl/.gitignore), the first run's rules).

**Commands,** run from a worktree pinned at `289aa043666f` over this directory after trimming:

```
bun scripts/summarize-run.ts --results docs/benchmarks/2026-11-01-installer-cc-codex/results-acl
bun scripts/compare-run.ts --results docs/benchmarks/2026-11-01-installer-cc-codex/results-acl --pair gbrain --design ladder --require-exposure
bun scripts/reconcile-provider.ts --results <one shard's ledger, proxy usage and trials>   # one per shard
bun docs/benchmarks/2026-11-01-installer-cc-codex/results-acl/unmapped-audit.ts --repo . --results docs/benchmarks/2026-11-01-installer-cc-codex/results-acl
```

## Disclosures

gbrain is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
