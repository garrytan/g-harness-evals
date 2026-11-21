# gbrain install: how fast and how easily four agent harnesses install gbrain and use it as memory

Run `gbrain-install-2026-11`, gbrain v0.60.734.0 (a278ddf45887), 200 trials, 198 of them counted after two exclusions (see below), run 2026-11-17 and 2026-11-18.

## Takeaways

- **We learned that the preregistered scorer undercounted OpenClaw and Claude Code, and the corrected numbers are much better.** OpenClaw sends every MCP call through a generic `tool_call` tool, and the scorer read only that outer name, so it never saw OpenClaw call gbrain. It also treated OpenClaw's automatic index of its own chat as "saved to the harness's memory". On Claude Code, gbrain's own session-start hook hands the saved fact to the agent, and the scorer only counted tool calls. As scored, the finish line is **92/198 (40% to 53%)**. With the two bug fixes (a+c) it is **137/198 (62% to 75%)**. Counting the hook as well (a+b+c) gives **151/198 (70% to 82%)**. You should read the a+b+c column: in each run it counts, a gbrain call or gbrain's own hook served the fact.
- **We learned that Codex with GPT-6.1 Sol installs gbrain and recalls through it almost every time: 39/40 (87% to 100%), and OpenClaw gets there 45/60 (63% to 84%) once it is scored right.** With OpenClaw, runs given gbrain's README install block finished more often (26/30 against 19/30 bare; small samples). The readers found that runs which ran `gbrain setup openclaw` got gbrain's brain-first instruction. Bare runs often wired gbrain by hand and then looked in OpenClaw's own session history instead. You should point OpenClaw users at `gbrain setup openclaw`.
- **What didn't work: Hermes with Opus 5.5 or GPT-6.1 Sol.** Hermes's command scanner (Tirith) blocks `bun install -g github:garrytan/gbrain#v0.60.734.0` and the git-clone fallback in single-query mode, so 22 Hermes runs never got a gbrain binary. Hermes with particle-1 finished 18/18. The scanner block is Hermes configuration, not a gbrain bug. Its own message names `approvals.single_query_mode: approve`.

## Headline table

Finish line = the recall reply holds the nonce, and gbrain served it in a fresh session. Each cell shows k of n counted runs with a Wilson 95% interval.

- **As scored:** the pinned scorer.
- **a+c:** two scorer bug fixes. **a** credits OpenClaw's `tool_call` wrapper; **c** stops counting OpenClaw's index of its own transcript as harness memory.
- **a+b+c:** a+c plus rule **b**, a definitional change. It counts recall delivered by gbrain's own Claude Code hook, but only when the hook's own name or command names gbrain, or the trial's settings file proves that every hook registered for that event is gbrain's (the strict reading).

All three columns count codex-sol-bare r16 as a miss. It ended in `harness_error`, and the plan's prose says a harness error is a miss. The pinned verdict scores it a finish, so the pinned totals are one higher: 93, 138 and 152.

