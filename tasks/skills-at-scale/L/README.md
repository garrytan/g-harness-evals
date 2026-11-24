# Set L, dev half

207 of set L's 410 skill-routing requests: 147 that need one of the 100 target skills and 60 that need none. The other 203 rows (the test half) are sealed and go in by digest only.

- **File:** setl-dev.jsonl, sha256 d5ad1362adc9bc606c23b533d2305f358d19e9255065f3c71f977191e51e6d55. Each row has id, request, half and kind; skill rows also name the target, its pack, the asked style (low, mid or high word overlap), the measured overlap and stratum, and how many writer attempts it took.
- **Test half:** sha256 3721b6d07ad53fe4b650d7b9fc68f10450f69462858fb416c0081d5e8a9cf4e8, 203 rows, kept outside git.
- **What the run reads:** .skills-at-scale/setl.jsonl, both halves as {id, request, half} rows, sha256 77224ccf07bf5f3ef1137280b3c4ffcf60647b9dcf58c2cce61a8e8fe348467e (prereg.json inputs).
- **Who wrote them:** Gemini 4 Carbon wrote the skill rows from each target's SKILL.md; the no-skill rows are plain questions no catalog skill covers.
- **What was dropped, and why:** 10 of the planned 420 rows. Two had no usable request from the writer (l-s-042-1, l-s-093-3, which named the job instead of describing it). Eight could not be labelled because a labelling judge's provider refused them (l-s-026-2, l-s-026-3, l-s-042-2, l-s-042-3, l-s-078-2, l-s-078-3, l-s-083-1, l-s-084-2).
- **Overlap spread:** of the 290 skill rows, 266 landed in the low overlap stratum, 24 in mid and none in high, against an asked spread of 98, 96 and 96. The plan reports overlap descriptively and makes no per-stratum claim (dated change, 2026-11-23).

The plan is docs/benchmarks/2026-11-skills-at-scale/PREREGISTRATION.md.
