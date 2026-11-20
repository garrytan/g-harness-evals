#!/bin/bash
# A plausible wrong fix: skips the format for integer strings, so plain ones work but colored ones are left unformatted.
cd /work/repo
git apply /checks/wrong0.patch