| Cell | Arm | n | As scored | a+c | a+b+c |
|---|---|---|---|---|---|
| Claude Code, Opus 5.5 | bare | 20 | 7/20 (18% to 57%) | 7/20 (18% to 57%) | 16/20 (58% to 92%) |
| Claude Code, Opus 5.5 | paste | 20 | 12/20 (39% to 78%) | 12/20 (39% to 78%) | 17/20 (64% to 95%) |
| Codex, GPT-6.1 Sol | bare | 20 | 19/20 (76% to 99%) | 19/20 (76% to 99%) | 19/20 (76% to 99%) |
| Codex, GPT-6.1 Sol | paste | 20 | 20/20 (84% to 100%) | 20/20 (84% to 100%) | 20/20 (84% to 100%) |
| OpenClaw, Opus 5.5 | bare | 10 | 0/10 (0% to 28%) | 6/10 (31% to 83%) | 6/10 (31% to 83%) |
| OpenClaw, Opus 5.5 | paste | 10 | 0/10 (0% to 28%) | 10/10 (72% to 100%) | 10/10 (72% to 100%) |
| OpenClaw, GPT-6.1 Sol | bare | 10 | 0/10 (0% to 28%) | 6/10 (31% to 83%) | 6/10 (31% to 83%) |
| OpenClaw, GPT-6.1 Sol | paste | 10 | 0/10 (0% to 28%) | 6/10 (31% to 83%) | 6/10 (31% to 83%) |
| OpenClaw, particle-1 | bare | 10 | 0/10 (0% to 28%) | 7/10 (40% to 89%) | 7/10 (40% to 89%) |
| OpenClaw, particle-1 | paste | 10 | 0/10 (0% to 28%) | 10/10 (72% to 100%) | 10/10 (72% to 100%) |
| Hermes, Opus 5.5 | bare | 10 | 0/10 (0% to 28%) | 0/10 (0% to 28%) | 0/10 (0% to 28%) |
| Hermes, Opus 5.5 | paste | 10 | 7/10 (40% to 89%) | 7/10 (40% to 89%) | 7/10 (40% to 89%) |
| Hermes, GPT-6.1 Sol | bare | 10 | 4/10 (17% to 69%) | 4/10 (17% to 69%) | 4/10 (17% to 69%) |
| Hermes, GPT-6.1 Sol | paste | 10 | 5/10 (24% to 76%) | 5/10 (24% to 76%) | 5/10 (24% to 76%) |
| Hermes, particle-1 | bare | 9 | 9/9 (70% to 100%) | 9/9 (70% to 100%) | 9/9 (70% to 100%) |
| Hermes, particle-1 | paste | 9 | 9/9 (70% to 100%) | 9/9 (70% to 100%) | 9/9 (70% to 100%) |
| **All** | | **198** | **92/198 (40% to 53%)** | **137/198 (62% to 75%)** | **151/198 (70% to 82%)** |
| Arm bare | | 99 | 39/99 (30% to 49%) | 58/99 (49% to 68%) | 67/99 (58% to 76%) |
| Arm paste | | 99 | 53/99 (44% to 63%) | 79/99 (71% to 87%) | 84/99 (76% to 91%) |

**Note on rule b.** In 12 Claude Code recall turns, the transcript shows gbrain's hook returning the nonce, but the archived `settings.json` is empty, so the strict reading can't prove the hook is gbrain's. Seven of those change the outcome. Read leniently (the end-of-turn probe saw a gbrain hook command, and the hook output carries gbrain's own header), a+b+c is 158/198 (74% to 85%), with Claude Code at 20/20 in both arms. In each shard, every empty file has the same modification time (s01 13:49:16Z, s02 15:05:48Z), after that shard's trials had ended, so they were emptied after the trial. They are the same 12 trials whose brain databases the local disk cleaner took and the partial-copy restore couldn't bring back (see "What we got wrong"), so our own cleanup and restore is the likely cause, not anything gbrain did. We didn't confirm that from the file times.

**Arm A against arm B.** Pooled over harnesses, paste finishes 84/99 and bare 67/99 on a+b+c, a gap of 17 points, not a paired interval. That's below the plan's smallest detectable difference for 100 runs (about 20 points), so the "arm A much worse than arm B" line doesn't trigger. Per cell, most gaps are too small to call: the detectable difference is about 43 points at n=20 and about 55 at n=10. The exception is Hermes on Opus 5.5: 0/10 bare against 7/10 paste, a 70-point gap (larger than the detectable difference at n=10, though it is one of eight per-cell comparisons and not adjusted for them), where 8 of the 10 bare runs never got a gbrain binary.

## Which step gbrain's maintainers fix first

The preregistered rule takes the step with the most failed runs in arm A (bare), pooled. **On a+b+c it is "recalled" (16 runs), and on a+c it is "recalled" too (25 runs).** As scored, "saved" and "recalled" tie at 22. The "saved" count is a scorer artifact: all 22 are OpenClaw runs whose MCP save the scorer couldn't see, and rule a takes it to 0.

**This answer holds only under the strict reading of rule b, the one the plan fixed.** Read leniently (see the note on rule b above), the 4 Claude Code runs leave "recalled", which drops to 12, and the top bare-arm step on a+b+c becomes "binary" (14 runs, Hermes's Tirith scanner blocking the bun and git installs). Strict b counts those 4 runs as misses only because their settings files were lost on our side, so treat the order of these two steps as uncertain.

| Step (bare arm, a+b+c) | Failed runs | Person-needed events | What it is |
|---|---|---|---|
| binary | 14 | 47 | Hermes's Tirith scanner blocks the bun and git installs (Opus 5.5 and Sol) |
| brain | 0 | 62 | no failed runs; person-needed events the probe tagged at this step |
| wired | 2 | 11 | Hermes Opus r9, r10: Hermes's protected config blocked the wiring |
| saved | 0 | 3 | |
| recalled | 16 | 4 | 11 OpenClaw runs wired by hand with no brain-first block, mostly answering from OpenClaw's session search (in sol r8 gbrain returned the fact and the agent didn't use it); 4 Claude Code runs whose gbrain hook strict b can't prove; codex r16 (harness_error) |

