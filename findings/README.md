# Findings

**One file per public claim, each tied to receipts at a pinned commit.** A finding is shorter than a run report: the claim, the number with its interval, what it costs, why a null came out null, how to check it, and what it does not show. The run reports under [docs/benchmarks/](../docs/benchmarks/) stay the full record.

Each file follows the shared finding template used across our eval repositories: front matter (grade, commit, preregistration, data digests), then a status line, What we found, How it works, Setup, Result, Cost, Why null?, Limits, Replicate it, What is held out, Claim check, Chart and post, Changelog, and a closing Disclosures section with Garry's lines. The model-vs-harness and gbrain-first files have a Haiku 5.5 appendix, graded dev, just before the Disclosures section. The Opus gstack steps file adds an Update, 2026-11-03 section before What we found and a Clean control arm section after Limits. The state-machine pilot file, a guest page, keeps its own heading "The claim check" and adds an Agent notes section before its Disclosures.


## Topic findings (frontier models)

**Short pages for outside readers, one per lesson the front page states.** Each opens with two or three takeaways, gives the evidence and its main caveat, links an addendum with the details, and links the full reports. Every number is copied from a report that passed a claim check; these pages do not use the template above.

- [Where to put a rule so an agent follows it](rule-placement/README.md): from the instruction-placement run (Opus 5.5 and GPT-6.1 Sol).
- [With the model fixed, harnesses differ on cost more than on pass rate](harness-cost/README.md): from the harness matrix and the cost breakdown runs.
- [A shared brain needs per-person access rules](shared-brain-access/README.md): from the installer runs on Claude Code and Codex, with and without gbrain's access rules.
- [Test prompt cuts on tasks the agent can fail](prompt-cuts/README.md): from the prompt archaeology run and its follow-up on harder tasks.
- [Agents fail most by answering from the wrong conversation, and an unscoped brain returns records the asker may not read](where-agents-fail/README.md): from the failure-mining run over 1,998 failed frontier trials we already had.

## Claim files

| Finding | Grade | Claim, short |
|---|---|---|
| [2026-11-01-model-vs-harness](2026-11-01-model-vs-harness.md) | confirmatory (Sonnet 5.5); dev (Haiku 5.5) | OpenClaw, Hermes Agent and QM showed no pass-rate difference we could detect on Sonnet 5.5 on the v0.1 held-out tasks (the Sonnet minus Haiku contrast is appendix only) |
| [2026-11-01-untold-gbrain-unused](2026-11-01-untold-gbrain-unused.md) | dev | gbrain installed as an MCP server with no instruction was called in 4 of 799 scored trials, and pass rate showed no change we could detect |
| [2026-11-01-gbrain-first-no-pass-lift](2026-11-01-gbrain-first-no-pass-lift.md) | confirmatory (Sonnet 5.5), custody by digest only; dev-weight appendix (Haiku 5.5) | A brain-first instruction got gbrain used but showed no pass gain we could detect on Sonnet 5.5, and cross-scope reads were higher in all three told cells (+16 [+1, +33], +15 [+3, +31], +11 [-1, +27] points; none survives Holm) |
| [2026-11-02-opus-gstack-steps-not-followed](2026-11-02-opus-gstack-steps-not-followed.md) | dev (three uncounted checks, rules frozen before the first trial) | Told to use a gstack skill, Opus 5.5 loaded the skill text every time and ran none of its steps (0 of 46 sessions; deciding check 0 of 16 on near-saturated dev tasks; hard-task check VOID), at about twice the cost per trial. Verdict FIX-METHOD: the first checks were saturated, and the hook test that raised the ceiling (preregistered, Opus 5.5 and GPT-6.1 Sol) did not bind Opus, which wrote source through Bash past the gate 40 times, so the gate is not added; the first report's CUT-CANDIDATE is kept as the original reading |
| [2026-11-09-state-machine-prompt-pilots](2026-11-09-state-machine-prompt-pilots.md) | pilot, descriptive only (one Opus 5.5 run per repo and arm, counts with no statistical claim); guest finding from the gstack-evals crew | On gstack, gbrain and a private game, the viral "find all of the implicit state machines" prompt fixed 1 verified bug where "find the bugs" fixed 15. Adding a model-checking step found 8 verified state bugs, 5 with pstack's skills and 3 with the same steps in plain words, a gap that is noise at one run each. 6 of 12 sessions broke existing tests. A preregistered test decides |

