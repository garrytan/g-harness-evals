# Tool judge brief: is an unmatched blocking finding a real defect? (stage 2)

This is the brief for the stage 2 blind judges of the review-real-bugs eval, and for the stage 1 re-judge. The runner (harness-evals `scripts/review-bugs/tool-judge.ts`) sends you this brief, then one pull request and one finding. You can read the repository through tools.

Why it changed from stage 1: the stage 1 judges saw only 61 lines around each finding, and about 93% of their not-defect rulings said the sheet did not show enough to decide. The fix-aware labellers then disagreed with them (kappa 0.01). So you now get the repository itself, read-only, at the pull request's head.

## What you have

- **The pull request**, at its head commit: its title and first description, and its full diff against the base (long diffs are cut, and the `pr_diff` tool gives any file's part).
- **One finding.** Some anonymous review raised it as blocking, and it matches none of the pull request's known bugs. It may be right or wrong. Do not guess which review wrote it.
- **`known_informational`**: problems the suite already records as real but not blocking, if the unit has any.
- **Tools**, read-only, over the repository at the head only: `list_dir`, `read_file`, `grep` and `pr_diff`. There is no later history, no fix, no execution and no network. You have a fixed budget of tool calls. When it is spent, only `submit_ruling` remains.

**Seen and claimed.** A fact is *seen* when you read it in the repository or the diff. Everything in the finding's text is *claimed*: it is what a reviewer said, and it may be wrong. Rule on what you have seen.

## How to rule

Apply these in order. The first one that settles the finding decides it.

1. **Known informational.** If `known_informational` lists a case and the finding raises that same case (a path the case lists and the same cause), rule **known-informational**. Never use this ruling on a unit that lists no case.
2. **Defect.** Rule **defect** only when all four hold:
   - **D1 Trigger.** You can name a concrete input, call order, configuration value or stored state under which the code at the head does the wrong thing. "Bad input", "under load" or "an edge case" without saying which is not concrete.
   - **D2 Lines.** You can cite the lines where the wrong thing happens, and nothing you read stops the trigger: no check, early return, type, default or guard on the path.
   - **D3 Breaks.** The wrong behaviour clears the blocking bar: a test someone would reasonably write against the code's documented or evident behaviour would fail; a user or another program would see a wrong result, a crash, a hang or a valid request refused, in normal use; or data would be lost or corrupted, or a secret or private data would reach someone who should not see it.
   - **D4 Seen.** You read every step from the trigger to the failure in the repository or the diff.
   A defect ruling counts whether or not this pull request introduced the problem, as long as it is present at the head.
3. **Not-defect.** When the defect test fails and you have seen why, rule **not-defect** and name the test, the first that applies:
   - **contradicted**: the code contradicts the finding (the guard it says is missing is there, the value differs, the call is not made). Cite the lines.
   - **unreachable**: the trigger cannot happen given the code (a validation, a type or every caller rules it out). Cite the lines.
   - **not-blocking**: the finding is true, but what follows is below the bar in D3: style, naming, docs, log wording, a missing test with no wrong behaviour, a slower path with no stated limit it breaks, or hardening against a possible future change.
   - **vague**: the finding names no concrete mistake you could check.
4. **Can't tell.** Rule **cant-tell** when the repository at the head cannot settle it within your budget: for example the outcome turns on a library, service or runtime setting that is not in the repository, or on code you could not find. This ruling is counted on its own and never as a false alarm, so do not force a guess either way.

## What not to use

Do not use your memory of the repository or its later history, how confident or detailed the finding sounds, or what severity it was given. This is a read-only correctness review. Security findings are ruled the same way, by the trigger, the lines and the consequence. Do not write or run code, and do not describe how to exploit anything.

## Reply

Finish by calling `submit_ruling` exactly once, with:

- `ruling`: `defect`, `not-defect`, `cant-tell` or `known-informational`.
- `test`: `defect`, `known`, `contradicted`, `unreachable`, `not-blocking`, `vague` or `cant-tell`.
- `lines`: the lines your ruling rests on, as `path:line` or `path:from-to`; empty only for `not-blocking`, `vague` or `cant-tell`.
- `trigger`: for a defect, the concrete input or state from D1 in one sentence; otherwise null.
- `breaks`: for a defect, `test`, `production` or `data-or-secrets`; otherwise null.
- `reason`: one or two plain sentences.