The paste arm's tables, and both arms under a+c, are in [rescore/RESCORE.md](rescore/RESCORE.md), which also gives the as-scored tie. The pinned outputs are [failure-bare.md](failure-bare.md) and [failure-paste.md](failure-paste.md).

## What the transcripts show, per harness

- **Claude Code (Opus 5.5).** 31 runs installed gbrain with Bun from GitHub and 9 with a git clone. In the fresh session, gbrain's SessionStart hook puts the saved fact in context, and the agent usually answers without a tool call. That is rule b. The bare arm needed a person most often: 24 events, 19 of them scripted replies.
- **Codex (GPT-6.1 Sol).** 39 of 40 finished. The median time to finish was 130.1 s bare and 260.1 s paste, with r16's harness error counted as a miss, as in the headline (the pinned verdict gives 130.6 s bare over 20). Three paste runs installed through the Codex plugin route.
- **OpenClaw (Opus 5.5, GPT-6.1 Sol, particle-1).** Installs succeeded. After `gbrain setup openclaw`, the brain-first block made the fresh session call gbrain first. Bare runs that wired gbrain by hand with `openclaw mcp add` often answered from OpenClaw's own session history instead (counted as misses). Two gbrain-side problems showed up: `gbrain setup --help` lists only `claude-code` and `codex`, and `gbrain setup openclaw` failed with `invalid_params` on OpenClaw's JSON5 config in one run. In openclaw-sol-paste r2 and r7, a fact saved with `gbrain remember` wasn't found by `gbrain search`. That is one reader's diagnosis, and gbrain's maintainers are reproducing it on the newest release.
- **Hermes (Opus 5.5, GPT-6.1 Sol, particle-1).** The Tirith scanner block above. The agents did not get past the guard, even after three scripted replies, and saved the fact to Hermes's own memory instead. That's counted as a miss ("harness memory"), as the plan says. Hermes with particle-1 finished every counted run.

## Consent and provider requests

- **Non-harness provider requests from gbrain: 0.** No request other than the harness's own model calls and startup probes reached the proxy on any run.
- **Hermes startup probes.** 335 probes without a token on the particle-1 route (python-httpx; `/version`, `/v1/props`, `/props`, `/api/v1/models`, `/api/tags`, 67 each), all refused at $0. In counted runs the verdict's "non-harness" column shows them as 165 (bare) and 135 (paste) for the Hermes particle-1 cells. Per the plan, they are reported apart and are not a gbrain finding. With the token, Hermes sent 896 probes on Opus 5.5, 760 on Sol and 60 on particle-1, all refused at $0.
- **Model-list and count_tokens refusals.** `GET /v1/models` and `GET /v1/models/claude-opus-5-5` with the token were refused 448 times (224 each) for Hermes on Opus 5.5 and 78 times on particle-1. Claude Code's `POST /v1/messages/count_tokens` was refused 9 times. Amendment 1 recorded that the proxy refuses these routes even though the plan says `/v1/models` is forwarded free. No run failed for it.

## Audits (all three change no number)

- **Audit 1, recall from the conversation archive: 0.** All 94 recalls (93 counted plus the excluded INFRA run) were served by a saved fact, not a page under `conversations/`. Five recalled Claude Code trials have no brain in their copied state, so for those we checked the transcripts. This covers the pinned scorer's recalls only: Audit 1 didn't check the 59 recalls that rules a, b and c add to the headline a+b+c column (45 OpenClaw, 14 Claude Code).
- **Audit 2, `head N` or `tail N` with a bare number: 0 credits, 0 withdrawn.**
- **Audit 3, release-pin recount from the raw watcher records:** first version not the pin 0, last version not the pin 0, no version seen 22. All match the verdict. The 22 are the Hermes runs that never got a binary.

Details: [audits/AUDITS.md](audits/AUDITS.md).

## Miss readers ("as read")

Each miss in the pinned verdict (105) was read by an agent from the other model family: GPT-6 Astra for the Opus 5.5 runs, Opus 5.5 for the Sol and particle-1 runs. The readers are not judges, are not validated, and change no number. Their reads agree with a+b+c on 96 of 105 trials, disagree on 8 and are unclear on 1. Seven of the disagreements are the unprovable Claude Code hooks. The eighth is openclaw-sol-paste r8, which recalled through a launcher script that none of the rules covers. codex-sol-bare r16, a finish in the pinned verdict and a miss as scored, has no read. Reads: [readers/](readers/).

