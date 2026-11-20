#!/bin/bash
# A plausible wrong fix: passes markup=None, which still falls back to the console setting.
cd /work/repo
git apply /checks/wrong0.patch
