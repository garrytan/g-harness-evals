#!/bin/bash
# A plausible wrong fix: moves the defaults after the base constructor but keeps the base missing-value check, so required=True still fails.
cd /work/repo
git apply /checks/wrong0.patch
