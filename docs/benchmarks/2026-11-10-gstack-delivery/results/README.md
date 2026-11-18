# gstack delivery eval: results

**Run** `gstack-delivery-2026-11`, preregistered in [PREREGISTRATION.md](../PREREGISTRATION.md) (merge commit `db705db231f0`, Amendment 1). 2,738 of 2,752 planned trials recorded, on 5 harnesses (Claude Code, Codex, Hermes, OpenClaw, Pi) and 3 models (Claude Opus 5.5, GPT-6.1 Sol, particle-1), 16 review tasks and 16 ship tasks, 2 tries each.

## Takeaways

- **We learned that putting gstack's review steps in front of the agent makes it follow them more, but it does not make the review better.** Every route (skill, hook, startup file) lifted review step compliance by about 10 to 14 points over no gstack, mostly "read the full diff first" (21% with no gstack, 48% to 64% with a route). These are plain averages over all three models, outside the preregistered tests, with no interval. Review pass rate did not move on any route (skill -1.6, hook +0.4, startup -1.6 points against no gstack, every interval includes 0 and tops out at +5.9). The run could have seen a gain of about 7 to 9 points and saw none. **You should not expect a steps card to raise review quality by itself.**
- **We learned that a short card is a much cheaper way to deliver the steps than the full skill.** On review, cost per solved task was $0.60 with no gstack, $0.71 with the startup card, $1.09 with the hook card and $1.71 with skill auto-load. Hook and startup were non-inferior to the skill on review pass rate at a 5-point margin; startup was not shown non-inferior to no gstack. **If you put the review steps in front of the agent anyway, a startup file costs far less than the skill, and the run found it at most 5 points worse.**
- **We could not measure ship compliance fairly, so we make no ship call.** The preregistered ship claim holds on paper (cards beat the skill by about 23 to 25 points), but that gap comes from a blind spot in our step probe, explained below. Against no gstack, the ship cards did not raise ship step compliance.

## What worked

- **Startup files and hooks delivered the card in every trial we could check.** Pi passed its preregistered delivery test (Opus 5.5 and GPT-6.1 Sol, 256 of 256 hook and startup trials delivered). Across all harnesses, 9 of 702 hook trials could not be confirmed as delivered; all 9 are particle-1 on Pi, where the request capture could not be parsed.
- **The control arms were clean.** No trial on the none, hook, startup or placebo arms read a gstack file (0 reads in 2,046 trials). Skill-arm trials read gstack files as designed (521 of 692 trials).
- **The card's words matter a little more than extra text.** A placebo of the same length scored below the hook card on compliance: -7.0 points on review [-12.5, -1.6] and -6.5 on ship [-12.5, -0.8].

## What did not work

### Review pass rate (primary 2, Holm over 4)

| Contrast | Pass rate, second arm / first arm | Delta, points [95% CI] | Measured MDE | Verdict |
|---|---|---|---|---|
| hook minus none | 41.4% / 41.8% | +0.4 [-4.7, +5.9] | 7.7 | no measurable difference |
| startup minus none | 40.1% / 38.5% | -1.6 [-8.3, +3.6] | 8.8 | no measurable difference |
| skill minus none | 41.3% / 39.7% | -1.6 [-6.3, +3.7] | 7.5 | no measurable difference |
| hook minus skill | 39.7% / 41.7% | +2.0 [-2.8, +7.1] | 7.2 | no measurable difference |

MDE is the smallest change this run could detect with 80% power, measured from the counted trials. The preregistered MDE was 10.1 points.

### Compliance (primary 1, Holm over 4)

| Contrast | Skill / card | Delta, points [95% CI] | Holm p | Reading |
|---|---|---|---|---|
| hook minus skill (review) | 78.1% / 74.6% | -3.6 [-8.6, +1.4] | 0.236 | no measurable difference |
| startup minus skill (review) | 77.3% / 82.7% | +5.5 [+1.3, +9.6] | 0.082 | no measurable difference |
| hook minus skill (ship) | 25.2% / 50.0% | +24.8 [+19.5, +29.7] | 0.0002 | higher compliance, as preregistered; see the probe blind spot below |
| startup minus skill (ship) | 27.7% / 50.9% | +23.2 [+17.3, +28.7] | 0.00012 | higher compliance, as preregistered; see the probe blind spot below |

