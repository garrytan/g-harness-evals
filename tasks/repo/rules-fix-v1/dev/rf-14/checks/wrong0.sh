#!/bin/bash
# A plausible wrong fix: adds __copy__ but not __deepcopy__.
cd /work/repo
git apply /checks/wrong0.patch
