#!/bin/bash
# A plausible wrong fix: stores the custom schemes as a set without lowercasing them.
cd /work/repo
git apply /checks/wrong0.patch
