#!/bin/bash
# A plausible wrong fix: hides the hint only when an auto env var prefix is set, not when the option has no env var.
cd /work/repo
git apply /checks/wrong0.patch
