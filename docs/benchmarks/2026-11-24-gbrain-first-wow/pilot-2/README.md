# Pilot 2: gbrain first-wow eval, the first-session suggestion

**Two takeaways.** gbrain's first-session suggestion (PR 2) works in Claude Code: setup arms it, the section reaches the first session in 5 of 5 trials, and Claude Code then offered the next import in 4 of 5 replies, against 1 of 5 with the suggestion off. In Codex it does not reach the session: gbrain recorded the section as delivered in 5 of 5 trials, but none of the 5 Codex session transcripts holds it, so Codex's full arm measured PR 1 alone.

The coding check runs and grades: all 12 coding trials passed their hidden tests, with and without the suggestion, so 3 tasks show no regression and no headroom yet.

- **Pilot, not a result.** 42 trials on seeds outside the counted set: defaults, pr1 and full × 5 seeds in each harness, and the coding check on defaults and full × 3 seeds. It checks that each arm's part under test ran and that the coding check can be supplied and graded. It publishes no verdict.
- **Build:** gbrain `2b4cc26f59861ba35c5ac30f60a2d133ae22d17b` (package 0.60.774.0, the head of gbrain's main branch on 2026-11-25, with PR 1, gbrain#10249, and PR 2, gbrain#10346; no release tag yet).
- **Models:** Claude Code 2.1.312 with Claude Opus 5.5; Codex 0.165.0 with GPT-6.2 Sol. Plain was not rerun: it has no gbrain, so PR 2 does not change it (pilot 1 holds it).
- **Paid:** $6.15 for 42 trials, plus $1.05 for two smokes (one Codex smoke stopped on a $4 lease that was too small for two Codex trials and was rerun).

## Questions, by arm

[summary.json](summary.json), run `gbrain-first-wow-pilot-2` ([pilot.json](pilot.json)).

| Cell | Arm | n | Paid $ | Finish (any ref) | Finish (strict) | Questions passed | No-history abstained | All sessions imported | Registration ok | Median question s | Median setup s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| cc-opus-defaults | defaults | 5 | 0.77 | 0/3 | 0/3 | 2/9 | 2/2 | 0/3 | 5/5 | 27 | 12 |
| cc-opus-pr1 | pr1 | 5 | 0.62 | 2/3 | 2/3 | 8/9 | 2/2 | 3/3 | 5/5 | 23 | 16 |
| cc-opus-full | full | 5 | 0.71 | 3/3 | 3/3 | 9/9 | 2/2 | 3/3 | 5/5 | 26 | 26 |
| codex-sol-defaults | defaults | 5 | 0.81 | 2/3 | 0/3 | 6/9 | 2/2 | 0/3 | 5/5 | 40 | 12 |
| codex-sol-pr1 | pr1 | 5 | 0.80 | 3/3 | 3/3 | 9/9 | 2/2 | 3/3 | 5/5 | 27 | 15 |
| codex-sol-full | full | 5 | 0.82 | 3/3 | 3/3 | 9/9 | 2/2 | 3/3 | 5/5 | 25 | 26 |

## The suggestion, by arm

"Armed" and "off" are setup's `suggestion` marker; "delivered" is `gbrain onboarding status` after the session; "in transcript" means the session's own transcript holds the line `[gbrain] First sessions on this brain`.

| Cell | Armed at setup | Off at setup | Delivered (gbrain) | In transcript | Reply offers an import |
|---|---|---|---|---|---|
| cc-opus-defaults | 0/5 | 5/5 | 0/5 | 0/5 | |
| cc-opus-pr1 | 0/5 | 5/5 | 0/5 | 0/5 | 1/5 |
| cc-opus-full | 5/5 | 0/5 | 5/5 | 5/5 | 4/5 |
| codex-sol-defaults | 0/5 | 5/5 | 0/5 | 0/5 | |
| codex-sol-pr1 | 0/5 | 5/5 | 0/5 | 0/5 | 1/5 |
| codex-sol-full | 5/5 | 0/5 | 5/5 | 0/5 | 1/5 |

"Reply offers an import" is a word match (import, export or `transcripts ingest`) on the reply, not a scored measure.

- **Claude Code** records the section as a `SessionStart:startup` hook attachment in the session's jsonl. With no page readable by everyone in the brain, the "Recent pages" list was empty in every trial, because imported conversation pages are owner-only.
- **Codex.** gbrain's hook log says `session-start ok` and its first-session log says `outcome: delivered`, but the Codex rollout holds no trace of the section, while it does hold the UserPromptSubmit hook's "GBrain: before answering this turn" line. Codex 0.165.0 runs as `codex exec`. Reported to gbrain's maintainers on 2026-11-25.

## Coding check

[scripts/gbrain-first-wow/coding.ts](../../../../scripts/gbrain-first-wow/coding.ts): 15 small fixes in the persona's own project, each graded by hidden tests (the visible test plus at least two more cases) in a no-network container of the arm's image. Seeds 100, 102 and 104 map to coding-11 (CSV quoting), coding-13 (retry backoff) and coding-15 (the /health method check).

| Cell | n | Paid $ | Passed | Section in transcript | Median session s |
|---|---|---|---|---|---|
| cc-opus-defaults-coding | 3 | 0.24 | 3/3 | 0/3 | 16 |
| cc-opus-full-coding | 3 | 0.32 | 3/3 | 3/3 | 17 |
| codex-sol-defaults-coding | 3 | 0.51 | 3/3 | 0/3 | 42 |
| codex-sol-full-coding | 3 | 0.56 | 3/3 | 0/3 | 46 |

With the suggestion in the session, Claude Code did the task first and offered the import after it in 2 of 3 replies, as the suggestion asks.

## Pilot checks

- **Part under test ran.** defaults and pr1: setup ran with `--no-suggestion` and reported `state: off` in all 20 trials, and gbrain delivered nothing. pr1 and full: all 22 sessions imported on every history-rich trial. full: the section reached the first session in Claude Code (5 of 5) and did not in Codex (0 of 5), so **Codex's full arm fails this check** and the suggestion's contrast in Codex cannot be measured on this build.
- **Tasks supplied and scored.** Every question reply was scored, every coding trial was graded, and no trial stopped on a setup or runner error.
- **Within caps.** Every arm spent under $1 on questions and under $0.60 on coding, against pilot caps of $10 to $14.

## Messy persona and coding supplement (ran 2026-11-25, after pilot 2)

Three short runs on the same build, so the freeze could price and size every counted cell: messy seeds 101 and 103 in every question cell that freezes (Codex's full arm excluded), and two more coding trials per arm on seeds 101 and 103.

| Cell | Trials | Paid ($) | Finish line (any) | Questions passed | Median question time (s) |
|---|---:|---:|---:|---:|---:|
| cc-opus-defaults | 2 | 0.66 | 0/2 | 0/6 | 68 |
| cc-opus-pr1 | 2 | 0.26 | 2/2 | 6/6 | 23 |
| cc-opus-full | 2 | 0.24 | 2/2 | 6/6 | 22 |
| cc-opus-plain | 2 | 0.49 | 0/2 | 2/6 | 75 |
| codex-sol-defaults | 2 | 0.38 | 1/2 | 5/6 | 52 |
| codex-sol-pr1 | 2 | 0.30 | 2/2 | 6/6 | 23 |
| codex-sol-plain | 2 | 0.13 | 1/2 | 5/6 | 24 |
| qm-opus-native | 2 | 0.14 | 1/2 | 5/6 | 10 |
| qm-opus-plain | 2 | 0.34 | 1/2 | 5/6 | 22 |
| qm-sol-native | 2 | 0.12 | 2/2 | 6/6 | 11 |
| qm-sol-plain | 2 | 0.14 | 2/2 | 6/6 | 28 |
| qm-particle-native | 2 | 0.02 | 1/2 | 3/6 | 11 |
| qm-particle-plain | 2 | 0.03 | 0/2 | 4/6 | 28 |

- **The suggestion in Claude Code** reached both messy first sessions (2 of 2).
- **QM ran twice.** The first attempt ran inside the Claude Code and Codex run while this machine's disk was full: one QM trial failed before any model call (its database could not start), two never started, and two finished. All five are set aside, unscored here, and QM ran again in its own run (the table's QM rows). The set-aside trials cost $0.06.
- **Coding:** Claude Code passed 4 of 4 (defaults 2/2, full 2/2, the suggestion seen in both full sessions). Codex defaults' 2 trials passed their hidden tests but both stopped on a $4 lease that was too small for Codex's reservations (`model_error`), so counted Codex shards get larger leases.
- **Scoring change.** A messy reply that named the right value first and a decoy later, to tell them apart, failed the value check under the first scorer. The plan's freeze changes the rule (an answer passes when its first line naming the value or a decoy names the value and no decoy); every pilot trial was re-scored under it, with no change to pilot 1 or pilot 2's main run.
- **Paid:** $2.51 (Claude Code and Codex, with the set-aside QM trials), $0.79 (QM) and $0.76 (coding). Summaries: [summary-messy.json](summary-messy.json), [summary-messy-qm.json](summary-messy-qm.json), [summary-coding.json](summary-coding.json); manifests: [pilot-messy.json](pilot-messy.json), [pilot-messy-qm.json](pilot-messy-qm.json), [pilot-coding.json](pilot-coding.json).

## Reproduce

```sh
bash harnesses/_first-wow/build.sh 2b4cc26f59861ba35c5ac30f60a2d133ae22d17b 0.60.774.0   # after building harness-eval/claude-code:dev and codex:dev
bun runner/run.ts plan --prereg docs/benchmarks/2026-11-24-gbrain-first-wow/pilot-2/pilot.json --out <run dir>
bun runner/run.ts run --manifest <run dir>/manifest.json --harness-mode docker --lease-usd 20 --max-output-tokens 128000
bun scripts/gbrain-first-wow/pilot-summary.ts <run dir> --json summary.json
```
