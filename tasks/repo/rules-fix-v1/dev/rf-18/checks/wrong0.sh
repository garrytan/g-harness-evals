#!/bin/bash
# A plausible wrong fix: matches the scheme case-insensitively but still only rewrites a lowercase file:/// prefix.
cd /work/repo
git apply /checks/wrong0.patch
