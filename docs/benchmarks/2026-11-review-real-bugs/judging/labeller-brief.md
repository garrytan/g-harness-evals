# Labeller brief: fix-aware labels for checking the blind judges

This is the brief for the label pass of the review-real-bugs eval (plan section "Grading"). The blind judges' numbers count only after they agree with these labels: at least 60 matching items and 60 adjudication items, with Cohen's kappa of at least 0.6 on each (R78). Two labellers, GPT-6 Astra and Claude Opus 5.5, each label every item on their own. An item both give the same label becomes a label. An item where they differ, or where either answers `unsure`, is dropped, and the share dropped is reported.

## What you see that the blind judges never see

Each label packet holds what the blind judges saw for that item, and more:

- **The blind material.** The matching packet (the pull request, its known bugs, the findings under opaque ids with severity words masked) or the adjudication packet and its evidence sheet. Findings stay anonymous: you do not know which review wrote which, and must not guess.
- **The fix.** The commit that removed the known bug: its diff against the reviewed head.
- **The bug's evidence.** What makes the known bug a bug, in our own words: a paraphrase of the reviewer's or review tool's comment, or the regression test that fails at the reviewed head with the line of its failing output, or a scripted reproduction and its log.
- **For adjudication items, the whole file** the finding names, at the reviewed head, not only the 61 lines the sheet shows.

You have the answer key the judges lack. Use it to decide what is true, not what a blind judge could have shown.

## Matching items

Each item is one known bug and one finding from the same pull request. Label it `match` or `no-match` with the matching test in [the matching brief](judge-brief.md): same path, same mistake, same failure. The fix settles the mistake: a finding matches when doing what it asks would change the lines the fix changes in the way the fix changes them, or would remove the failure the bug's evidence shows by another correct route. A finding about other lines the fix happens to touch does not match unless it names the same mistake.

## Adjudication items

Each item is one blocking finding that matches no known bug. Label it `defect`, `not-defect` or `known-informational` with the tests in [the adjudication brief](adjudication-brief.md), with one change: you may use the whole file, the fix and the bug's evidence to settle any step, so `unshown` is not available to you. Decide whether the defect is real at the reviewed head, or answer `unsure`. The blocking bar is the same: it would fail a test, break production, or lose data or expose secrets (R12).

When the fix or a later commit changes the lines a finding names, that is evidence, not proof: a fix can change lines for another reason. When nothing later changes them, that is no evidence either way.

## When to answer unsure

Answer `unsure` when the material does not settle the item, for example when the defect depends on a library's behaviour you cannot see, or a match turns on a reading of the finding that two careful readers could take either way. Do not guess to avoid a drop: a wrong label costs more than a dropped one.

This is a read-only correctness review. Do not write or run code, and do not describe how to exploit anything.

## Reply

Reply with one JSON object and nothing else:

```json
{
  "labeller": "<your model name>",
  "packet": "<the label packet's file name>",
  "packet_sha256": "<the label packet's sha256>",
  "items": [
    {
      "item": "<item id from the packet>",
      "kind": "match or adjudicate",
      "label": "match, no-match, defect, not-defect, known-informational or unsure",
      "test": "for adjudicate: defect, known, contradicted, unreachable, not-blocking or vague; for match: null",
      "cites": ["fix hunk, file:line or evidence line the label rests on"],
      "reason": "one or two plain sentences"
    }
  ]
}
```

Label every item in the packet once. `cites` must point at material in the packet.

## Fixed settings

- Labellers: GPT-6 Astra and Claude Opus 5.5, each on every item, each in a fresh request per packet, through the metering proxy under the eval's ledger lease.
- Request settings match the blind judges' (one user message, no tools, at most 16,000 output tokens, reasoning effort `medium` on the OpenAI route, no thinking field on the Anthropic route). A reply that is not valid JSON in the format above, or that leaves an item unlabelled, is asked again once in a fresh request; a second failure drops that packet's items for that labeller, and they count as dropped.
- If GPT-6 Astra refuses a packet on its cyber-security policy (the error says `cyber_policy`), the pass follows R95. This brief is already worded as a read-only correctness review, so that packet goes to Gemini 4 Carbon with the brief unchanged as the second-family labeller. If Gemini 4 Carbon fails too, Opus labels it alone, its items are dropped from the label set, and the report says the second-family read is missing.
