#!/bin/bash
# A plausible wrong fix: adds __getstate__ and __setstate__ but not __new__, so unpickling sets items before the linked list exists.
cd /work/repo
git apply /checks/wrong0.patch