## Deviations from the plan

- **Post-data rescore (Amendment 3).** Written after seeing the data. The plan's "fix order uses as scored" now reads "uses a+b+c", with the a+c top step stated beside it (both are "recalled").
- **Conservative harness_error rule.** codex-sol-bare r16 counts as a miss in the headline. The pinned verdict scores it a finish. $6.58 of that trial's $6.87 is reservations the proxy kept for 2 unpriced requests, not real usage.
- **The INFRA run wasn't rerun.** hermes-particle-bare r5 hit a real GitHub API rate limit ("API rate limit exceeded for <VM IP>"), so the plan calls for a rerun. The runner has no single-trial rerun path under this preregistration, so the cell reports n=9.
- **A lease ran out.** hermes-particle-paste r10 hit s10's $8 lease (three 402s) and is excluded as `model_error`, so that cell is n=9.
- **`--no-smoke` on every shard.** The fan-out's built-in one-trial smoke adds a task, which the preregistration check refuses (HE-PREREG-007). The paid smokes under Amendments 1 and 2 stand in for it.
- **The first fan-out ran one VM at a time, not two,** because the controller's local disk was full.
- **Package caches and gbrain clone packs were removed** from trials' `state/` and `workspace/` to fit a 65 GB controller disk. Every removal is logged under `shards/*/`: `state-pruned.tsv` with sizes, `state-pruned-local.txt` with paths only, and `packs-pruned.tsv` with sizes and sha256. Brains, session files and workspace files were kept, except the ones the disk cleaner below took. The packs went beyond gbrain's: s03 and s04 also deleted 40 copies of Codex's own plugin-cache pack (`state/codex/.tmp/plugins/.git/objects/pack/`, 20 in each Codex cell), logged with sha256 in their `packs-pruned.tsv`. Six pack versions, by sha256: c5c5995c2f48949294279ee606d9f64b189878a3ef3ca4c824a546bcb32bffa4 (16 copies), 1488e176d3e1815e4c51a7385a789a1ac8869d80d9dc368abc4fb5c8be57ac33 (12), a5d60a4a520a127ab4119aa411e00faa702efa5dd3ab92ddce148e368731af3a (7), 614494229f043ce036bd771b0528bc398b8ca387453d937323e9942c1fc1b740 (2), c4e88f9289015f5c62bd2c463a6dc3958938a2a2d97f28d0096523116d7366d2 (2) and 52f31dc757a998c6b58a1ee0e2479579876599ebc8c4185b8db2e16eab60b662 (1). The scripts are in [ops/](ops/).
- **s01 r19 lost its brain and workspace,** so its audits use its transcript and its watcher and probe records.
- **The controller machine restarted** during the first fan-out (last log line 2026-11-17T19:55:57Z), and s06 was reattached. s03, s05, s08 and s10 had their final pulls fail on local disk, and each was pulled again with `--attach`. s09 and s10 failed before any trial on local disk and were relaunched (try-1 records in `shards/s09.try1-failed` and `shards/s10.try1-failed`). Every process loaded commit 06fbac5173f9. The restart log isn't committed (the repository ignores `*.log` files), so its four entries are quoted here:

  ```text
  2026-11-18T01:48:43Z controller machine restarted (uptime 0 at 01:48Z); last controller log line 2026-11-17T19:55:57Z; fan-out controller and keeper ended; s06's VM kept running its shard at 06fbac51; recovery: run-shard.sh --attach for s06, fan-out relaunched for s04 s07 s08 s09 s10 at 06fbac51
  2026-11-18T05:10:11Z s08 reattach after local-disk pull failure at 05:07Z
  2026-11-18T05:15:58Z s09,s10 relaunched (fanout3) after try 1 exit 3 on local-disk tar failure at 04:21Z; try-1 files in dest/sNN.try1-failed
  2026-11-18T08:14:47Z s09 try-2 stopped at 06:06:41Z on a false HE-INSTALL-005 (keeper's VM prune deleted r3's caches during its canary scan; local rescan of dest/s09 and mirror/s09 found no key); prune-state.sh now waits for the record line; s09 resumed with --resume from 06fbac51; s10 reattached after local-disk pull failure at 08:08Z
  ```
- **s04 was refused once for vCPU quota** and then launched.

## What we got wrong

