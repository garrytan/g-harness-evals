# gstack steps cards (HARN-61)

**Attribution:** every card line is quoted from gstack (garrytan/gstack) at commit `68b1d056a4fcf300ca2b61a1406940c5dd336916` (2026-11-09), MIT License, Copyright (c) 2026 Garry Tan. The licence text is in [GSTACK-LICENSE.txt](GSTACK-LICENSE.txt).

**What these are:** the steps card the hook and startup arms of the gstack delivery eval put in front of the agent, one per task kind. Each is gstack's own wording, picked line by line from its /review and /ship templates, at most 700 bytes, with no trailing newline.

| Card | Bytes | sha256 |
|---|---|---|
| [review.md](review.md) | 539 | `92ff952d1f76d6871c8a97c9dcd885332bf3510de7ebf6eab1e72334252efaaf` |
| [ship.md](ship.md) | 590 | `dfae5c36ffcc64460eba35b5e0a76025ebe9e6339d33bf724c689903abb1a697` |

## How a card is built

- [selection.json](selection.json) lists every card line: the gstack file, the line (or line span), the heading it sits under, the verbatim text, why it was picked, and the probe marker that scores it.
- `bun scripts/gstack-delivery/extract-cards.ts` rebuilds both cards from the templates at the pinned commit (read with git, so a newer checkout still works) and compares them with the files here. `--write` rewrites them; `--committed` checks the files against the selection without a gstack checkout.
- It fails closed with a stable code when a line moved (`CARD_TEXT_MOVED`), a section moved (`CARD_SECTION_MOVED`) or the pin is missing (`CARD_PIN_MISSING`). The script's header lists every code.
- Left out on purpose: gstack binaries, AskUserQuestion steps and auto-fix steps. The extractor refuses a line that names any of them.

## Which lines are scored

A probe marker scores only a step the task text does not already ask for (plan gate change d5). Each marker sits on exactly one line.

| Card line | Marker (scripts/gstack-delivery/probes.ts) | Why no marker |
|---|---|---|
| review: Read the FULL diff before commenting | `review.full_diff_first` | |
| review: Verify claims or flag them as unknown | `review.check_before_finding` | |
| review: For an approved defect regression, write the test and prove it fails for the original defect before changing product code | `review.test_per_finding` | |
| review: Only flag real problems | none | the task says "Report only real problems" |
| review: Cite `file:line` | none | the output contract asks for file and line |
| ship: Run tests (on merged code) | none (descriptive count `ship.tests_after_merge`) | the none arm already did it in 87.5% of ship trials in the first headroom check |
| ship: IRON LAW: NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE | `ship.fresh_verification` | |
| ship: Use `git diff origin/<base>` ... to see the full proposed change | `ship.final_diff_after_commit` | |
| ship: Merge the base branch, the changelog rule, the push and never force-push | none | the task asks to merge into origin/main, follow CONTRIBUTING.md and push the branch, not main |

**Ship marker moved (d5, 2026-11-09).** The first headroom check found the none arm already ran the tests after the merge in 87.5% of ship trials, so that marker could not show a difference and the d5 gate failed. The marker moved to the IRON LAW line as `ship.fresh_verification`: a full test-suite run after the last change to the repository (CHANGELOG and version edits included) and before the push. Ship "followed" is now `final_diff_after_commit` and `fresh_verification`. `tests_after_merge` is still reported per trial as a descriptive count. The card text and its sha256 are unchanged.

**Not quite gstack's words for one step:** gstack's ship templates never mention CONTRIBUTING. The "follow CONTRIBUTING" step uses their nearest wording, the rule for where the changelog entry goes (`ship/sections/changelog.md.tmpl` lines 9 to 11).

**Status:** approved as gstack's proposed cards.

GSTA-36 approved 2026-11-09, one edit to review line 4

- The edit: review line 4 now carries the full clause from `review/SKILL.md.tmpl` lines 355 to 356, not the middle of it.
- The review task changes no product code, so `review.test_per_finding` counts a test written and run for each reported finding before that finding is written up in review.json.
- Approved hashes: review.md `92ff952d1f76d6871c8a97c9dcd885332bf3510de7ebf6eab1e72334252efaaf`, ship.md `dfae5c36ffcc64460eba35b5e0a76025ebe9e6339d33bf724c689903abb1a697` (unchanged). The preregistration freezes these.
