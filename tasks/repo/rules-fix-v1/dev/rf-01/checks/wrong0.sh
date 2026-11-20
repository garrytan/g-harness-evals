#!/bin/bash
# A plausible wrong fix: strips control codes only from tokens that have no style.
cd /work/repo
git apply /checks/wrong0.patch
