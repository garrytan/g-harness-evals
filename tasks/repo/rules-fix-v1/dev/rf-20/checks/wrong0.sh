#!/bin/bash
# A plausible wrong fix: takes the first dot instead of the last, so a.b.c still names b.
cd /work/repo
git apply /checks/wrong0.patch
