# Matching brief: does a blinded finding name a known bug?

This is the brief for the matching batch of the review-real-bugs eval. The judge runner (gstack-evals `noloss judge-run` at the pinned rig commit) sends each judge this file, then the batch's `batch.json`, then one packet, all written by `noloss judge-packet`. `batch.json` carries the suite's judging rule, the reply format and the reply rules. This brief adds the framing, the matching test for this suite and the impact rating.

## What you are reading

- One pull request from a public open-source repository, reviewed at one commit against its base.
- `blockers`: the known bugs in that pull request. Someone other than these reviews found each one: a human reviewer, another review tool, or a later fix with a test that fails at this commit. We wrote every description in our own words. A blocker gives the path or paths it sits on, a file and a line, and a `cause` that says what is wrong, which lines hold it, and why it blocks the merge.
- `findings`: findings from several anonymous reviews of the same pull request, under opaque ids, in a shuffled order, with severity words masked. You do not know which review wrote which finding. Do not guess.

## The matching test

For every blocker, list the ids of the findings that name the same bug. A finding matches a blocker when all three of these hold:

1. **Place.** The finding sits on a path the blocker lists. Its line may differ from the blocker's, for example when it points at the caller or at the first line of the function.
2. **Cause.** It names the same mistake in the code: the same wrong condition, value, missing step, wrong call or wrong order. A good check: if a developer fixed exactly what the finding describes, the blocker's bug would be gone.
3. **Effect.** The failure it describes is the blocker's failure, or follows directly from the same mistake.

These do not match:

- a finding about a different bug in the same file or function;
- a general worry that names no mistake ("error handling here is fragile", "this needs tests");
- a finding that names a symptom a different mistake could cause, without naming the blocker's mistake;
- a finding that points at the blocker's lines but says they fail in a different way.

When a finding names the cause only in part, match it if a developer who read only that finding would look at the blocker's lines and find the blocker's mistake there. Otherwise do not.

A finding can match more than one blocker only if it names each of them. Several findings can match one blocker. An empty list is a valid answer. Ignore severity, tone, length and how confident a finding sounds; severity is applied mechanically afterwards. A finding that names the right cause matches even if the fix it suggests is wrong.

## Impact rating

Rate the impact of every finding in the packet, matched or not, as `blocking` or `non-blocking`. **Blocking** means that if the pull request merged as it stands, the problem the finding names would fail a test, break behaviour a user or another program relies on, or lose data or expose secrets. Anything else is **non-blocking**: style, naming, docs and comments, a missing test with no wrong behaviour, a slower path with no stated limit that it breaks, hardening for a possible future change, and claims you judge to be false.

## Reply

Reply with one JSON object in the reply format `batch.json` gives, plus one extra key in each packet entry, `impact`, mapping every finding id in that packet to `"blocking"` or `"non-blocking"`. Nothing else, no prose.

## Fixed settings

- The judges are the plan's: GPT-6 Astra for the Claude Opus 5.5 cell (C1), with Claude Opus 5.5 as a second judge there, and Claude Opus 5.5 for the other cells.
- Request settings, retries and the second and third reads are judge-run's at the pinned rig commit. At gstack-evals 91d76421 that is one user message with no tools, at most 16,000 output tokens, reasoning effort `medium` on the OpenAI route and no thinking field on the Anthropic route, and a refused reply asked again once in a fresh request.
- judge-run keeps `impact` out of the reply file judge-join reads and writes it to `impact.tsv`.
