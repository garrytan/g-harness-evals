#!/bin/bash
# A plausible wrong fix: strips trailing slashes from the fragment instead of leading ones.
cd /work/repo
git apply /checks/wrong0.patch
