# Exposure pilot: QM with the gstack edition, 4 trials (uncounted)

**The pilot's pass rule holds: no trial is contaminated, and GPT-6.1 Sol opened its matched skill and read it whole on both tasks.** The caveat: **Opus 5.5 opened no skill on either task.** The skills index was in its system prompt with both entries intact, and it went straight to the work. Nothing here is graded.

- **Stage:** exposure pilot, edition arm only, rev-01 and plan-01 x Opus 5.5 and GPT-6.1 Sol = 4 trials, all `ok`, none excluded. Uncounted.
- **Rules:** the Exposure pilot section and its Pilot addendum (2026-11-07) in `../PREREGISTRATION.md`.
- **Launch commit:** `8a0c89533bc165b2771e35b6a415f1df0b4806ca` (the Pilot addendum). Edition `6cf00aee9c0fdedc722f35c1f0032c3db9404104`, the pinned one.
- **Shard:** one (`pilot`), one Ubicloud standard-16 VM; its lease and stage cap are in `../spend-internal.md`, an internal file kept out of the public copy. No cap stop. The shard exits 1 because the driver checks its whole 96-trial plan while `--only` ran 4; its summary says `cap_stop: false`.
- **Task digests match the headroom stage:** tasks.json `d86d40429e59...`, preflight tasks `977c9eb5fc54...`.

## Per trial

| Trial | Index listed | Opened matched skill | Read whole | First step (after open) | First step anywhere | Approvals | Contaminated | USD |
|---|---|---|---|---|---|---:|---|---:|
| rev-01, Opus 5.5 | yes | no | no | no | yes | 0 | no | 0.0729 |
| rev-01, GPT-6.1 Sol | yes | yes (gstack-review) | yes | yes | yes | 0 | no | 0.0507 |
| plan-01, Opus 5.5 | yes | no | no | no | no | 0 | no | 0.1165 |
| plan-01, GPT-6.1 Sol | yes | yes (gstack-plan) | yes | yes | yes | 0 | no | 0.0586 |

- **Opus 5.5:** opened no skill file of any kind. On rev-01 it still ran the review's first step (the branch diff) on its own.
- **GPT-6.1 Sol:** also read QM's built-in `github-gitlab` skill on both tasks. That is a QM skill, not gstack, so the clean-arm check does not count it.
- **Opens, complete reads and first steps are reported, not graded** (Pilot addendum).

## Cost multiplier over plain (same 4 task and model pairs)

| Slice | Multiplier |
|---|---:|
| All 4 | 1.23 |
| Opus 5.5 | 1.28 |
| GPT-6.1 Sol | 1.15 |

The edition and plain cost sums behind each multiplier are in `../spend-internal.md`, an internal file kept out of the public copy.

- One trial per cell, so treat these as rough. Opus's higher multiplier comes with no skill read, so the extra cost there is not from reading a skill body.

## Spend

- The stage's spend lines are in `../spend-internal.md`, an internal file kept out of the public copy.
- **VM:** destroyed, `list --mine` empty.
- **No judge call, and no alias-key grading.**

## Files

- `turns.jsonl`: the 4 turn records. `trials/`: each trial's evidence (`trial.json`, `session.json`, `llm-turn0.json` with the captured requests).
- `replies.jsonl`: the 4 edition replies, ungraded, kept for judge calibration.
- `pilot-summary.json`: the numbers above, from `pilot-analysis.py` (reads `../headroom/turns.jsonl` for plain costs).
- `shards/pilot/`: the ledger, proxy log and usage, preflight, run record, task digests and VM records.
- `fanout-pilot.json`: the fan-out manifest.
