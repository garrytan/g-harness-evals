#!/bin/bash
# A plausible wrong fix: turns non-string choices into strings but still lists every choice when show_choices is off.
cd /work/repo
git apply /checks/wrong0.patch
