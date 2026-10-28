# Loop preregistration: <loop name>

Copy this file to `docs/loops/<yyyy-mm-dd>-<loop-name>.md`, fill every section, and merge it to main before the loop's first iteration. It is the loop's R7 preregistration ([methodology](../methodology.md), item 14). A change after the first iteration is a dated amendment at the bottom, committed before the iterations it affects; a change to the keep rule, the frozen surface or the noise floor is a new loop.

## What the loop changes and why

- Owner (thread or person) and the system the loop steers:
- The question the loop answers, in one sentence:
- Proposer: who or what proposes each change (a model with its id, a person, a script):

## Writable paths

The only paths a proposed change may touch. Anything else in a proposal is refused before it is measured.

- `<path>`

## Frozen surface

Everything the loop measures against and may not change: tasks, graders, preamble, world, pins, scoring code.

- Paths:
- Hash: sha256 over the listed files at commit `<sha>`, computed with `<command>`:

## Data the loop sees

- Dev set the proposer gets diagnostics from (failing cases, transcripts, per-task counts):
- Held-out or sealed set, if any, and its openings ledger row (`tasks/multiuser/<set>/heldout/MANIFEST.json`): the proposer gets only keep or revert from it (R4).
- Exposures: every per-task held-out diagnostic sent to the proposer is recorded in that set's `exposures`, and those tasks become dev for this proposer.

## Candidate hash (R5)

How each candidate's `candidate_sha256` is computed (for example sha256 over the gbrain commit, the preamble's sha256 and the adapter configuration's sha256, joined in that order):

## Noise floor (R1)

- Measured by: a repeat run of the unchanged candidate on the same tasks, `<n>` repetitions; for a deterministic keyless rung, two identical runs (a floor of zero).
- Floor value and the receipt it comes from:

## Keep rule (R1, R2)

- Keep a change only when its paired gain on `<metric>` beats the noise floor by `<margin>`.
- Regressions are counted apart from fixes (former passes lost beside former misses fixed). Regression limit: at most `<k>` regressions per change, whatever the net gain.

## Budget and stopping rule

- Budget: `<iterations>` iterations, `<dollars>` in leases, `<wall time>`.
- Stop when: the budget is spent, `<m>` consecutive changes are reverted, or `<other condition>`.

## Re-confirmation and release (R3, R6)

- Before any claim leaves the loop, the top three candidates are re-run on a fresh draw: `<which tasks, how many repetitions>`.
- A champion's confirmation is a counted run on a set it was not developed against, under its own preregistration.
- The report shows the pre-loop baseline and the one-shot baseline (the first candidate proposed) beside the champion.
- Release schedule: what is published after each iteration, and what only at the end:

## Amendments

Dated, newest last, each committed before the iterations it affects.