**The ship claim is a measurement artifact.** gstack's /ship skill pushes the branch through its own helper, `gstack-ship-release push`, which runs `git push` inside the script. Our step probe only sees a push typed as a shell command, so it scores those trials "no push of the branch", and a ship marker that needs a push can never be met. 48 counted skill-arm ship trials that the grader passed still read "no push" (one more, an opus-hermes-skill trial that ended in a harness error, was not graded), and the grader only passes a ship trial when the pushed branch is in the task's remote. Against no gstack, the ship cards did not raise ship step compliance (plain averages on Opus 5.5 and GPT-6.1 Sol: about 48% with no gstack, 50% with the hook card and 49% with the startup card). On ship pass rate, a descriptive reading outside the preregistered tests, the hook card scored 4.3 points below no gstack [-9.0, -0.4] and the startup card -0.5 [-4.7, +3.1] ([delivery-analysis.md](delivery-analysis.md)). The fresh-verification step was met in 92% of no-gstack trials, 97% with the hook card and 92% with the startup card, and the final-diff-after-commit step was met in 0% to 7% of trials on every arm, skill included. Counts: [ship-push-check.json](ship-push-check.json).

**A known over-count in the Hermes readings.** On Hermes, the probe reads tool calls inside the Python that the agent runs through `execute_code`, and it also counts calls inside a function the program defines but never calls. A count after the run puts an upper bound on it: 66 such functions in 1,463 Hermes `execute_code` programs, 26 on the startup arm, 18 hook, 12 placebo, 10 none and none on the skill arm. It can only raise Hermes compliance on those arms a little, and it changes no verdict. The probe is the preregistered scorer, so it is reported here, not fixed for this run.

### Exclusions fall on the skill arm

| Arm | Trials | Model error | Infra error | Delivery unconfirmed |
|---|---|---|---|---|
| none | 704 | 1 | 9 | |
| skill | 692 | 41 | 40 | |
| hook | 702 | 5 | | 9 |
| startup | 512 | 7 | | |
| placebo | 128 | | | |

Most skill-arm exclusions come from two cells. sol-codex-skill had 30 lease stops (`cap_stop`): the skill arm cost far more than its lease was sized for, and the cell spent $59.75 of its $62 lease. The metering proxy reserves each Sol request's worst-case cost against the lease, so it began refusing requests while some lease was still unspent. sol-openclaw-skill had 22 effort mismatches, all on ship tasks, where some of each trial's 46 to 97 requests went out at low reasoning effort instead of high; the cause is not confirmed. Each is excluded and reported as the preregistration says (no reruns). Exclusions are pairwise, so they shrink the skill comparisons. Lease stops fall on the costliest trials, so the pairs that remain may not be a random subset.

## Verdicts

- **Review step text: CUT-CANDIDATE.** Why null? (1) The model got the card and used it: delivery was confirmed and compliance rose 10 to 14 points over no gstack. (2) The tasks fit: review pass rate sat at 38% to 42%, far from a ceiling. (3) There were enough tasks and tries: every interval against no gstack tops out at +5.9 points or less, below the preregistered 10.1-point MDE and the measured 7 to 9 points. (4) The model does not already follow the steps unaided: no-gstack compliance was 64%. So the steps were delivered and followed more, and the reviews did not get better.
- **Review card as a route: cheaper than skill auto-load.** By the analysis's decision table (d14), hook and startup are non-inferior to the skill on review pass rate (Holm p 0.0044 each) and cheaper per solve (hook -$0.63 [-$1.05, -$0.39], startup -$1.11 [-$1.86, -$0.75]). The preregistration's "What we'll do differently" table also needs a route's review compliance claim to hold before its card replaces skill auto-load, and neither holds. So neither card replaces skill auto-load or becomes a default for review.
- **Ship: FIX-METHOD, no ship card default.** The ship compliance claim holds as preregistered (Holm p 0.0002 and 0.00012) but rests on the probe blind spot above. The fix: `scripts/gstack-delivery/probes.ts` must count a push made through `gstack-ship-release push`. Against no gstack, the ship cards did not raise ship step compliance.

## Secondary readings

