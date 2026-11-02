# gn-follow-2026-11: follow-rate check, decision rule (written before the first trial)

Written 2026-11-01 (America/Los_Angeles) by HARN-14, before any trial of this run. Uncounted (no preregistration PR, per HARN-1); this file is the decision rule of record. Plan: autoplan run harn14-opus-native-20261101160021, revision ca371d38956e, step 2 (d1, d3, d4, approved by Garry "Do it" 2026-11-01).

## What runs
- Run id `gn-follow-2026-11`, plan file `screening/gn-follow-2026-11.json` (schema gstack-laneb/1) on scratch branch `harn14/follow-2026-11`, which is PR 1's head plus that one file. Never merged.
- Model: Opus 5.5 (claude-opus-5-5) only. Harness: Claude Code 2.1.312 under Lane B's pinned agent (gstack-evals 443d582c).
- Arms, all on one Ubicloud VM (HARN-1: every machine runs all three arms): none (empty ~/.claude), placebo (tar ff6b909d...), gstack (gstack 61e201ec08bcf59163ef2d3a69a26e334a536c04, pack-equivalent rebuild tar b9399468...).
- Tasks: the 8 public dev tasks of gstack-native-v1 (2 each of fix, review, qa, ship), 2 tries per arm: 48 trials, 16 per arm.
- Deviation from the plan text (gstack 3, placebo 2, none 1): plan.ts takes one repetition count for every arm, so every arm runs 2 tries. gstack gets 16 sessions, not 24.
- Money: one ledger lease `gn-follow-2026-11:opus-follow` of $21.80 (plan.ts lease: 48 x $0.25 x 1.4 + $5 Opus session cap), inside the $25 cap. A cap stop is not retried.

## The measure
`laneb.skill_probe.followed` on every record (scripts/gstack-laneb/skill-probe.ts at PR 1's head), summarized by `bun scripts/gstack-laneb/skill-probe.ts summary --results <merged results dir>`.
- Denominator: sessions with a transcript. Sessions with no transcript are counted per arm and reported, never scored as false.
- Interval: Wilson 95% on followed / with_transcript, per arm.
- Sessions are treated as independent. They come from 8 tasks and 4 skills, so the interval is narrower than a task-clustered one; the report shows per-skill counts beside it.

## The rule (gstack arm)
- Upper bound of the Wilson 95% interval below 0.60: **STOP**. No sealed-path, recipe-v2 or held-out work. The finding is about the package as shipped and invoked: gstack 61e201ec, installed in ~/.claude and invoked by Lane B's slash-command wrapper on Opus 5.5, is mostly not followed. Report to HARN-1 and, through it, to GSTA-36 with per-skill counts and transcripts' first gstack step.
- Lower bound above 0.40: **PROCEED** to the bridge wave (plan step 3).
- Otherwise: **ASK** HARN-1.
- Any followed session on none or placebo: **PROBE_FAULT**. The probe is fixed before any decision is taken from it.

With 16 sessions: 0 to 5 followed is STOP, 6 to 10 is ASK, 11 to 16 is PROCEED.

## Also reported (not part of the rule)
preamble_ok, skill_steps_ok and skill_tool counts per arm and skill; pass rate and mean reward per arm (dev tasks, uncounted, near ceiling); cost per trial per arm from the ledger; body-load gate.

## Revision 2 (2026-11-01, still before the first trial)
The round-2 engineering review (autoplan run harn14-opus-native-20261101160021, findings eng-r2-native F1 and eng-r2-outside F2) found two faults in the measure above. Both are fixed in PR 1 at commit bb0adc0b4 on branch harn14/skill-probe, and this revision replaces the matching lines above. No trial had run when it was written.
- Probe: a read of the skill's shared sections/preamble.md is no longer a skill step (every gstack skill body says to read it before gstack-skill-start, so it belongs to the preamble). Section reads and tools now count in both install copies, skills/gstack/<skill>/ and the top-level skills/<skill>/ that /<skill> loads. Recorded sessions: no followed bit changed (gstack 0 of 67, none 0 of 113, placebo 0 of 71, before and after).
- Completeness: the rule decides only on complete data. Run as: skill-probe.ts summary --results <merged results dir> --expect 16. If any arm is missing, any session has no probe reading, or any arm has other than 16 sessions, the decision is INCOMPLETE; the report gives the band the gstack interval alone would have given and the reasons, and asks HARN-1. This replaces "Denominator: sessions with a transcript".
- Code: the trials run from the scratch branch harn14/follow-2026-11 (PR 1 at bb0adc0b4 plus the plan file). The probe is a pure read of each session's transcript, so the decision is computed with skill-probe.ts at PR 1's shipped head over the same transcripts. If that head's probe changed after bb0adc0b4 and any bit differs, the report shows both.
- Network: Harbor allowlist (vm-run.sh default), as the counted run will use.
- Population: a STOP reads "on gstack-native-v1 dev tasks, which Opus 5.5 nearly saturates on the none arm", with per-skill counts (eng-r2-native F3). A STOP there is reported as such, not as a finding about held-out tasks.
