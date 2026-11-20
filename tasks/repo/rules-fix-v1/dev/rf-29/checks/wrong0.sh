#!/bin/bash
# A plausible wrong fix: escapes the pipe character in header rows only.
cd /work/repo
git apply /checks/wrong0.patch
