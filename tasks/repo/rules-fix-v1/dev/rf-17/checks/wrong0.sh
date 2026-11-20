#!/bin/bash
# A plausible wrong fix: skips the instance-dict rewrite for class access only when the method has no attribute name.
cd /work/repo
git apply /checks/wrong0.patch
