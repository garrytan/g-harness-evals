# 2026-10-31: opening-1 gate after the approval relay re-read, pass

**Approval relay is informative after #144's fix, and no task is a defect candidate. So the re-read passes its go rule, and the v0.3 set shows 5 of 6 families informative. The seal clearance for opening 1 is pending a family-scoped comparison by the custodian, internal-task, inside custody (item 3).** Recorded by internal-task under endpoint 1 of `v03-ar-reread-2026-10`.

- **The gate:** endpoint 1 of `v03-ar-reread-2026-10` ([preregistration](../2026-10-30-v03-ar-reread/PREREGISTRATION.md), merged in #149 before the first trial). It is the dev re-read that #142's endpoint 6 requires before a new seal is opened ([the 2026-10-30 note](2026-10-30-opening-1-gate.md)).
- **The read:** approval relay 17 of 30, 56.7% [40.0%, 80.0%], told arm on OpenClaw and Hermes, on opening 1's scoped gbrain config ([report](../2026-10-30-v03-ar-reread/report.md), "Endpoint 1"). Inside 10 to 90 percent.
- **Defects:** none. Each of the three tasks passed at least once (ar-01 8, ar-02 5, ar-03 4 of 10).
- **The count:** the four families that passed in #142 (scope isolation, shared channel, synthesis, continuity) plus approval relay: 5 of 6.
  - **Caveat:** those four were judged under the unscoped config (the bot-visible brain, one bot token). Approval relay was judged under the scoped config. So the 5-of-6 count mixes configs, and opening 1's report says so.
  - **Boundary:** continuity's 36 of 40 is 90.0%, the top edge of the 10 to 90 percent rule. One more continuity pass in #142 would have made the count 4 of 6.

What follows, as preregistered:

1. The new v0.3 seal internal-task makes from the regenerated set is cleared for opening 1 once items 2 and 3 are met.
2. That seal must be built from approval relay candidates generated at #144's merge commit `58186ff41`, with every other held-out candidate byte-identical to the retired seal's, as internal-task's reseal record shows.
3. **The reseal record is on main, and the clearance is pending (updated 2026-11-01 UTC).** #150 merged as `47bf4d98b` on 2026-10-31 UTC. It seals set v0.3-gen6 at custody commit (private), bundle sha256 `fc246287329ea960466e8b1ecd5982a9037f21d9ca05eeb84cde20c123cd0056`, and retires the seal at custody commit (private) unopened. Only the author's per-file hash list shows that only approval relay candidates changed. The custodian's comparison printed counts only, and the record does not name `58186ff41`. internal-task wrote this run and the hash list, so the clearance cannot rest on that list. **It waits on a family-scoped comparison by the custodian, internal-task, inside custody,** showing that only the approval relay candidates differ from the retired seal and that they were generated at `58186ff41` ([report](../2026-10-30-v03-ar-reread/report.md)).
4. Corrections at the told-arm floor stays a named limit for opening 1.

**One limit this note adds, not preregistered: the clearance covers the config this read used.**

- The deciding cells ran `scope: member-sources` at gbrain `a590ad07`. Each gbrain call went out under the asking member's own token and carried that member's `source_ids`. The preregistration names this as the config opening 1's gbrain arms run.
- internal-task's approval, quoted in the preregistration, says `scope: sources`. The pilot's `told-scoped` rung kept one unscoped token. Under that token alone, the preflight logs show out-of-grant `get_page` reads served, not refused (`results/*-scoped.preflight.log`).
- **So if opening 1 is preregistered with any other scope config, approval relay needs another dev read under that config.**

This note does not change the pilot's verdict (no-go), #142's endpoint 6 result (Fail, 4 of 6) or either report.

**Redaction note.** 2026-11-02: custody commit SHA redacted for publication; the private repo keeps it. No number changed.
