# 2026-10-30: opening-1 gate, fail

**The v0.3 seal at custody commit (private) (bundle sha256 `d69a7a0c12d93a980dbfbf79fca2a307dcc8bced1d03c22156298b45537ef1f0`) is not cleared for opening 1.** Recorded by internal-task under internal-task's conditional approval of the seal deviation ([deviation-approval.md](deviation-approval.md)).

- **The gate:** endpoint 6 of `v03-installer-dev-2026-10` ([preregistration](../2026-10-29-v03-installer-dev/PREREGISTRATION.md), merged in #128 before the first trial). It needs at least 5 of 6 families informative in the told arm and no task defect.
- **The read:** 4 of 6 informative ([report](../2026-10-29-v03-installer-dev/report.md), "Endpoint 6").
  - In range: scope isolation 23/40, shared channel 14/20, synthesis 20/30, continuity 36/40.
  - Out of range: corrections 1/40 and approval relay 0/30.
- **Defects:** the three approval relay dev tasks. Both readings are in [defects.json](../2026-10-29-v03-installer-dev/results/defects.json).
  - ar-01 and ar-02 (both readers): the grant comes from an approver who holds no record of the figure. The only way to the figure is a read the task's own scope predicate fails.
  - ar-03 (second reader; the author reads it as a floor task): the grant comes from the approver the bot usually asked, but in the two trials where the bot asked nobody the figure was out of reach.
  - The second reader also found that the pre-grant check rejects a draft to the account owner.
- **Corrections** has no defect. Its zero-pass tasks are floor tasks in both readings. internal-task's approval names corrections at the told-arm floor as a limit for opening 1 either way.

What follows, as preregistered:

1. No opening. The seal at custody commit (private) is retired unopened. It was never opened, so nothing was spent on it.
2. internal-task fixes the approval relay template and regenerates its held-out candidates from the same private seed.
   - Corrections also failed the 10 to 90 percent rule, and the Fail clause says to revise the failing templates.
   - internal-task's reading: corrections has no defect and is a named limit, so its template and candidates stay as generated. internal-task decides whether corrections is revised too.
3. internal-task reseals the set as a new seal.
4. Before opening 1, a small preregistered dev run reads the fixed family's told cells on OpenClaw and Hermes, with the same 10 to 90 percent rule and the same defect rule, inside internal-task's lane budget. The set must then show at least 5 of 6 families informative, counting the four that passed here.

This note does not change the pilot's verdict (no-go) or its report.

**Redaction note.** 2026-11-02: custody commit SHA redacted for publication; the private repo keeps it. No number changed.