- **particle-1, reported apart:** hook minus none on review pass rate, +13.5 points [+5.2, +22.9]; startup +9.4 [-1.6, +21.9]; skill +9.4 [-1.0, +21.9]. This is the only model where a card route's interval clears 0. It is not pooled and needs its own test before anyone acts on it.
- **Hooks re-inject the card on every request.** The most card copies in one request was a median of 19 on Codex (max 35), 21 on OpenClaw (max 58) and 11 on Claude Code (max 22). The Hermes plugin, the Pi extension and every startup file carried one copy.
- **Per harness and per model** readings, each with its own MDE, are in [delivery-analysis.md](delivery-analysis.md).

<details><summary>Run, spend and deviations</summary>

**Run commits.** Every shard ran from a worktree pinned at one commit on branch `gstack-delivery-amendment-1`:

- `b543fa4d4f78`: 34 shards.
- `4fd6a2e49914`: 7 re-costed hook and placebo shards (opus-cc-hook, opus-cc-placebo, sol-codex-hook, opus-openclaw-hook, sol-hermes-hook, sol-hermes-placebo, sol-openclaw-hook).
- `dc429809395e`: opus-hermes-hook and particle-hermes-hook.

No cell was split across commits. Per-shard commit, lease, records, model spend and VM life are in [shards.json](shards.json).

**Spend.** Model spend metered by the proxy: $1,287.31 on the ledgers, of which $1,277.45 sits on the 2,738 trial records; the rest is smoke trials and the trial set aside below. Ubicloud VMs: $179.93 at list price on the ledgers, of which $171.74 is the 43 counted shards' VMs in shards.json. Every VM was destroyed and every shard ended with cleanup done.

**Deviations.**

1. The fan-out ran at most 11 VMs at once (shards.json VM times: the 10 Pi shards and opus-hermes-skill, from 2026-11-16 00:35Z) instead of `--parallel 12` (PREREGISTRATION.md, Commands), to stay inside the shared Ubicloud project's quota. It changed calendar time only.
2. The controller machine restarted on 2026-11-16 at 05:48Z. Every running shard was re-attached with `run-shard.sh --attach` from the worktree for its own commit; no trial was rerun.
3. The canary shard opus-hermes-skill lost one trial (gd-dev-review-06/a1) to a `--resume` bug: a leftover Harbor job directory raised FileExistsError. n=63 for that cell, no rerun.
4. sol-hermes-skill's first launch failed its smoke on a GitHub 504 while downloading uv 0.9.5. It was launched once more (the one smoke repeat); the failed attempt ran no counted trial.
5. Two Hermes shards hit `run-shard.sh`'s 15-hour shard timeout. sol-hermes-skill finished 52 of 64 trials (one more was cut off with no model response and counts as infra); opus-hermes-hook finished 62 of 64. Harbor never reached its own record-writing step on those VMs, so their records were rebuilt on the controller with the shard's own `scripts/frontier-harbor/to-trials.ts convert`, on a copy of the pulled Harbor job directories. The rebuilt records match the shard journals rebuilt with `to-trials.ts recover` (same trials, passes and spend). opus-hermes-hook's gd-dev-ship-05/a2 was killed mid-trial by the timeout; the converter labels it `harness_error`, and it is set aside as unfinished infra, not counted as a fail. The 14 trials that never ran or were cut off are excluded and reported.
6. Lossless hard-link deduplication of the controller's local copies, to keep disk free. No result file changed.

</details>

## Files

- [trials.jsonl](trials.jsonl): one row per trial, as `scripts/gstack-delivery/collect.ts` wrote it.
- [probes.jsonl](probes.jsonl): the step probe for each trial (`scripts/gstack-delivery/probes.ts`).
- [delivery-analysis.md](delivery-analysis.md) and [delivery-analysis.json](delivery-analysis.json): the preregistered analysis (`scripts/gstack-delivery/analyze.ts --pass-kinds review --pi-delivery-from-probes --seed 7 --draws 10000`).
- [audit/](audit/): the contamination audit, one `audit.json` per shard (`scripts/frontier-harbor/audit.ts`).
- [shards.json](shards.json): commit, lease, records, spend and VM per shard.
- [ship-push-check.json](ship-push-check.json): the counts behind the ship probe blind spot (exploratory, not preregistered).
- [pins-note.md](pins-note.md): why main's later changes to pinned files did not reach this run, and the commits it loaded.

