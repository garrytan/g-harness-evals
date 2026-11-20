#!/bin/bash
# A plausible wrong fix: handles n == 0 but lets a negative n through to islice.
cd /work/repo
git apply /checks/wrong0.patch