- My cache pruner deleted files on the s09 VM while the runner's token-and-key scan was running, so the scan reported a false HE-INSTALL-005 and the shard stopped. A rescan of every s09 file found no key. The pruner was fixed to wait for each trial's record, and s09 resumed from the same commit.
- A local disk cleaner deleted s01's and s02's `state/` and `workspace/`. Both were restored from the partial copies, except s01 r19's workspace and 12 Claude Code brain databases (bare r8, r13, r16, r18 and r19; paste r2, r6, r8, r13, r16, r18 and r19), which the copies didn't hold. The trial records show each of those brains held the fact; five of them are the recalls Audit 1 checked by transcript.
- I sized s10's lease at $8, and it ran out on the last trial.

## Next time

- Unwrap harness tool wrappers in the scorer, and credit hook-delivered recall, because two of the four harnesses were misscored for these reasons alone.
- Test the scorer against one real transcript per harness and route before freezing it, not only against stand-ins, because the paid smokes had OpenClaw transcripts but no check asked whether the scorer saw an OpenClaw MCP call.
- Give the counted run a single-trial INFRA rerun path in the runner, because the plan required a rerun that the tooling couldn't do.
- Give each shard enough local disk, about 30 GB per Hermes or Codex shard with clone packs, because then no pruning is needed and nothing is lost on a full disk.
- Set Hermes's single-query approval policy in the plan, either explicitly or as its own arm, because its scanner decides the Hermes result before gbrain is ever touched.
- Size every lease from the paid smoke's per-trial cost times 1.5, not from the plan's estimate, because s10's $8 lease ran out on its last trial and cost hermes-particle-paste one run.

## Cost

- Paid model calls: $143.96 across all 200 trials (the 198 counted and the two excluded). That includes about $8 of reservations kept for unpriced requests, not real usage. By harness: Claude Code $24.53, Codex $28.44, Hermes $35.31, OpenClaw $55.68.
- VMs: about $14 at Ubicloud list price.
- Paid smokes before the run: $20.35.

## Files

- [trials.jsonl](trials.jsonl): merged counted records, unchanged.
- [verdict.md](verdict.md) and [verdict.json](verdict.json): the pinned verdict.
- [failure-bare.md](failure-bare.md) and [failure-paste.md](failure-paste.md): the pinned failure tables.
- [rescore/](rescore/): rescore.ts, its 16 tests, its inputs and outputs, and a README with the rebuild command.
- [audits/](audits/), [readers/](readers/), [shards/](shards/) (per-shard download, egress, pruning and VM records), [ops/](ops/) (manifests and run-ops scripts; the restart log is quoted in the restart entry above).
- `sNN.*`: each shard's manifest (s02 to s10; s01's wasn't kept), preflight provenance, run summary and shard record. The shards' proxy logs and run logs aren't committed (the repository ignores `*.log` files). The shards' spend ledgers and proxy usage logs stay private under the repository's public-safety rule. The proxy counts above come from them, and they are kept in the raw-data archive.
- `trials/`: per-trial transcripts, turn records, logs and egress. Harness state and workspaces are not included. 25 credential-shaped strings that agents printed inside their containers (Claude Code's session messaging token, the per-trial proxy token, a Hermes dashboard token, and one test note's word) are replaced with `<redacted>`, and 18 copies of a gbrain maintainer's personal commit email, which three Hermes Opus runs read from gbrain's commit history, are replaced with `<redacted-email>`. Each is listed in [redactions.tsv](redactions.tsv). The trials held no provider key; a scan for every provider key's value found none.

<details><summary>Run receipts</summary>

- Preregistration: harness-evals#485, merged as 6e65fbcd3279. Runner and scoring files are pinned in [pins.sha256](../pins.sha256); all 30 match the run commit 06fbac5173f9. The first pins were taken at 166c93dad21a, and Amendment 2 re-pinned scripts/gbrain-install/transcript.ts.
- Amendment 1 (unzip in the images): 73c2e4c32a54. Amendment 2 (reruns, narrower GitHub rate-limit check): e939ea6bde3a. Run commit (pinned scoring README restored): 06fbac5173f9. The registry (docs/benchmarks/preregistrations.d/gbrain-install.json) records the preregistration 6e65fbcd3279 and the commits the run loads from, 73c2e4c32a54 and 06fbac5173f9; 8cca7cfb8a46 set that entry.
- Every counted shard ran from 06fbac5173f9 on one standard-16 Ubicloud VM per shard, with trials run one at a time and no cell split across machines.

</details>
