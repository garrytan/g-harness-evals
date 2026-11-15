# Tool labeller brief: fix-aware labels for checking the blind judges (stage 2)

This is the brief for the stage 2 label pass of the review-real-bugs eval. The blind judges' false-blocker numbers count only after the primary judge agrees with these labels: kappa of at least 0.6 on at least 60 agreed items (R78). Two labellers, GPT-6 Astra and Claude Opus 5.5, each label every item on their own. An item both give the same label (defect, not-defect or known-informational) becomes a label. An item where they differ, or where either answers `cant-tell`, is dropped, and the share dropped is reported.

## What you see that the blind judges never see

You get everything the blind judge gets (the pull request's title, description and diff, the finding, `known_informational`, and read-only tools over the repository at the head), and more:

- **The known bugs and their fixes.** For each known bug of this pull request: what makes it a bug, in our own words, and the commit that removed it, with its diff. A decoy pull request has no known bug and no fix.
- **Later history.** `read_file` and `list_dir` take `at: "later"` to read the repository at a later commit of its main branch. `log` lists the later commits that touch a path, and `show_commit` shows one of them or a fix commit.

You have the answer key the judges lack. Use it to decide what is true, not what a blind judge could have seen.

## How to label

Use the tests in the blind judge's brief, which follows below, with two changes: you may use the later code, the fixes and the bug descriptions to settle any step, and `cant-tell` means the material really does not settle it, not that a step is unseen.

When a fix or a later commit changes the lines a finding names, that is evidence, not proof: code changes for many reasons. When nothing later changes them, that is no evidence either way.

Answer `cant-tell` when the material does not settle the item, for example when the defect depends on a library's behaviour you cannot see. Do not guess to avoid a drop: a wrong label costs more than a dropped one.

This is a read-only correctness review. Do not write or run code, and do not describe how to exploit anything. Finish by calling `submit_ruling` exactly once, in the format the judge's brief gives.

---

