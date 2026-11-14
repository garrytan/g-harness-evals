# Adjudication brief: is an unmatched blocking finding a real defect?

This is the brief for the adjudication batch of the review-real-bugs eval. The judge runner (gstack-evals `noloss judge-run` at the pinned rig commit) sends each judge this file, then the batch's `batch.json`, then one packet, then that packet's evidence sheet. `batch.json` names the three rulings and the reply format. This brief says how to reach a ruling so that another reader can check it against the evidence sheet.

Why it is written this way: the adjudication brief used in gstack-evals R2 asked whether each finding "names a real defect", and its two judges agreed at kappa 0.09 on 22 findings, differing on 10. Its rule left open how far a judge may trust a review's claims about code the evidence sheet does not show. This brief settles that the same way for every judge, and asks each ruling to show its work.

## What you are reading

- **The packet.** One pull request at its head commit. Every finding in it was raised as blocking by some anonymous review and matches none of the pull request's known bugs. `known_informational` lists the unit's known informational cases, if it has any: problems the suite already records as real but not blocking. Findings sit under opaque ids, shuffled, with severity words masked. Do not guess which review wrote which.
- **The evidence sheet.** For every finding id: the evidence its review gave (masked the same way), and the code at the head from 30 lines before to 30 lines after the line the finding names, with line numbers. When the finding names no line, the sheet shows the file's first 200 lines. When the file is not in the repository at the head, or the line is past its end, the sheet shows no code and says why.

**Shown and claimed.** A fact is *shown* when the sheet's code for that finding contains it. Everything in a finding's text or its evidence is *claimed*: it is what a reviewer said, and it may be wrong. Rule on what is shown. A claim about code the sheet does not show (another file, a caller, a config value) cannot by itself carry a defect ruling.

## How to rule

Apply these in order. The first one that settles the finding decides it.

### 1. Known informational

If `known_informational` lists a case and the finding raises that same case (a path the case lists and the same cause, as in matching), rule **known-informational**, whatever you think of it otherwise. Never use this ruling on a unit that lists no case.

### 2. The defect test

Rule **defect** only when all four hold:

- **D1 Trigger.** You can name a concrete input, call order, configuration value or stored state under which the code at the head does the wrong thing. "Bad input", "under load", "an edge case" or "if a caller misuses it" without saying which is not concrete.
- **D2 Lines.** You can cite the lines in the sheet's code where the wrong thing happens, and nothing in the shown code stops the trigger: no check, early return, type, default or guard on the path.
- **D3 Breaks.** The wrong behaviour clears the blocking bar. One of: a test someone would reasonably write against the code's documented or evident behaviour would fail; a user or another program would see a wrong result, a crash, a hang or a valid request refused, in normal use; or data would be lost or corrupted, or a secret or private data would reach someone who should not see it.
- **D4 Shown.** Every step from the trigger to the failure is shown. If one step rests only on a claim about code the sheet does not show, D4 fails.

A defect ruling counts whether or not this pull request introduced the problem, as long as it is present at the head.

### 3. Not-defect tests

When the defect test fails, rule **not-defect** and name the test that applies, the first in this list:

- **contradicted**: the shown code contradicts the finding. The guard it says is missing is there, the value is different, or the call it describes is not made. Cite the lines.
- **unreachable**: the trigger the finding needs cannot happen given the shown code, for example a validation, a type or a caller on the path rules it out. Cite the lines.
- **not-blocking**: the finding is true, but what follows is below the bar in D3: style, naming, docs or comments, log or message wording, a missing test with no wrong behaviour, a slower path with no stated limit that it breaks, or hardening against a possible future change.
- **unshown**: the defect may be real, but deciding it needs code the sheet does not show. Set `verifiable` to false for this finding.
- **vague**: the finding names no concrete mistake you could check, such as a general worry or a question.

The failed part of the defect test points at the code: a failed D1 is usually `vague` or `unreachable`, D2 `contradicted` or `unshown`, D3 `not-blocking`, D4 `unshown`.

### What not to use

Do not use your own memory of the repository, how detailed or confident a finding sounds, how many findings repeat it, or what severity the review gave it. Several findings in a packet may describe the same issue: rule each one on its own, and give findings with the same cause on the same lines the same ruling.

This is a read-only correctness review. Security findings (a leaked secret, a missing access check) are ruled the same way, by the trigger, the lines and the consequence. Do not write or run code, and do not describe how to exploit anything.

## Reply

Reply with one JSON object in the reply format `batch.json` gives. In each packet entry, give every finding in the packet a `findings` entry with its `id` and `ruling`, and add these fields to each entry:

- `test`: `"defect"`, `"known"`, or the not-defect test you applied (`"contradicted"`, `"unreachable"`, `"not-blocking"`, `"unshown"` or `"vague"`).
- `lines`: the sheet lines your ruling rests on, as `"path:line"` or `"path:from-to"`; every one must be inside the code the sheet shows for that finding. An empty list only for `not-blocking`, `unshown` or `vague`.
- `trigger`: for a defect, the concrete input or state from D1, in one sentence; otherwise null.
- `breaks`: for a defect, `"test"`, `"production"` or `"data-or-secrets"` from D3; otherwise null.
- `reason`: one or two plain sentences.

Add one more key to each packet entry, `verifiable`, mapping every finding id to true when the sheet was enough to rule either way and false when it was not. Nothing else, no prose outside the JSON.

judge-join reads only `id` and `ruling`, and judge-run writes `verifiable` to `verifiable.tsv`. The other fields stay in the raw replies judge-run keeps, so a reader can check each ruling against the sheet.

## Fixed settings

- The adjudicators are the plan's: GPT-6 Astra for the Claude Opus 5.5 cell (C1), with Claude Opus 5.5 as a second judge there, and Claude Opus 5.5 for the other cells.
- Request settings, retries and the second and third reads are judge-run's at the pinned rig commit. At gstack-evals 91d76421 that is one user message with no tools, at most 16,000 output tokens, reasoning effort `medium` on the OpenAI route and no thinking field on the Anthropic route, and a refused reply asked again once in a fresh request.
- Before any paid trial this brief is dry-run on R2's 22 second-read findings with both judges (plan, section "Grading"). If it fails its kappa check, false-blocker counts on bug PRs are descriptive and false alarms are read from the decoy PRs only.
