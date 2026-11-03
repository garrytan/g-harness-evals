# Findings

**One file per public claim, each tied to receipts at a pinned commit.** A finding is shorter than a run report: the claim, the number with its interval, what it costs, why a null came out null, how to check it, and what it does not show. The run reports under [docs/benchmarks/](../docs/benchmarks/) stay the full record.

Each file follows the shared finding template used across our eval repositories: front matter (grade, commit, preregistration, data digests), then a status line, What we found, How it works, Setup, Result, Cost, Why null?, Limits, Replicate it, What is held out, Claim check, Chart and post, Changelog, and a closing Disclosures section with Garry's lines. The model-vs-harness and gbrain-first files have a Haiku 5.5 appendix, graded dev, just before the Disclosures section. The Opus gstack steps file adds a Clean control arm section after Limits.

| Finding | Grade | Claim, short |
|---|---|---|
| [2026-11-01-model-vs-harness](2026-11-01-model-vs-harness.md) | confirmatory (Sonnet 5.5); dev (Haiku 5.5) | OpenClaw, Hermes Agent and QM showed no pass-rate difference we could detect on Sonnet 5.5 on the v0.1 held-out tasks (the Sonnet minus Haiku contrast is appendix only) |
| [2026-11-01-untold-gbrain-unused](2026-11-01-untold-gbrain-unused.md) | dev | gbrain installed as an MCP server with no instruction was called in 4 of 799 scored trials, and pass rate showed no change we could detect |
| [2026-11-01-gbrain-first-no-pass-lift](2026-11-01-gbrain-first-no-pass-lift.md) | confirmatory (Sonnet 5.5), custody by digest only; dev-weight appendix (Haiku 5.5) | A brain-first instruction got gbrain used but showed no pass gain we could detect on Sonnet 5.5, and cross-scope reads were higher in all three told cells (+16 [+1, +33], +15 [+3, +31], +11 [-1, +27] points; none survives Holm) |
| [2026-11-02-opus-gstack-steps-not-followed](2026-11-02-opus-gstack-steps-not-followed.md) | dev (three uncounted checks, rules frozen before the first trial) | Told to use a gstack skill, Opus 5.5 loaded the skill text every time and ran none of its steps (0 of 46 sessions; deciding check 0 of 16 on near-saturated dev tasks; hard-task check VOID), at about twice the cost per trial. Verdict FIX-METHOD under R61 (the null rests on saturation), with hook-enforced steps on tasks with headroom (internal-task) as the ceiling-raise; internal-task's CUT-CANDIDATE is kept as the original reading |

- **Status of the first three: none is for publication, and none carries a verdict.** They rest on Sonnet 5.5 and Haiku 5.5 only, and these evals now test frontier models only (Opus 5.5 and GPT-6.1 Sol), so each verdict line reads "No R48 verdict: Sonnet/Haiku only (R54); frontier rerun pending". Model-vs-harness is not for publication, with its Sonnet minus Haiku contrast as appendix only. Untold-gbrain and gbrain-first are dev background for the Opus 5.5 reruns in internal-task's v0.4 and internal-task's H10.
- **Review.** All three passed a cross-family claim check and a clean-machine rerun with edits (2026-11-01). The edits are applied. A recheck of the edited lines the same day asked for a few more line edits, also applied. Garry's disclosure lines now close each file, and a last read-only check of these edits comes before any post.
- **Opus gstack steps (2026-11-02):** a draft on Opus 5.5 data only, with an R48 verdict. Its claim check by the gstack-evals crew passed with edits (2026-11-02), and the edits are applied. The recheck of the edited lines passed the same day.
- **Coming next:** the hook-enforced steps run (internal-task), once its results are merged. The Lane B Terminal-Bench 2 replication gets no finding file: it is a Haiku 5.5 comparability rerun, and its report, in open pull request #181, carries that label.

## Changelog

### 2026-11-02: Opus gstack steps finding

Added a row (verdict FIX-METHOD under R61) and a status bullet for the Opus 5.5 gstack follow-rate finding, and "Coming next" now names the hook-enforced steps run instead of the Lane B replication. The template line names the file's Clean control arm section. Why: internal-task's Opus checks merged, and the Lane B rerun is Haiku only.

### 2026-11-01: frontier models only

The status bullet says none of the three is for publication or carries a verdict, and the model-vs-harness row drops the Sonnet minus Haiku contrast. Why: these evals now test frontier models only, and all three files rest on Sonnet 5.5 and Haiku 5.5.

### 2026-11-01: disclosures answered

The status line says Garry's disclosure lines are in the files, and the template line names the closing Disclosures section. Why: he answered the pending disclosure question.

### 2026-11-01: recheck applied

The status line says the edited lines were rechecked and the recheck's line edits are applied. Why: the recheck finished, so "pending" was no longer true.

### 2026-11-01: grades and appendices match the files

The gbrain-first row's grade now names its Haiku 5.5 appendix, as its front matter does, and the template line says which two files end with an appendix. Why: the index should describe each file the way the file describes itself.

### 2026-11-01: first three findings

Added the index and the first three finding files, with every number recomputed from the merged receipts. The same day, the claim-check edits were applied to all three.