- **Status of the first three: none is for publication, and none carries a verdict.** They rest on Sonnet 5.5 and Haiku 5.5 only, and these evals now test frontier models only (Opus 5.5 and GPT-6.1 Sol), so each verdict line reads "No R48 verdict: Sonnet/Haiku only (R54); frontier rerun pending". Model-vs-harness is not for publication, with its Sonnet minus Haiku contrast as appendix only. Untold-gbrain and gbrain-first are dev background for the planned Opus 5.5 reruns. Each of the three titles now starts "Sonnet/Haiku only, not frontier evidence".
- **Review.** All three passed a cross-family claim check and a clean-machine rerun with edits (2026-11-01). The edits are applied. A recheck of the edited lines the same day asked for a few more line edits, also applied. Garry's disclosure lines now close each file, and a last read-only check of these edits comes before any post.
- **Opus gstack steps (2026-11-02, updated 2026-11-03):** a draft with a verdict (FIX-METHOD). Its three original checks ran Opus 5.5 only; the 2026-11-03 update adds the hook test, which ran Opus 5.5 and GPT-6.1 Sol. Its claim check by the gstack-evals crew passed with edits (2026-11-02), and the edits are applied. The recheck of the edited lines passed the same day. The update's claim check, one GPT-6.1 Sol reader over two rounds, asked for edits, which are applied.
- **State-machine prompt pilot (2026-11-09):** a guest finding from the gstack-evals crew, who ran the pilot and wrote the page. It is a pilot with counts only, so it makes no statistical claim, and its verdict is FIX-METHOD: a preregistered test, being prepared as draft pull request [gstack-evals #290](https://github.com/garrytan/gstack-evals/pull/290), decides. Its records stay in gstack-evals, so it has no row in this repository's receipts manifest.
- **Coming next:** nothing for the Opus gstack steps finding until a gate that also covers Bash-mediated writes is tested. The Lane B Terminal-Bench 2 replication gets no finding file: it is a Haiku 5.5 comparability rerun, and its report, in open pull request #181, carries that label.

## Changelog

### 2026-11-09: where agents fail

Added a topic page from the failure-mining run (failure-mining-2026-11) and its line in the topic list. Why: the run's results land in this pull request, and its two lessons need a page for outside readers.

### 2026-11-09: state-machine prompt pilot (guest finding)

Added a row, a status bullet, a template note and two disclosure lines for the gstack-evals crew's pilot of the viral implicit-state-machines prompt and pstack's model-checking follow-up. Why: the gstack-evals crew's page is published here as a guest finding, with their credit on the page and in the row.

### 2026-11-08: topic findings for outside readers

Added four short topic pages, each with an addendum, and a section that lists them. Why: the README now states four lessons for readers who have never seen the repository, and each lesson needs one page to link to.

### 2026-11-03: Opus gstack steps finding updated

The Opus gstack steps row adds the hook-enforced test's result (internal-task), its status bullet no longer says Opus 5.5 data only and records the update's claim check, "Coming next" no longer waits on that run, and the template line names the file's Update, 2026-11-03 section. Why: its report merged (#244) and the finding file now carries it.

### 2026-11-02: frontier labels and disclosures

Each Sonnet/Haiku finding's title line is labelled Sonnet/Haiku only, the Opus gstack steps row drops its internal codes, the Lane B line no longer promises a finding, internal work-stream codes are gone from the status line, and the page closes with a Disclosures section. Why: the folder is getting ready for outside readers, and a Sonnet or Haiku result is not frontier evidence.

### 2026-11-02: Opus gstack steps finding

Added a row (verdict FIX-METHOD) and a status bullet for the Opus 5.5 gstack follow-rate finding, and "Coming next" now names the hook-enforced steps run instead of the Lane B replication. The template line names the file's Clean control arm section. Why: the Opus checks merged, and the Lane B rerun is Haiku only.

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

## Disclosures

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI. OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

The private game repository is also Garry Tan's own project.

We found no tie between Y Combinator or Garry Tan and Cursor (Anysphere), whose plugins repository hosts pstack, in the public YC company directory or Lauren Tan's public profiles, checked 2026-11-09.
