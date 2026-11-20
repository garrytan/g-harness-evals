#!/bin/bash
# A plausible wrong fix: reads a missing field as None instead of leaving it out, so the repr shows item=None.
cd /work/repo
git apply /checks/wrong0.patch
