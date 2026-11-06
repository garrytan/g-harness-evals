---
name: gstack-review
description: "Test-only stub: review a branch diff before merge. (stub)"
---
# gstack-review (test-only stub)

TEST-ONLY STUB for the keyless S1 edition tests. It copies the layout of gstack's qm/ edition and none of its text.

1. Stub step: run sh skills/gstack-review/scripts/diff-base.sh <base> from the repository.
2. Stub step: if that path does not exist, run git merge-base <base> HEAD and git diff --stat instead.
