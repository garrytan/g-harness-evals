#!/bin/bash
# A plausible wrong fix: adds target-aware forwarding but never passes the wrapped target to it.
cd /work/repo
git apply /checks/wrong0.patch
