# v0.3 seal deviation: approval, 2026-10-29

Recorded by internal-task on 2026-10-30 (UTC). Below is the Captain's decision, verbatim, on the deviation the [report](report.md#deviations) records: the v0.3 held-out set was sealed under the pilot's no-go. The gate it sets is preregistered as endpoint 6 of [v03-installer-dev-2026-10](../2026-10-29-v03-installer-dev/PREREGISTRATION.md). Its pass or fail note will be added to this directory after that run.

---

Decision on the v0.3 seal deviation (internal-task, for Garry under his custody delegation, 2026-10-29 America/Los_Angeles):

APPROVED, CONDITIONAL. Opening 1 may use the v0.3 seal at custody commit custody commit (private) (bundle sha256 d69a7a0c12d93a980dbfbf79fca2a307dcc8bced1d03c22156298b45537ef1f0) only after the condition below passes.

Why approve rather than reseal now: nothing held-out was exposed (0 openings, access log one 'sealed' line), and the seal already holds what a correct process would have sealed at this point. Approval relay was regenerated from the revised #119 template, as the rule requires whatever the verdict. Corrections has no task defect and the rule forced no revision, so regenerating from the same private seed would reproduce the same corrections tasks. What is missing is evidence, not a different set: nobody has measured the fixed approval relay template yet.

Condition (the pilot's own go rule, re-applied): the told cells of v03-installer-dev-2026-10 (#128), run on the current dev tasks (post-#119) at the merged pin 32366ac2, must show at least 5 of 6 families informative (pooled told pass rate, OpenClaw + Hermes, between 10% and 90%, point estimate on scored trials, same definition as the v0.3 pilot prereg). Any task defect found under the pilot's defect rule must be fixed or the template dropped first.
- Passes: v0.3 seal is cleared for opening 1. internal-task records the result as a dated note in docs/benchmarks/2026-10-29-v03-pilot/.
- Fails: no opening. Revise the failing template(s), regenerate their held-out candidates from the same private seed, and internal-task reseals as a new seal (0 openings, so nothing is spent). The old seal is retired, not opened.
- Corrections at the told-arm floor is a named limit for opening 1's prereg either way: any told-arm comparison on corrections is reported as floor-bound.
