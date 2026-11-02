# Findings

**One file per public claim, each tied to receipts at a pinned commit.** A finding is shorter than a run report: the claim, the number with its interval, what it costs, why a null came out null, how to check it, and what it does not show. The run reports under [docs/benchmarks/](../docs/benchmarks/) stay the full record.

Each file follows the shared finding template used across our eval repositories: front matter (grade, commit, preregistration, data digests), then the title with Garry's disclosure paragraph under it, a status line, What we found, How it works, Setup, Result, Cost, Why null?, Limits, Replicate it, What is held out, Claim check, Disclosures, Chart and post, and Changelog. The model-vs-harness and gbrain-first files end with a Haiku 5.5 appendix, graded dev.

| Finding | Grade | Claim, short |
|---|---|---|
| [2026-11-01-model-vs-harness](2026-11-01-model-vs-harness.md) | confirmatory (Sonnet 5.5); dev (Haiku 5.5) | OpenClaw, Hermes Agent and QM showed no pass-rate difference we could detect on Sonnet 5.5 on the v0.1 held-out tasks; Sonnet 5.5 passed 13 to 19 points more than Haiku 5.5 in every harness (bootstrap intervals +3 to +34; only OpenClaw's gap survives the sign-flip test after Holm) |
| [2026-11-01-untold-gbrain-unused](2026-11-01-untold-gbrain-unused.md) | dev | gbrain installed as an MCP server with no instruction was called in 4 of 799 scored trials, and pass rate showed no change we could detect |
| [2026-11-01-gbrain-first-no-pass-lift](2026-11-01-gbrain-first-no-pass-lift.md) | confirmatory (Sonnet 5.5), custody by digest only; dev-weight appendix (Haiku 5.5) | A brain-first instruction got gbrain used but showed no pass gain we could detect on Sonnet 5.5, and cross-scope reads were higher in all three told cells (+16 [+1, +33], +15 [+3, +31], +11 [-1, +27] points; none survives Holm) |

- **Status of every finding: draft, not posted.** All three passed a cross-family claim check and a clean-machine rerun with edits (2026-11-01). The edits are applied. A recheck of the edited lines the same day asked for a few more line edits, also applied. Garry's disclosure lines now sit under each file's title, and a last read-only check of these edits comes before any post.
- **Coming next:** a finding on the Lane B Terminal-Bench 2 replication, once its results are merged.

## Changelog

### 2026-11-01: disclosures answered

The status line says Garry's disclosure lines are in the files, and the template line names the disclosure paragraph under each title. Why: he answered the pending disclosure question.

### 2026-11-01: recheck applied

The status line says the edited lines were rechecked and the recheck's line edits are applied. Why: the recheck finished, so "pending" was no longer true.

### 2026-11-01: grades and appendices match the files

The gbrain-first row's grade now names its Haiku 5.5 appendix, as its front matter does, and the template line says which two files end with an appendix. Why: the index should describe each file the way the file describes itself.

### 2026-11-01: first three findings

Added the index and the first three finding files, with every number recomputed from the merged receipts. The same day, the claim-check edits were applied to all three.
