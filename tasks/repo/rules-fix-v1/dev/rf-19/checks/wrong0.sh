#!/bin/bash
# A plausible wrong fix: recognises IF NOT EXISTS as one keyword but not IF EXISTS.
cd /work/repo
git apply /checks/wrong0.patch
