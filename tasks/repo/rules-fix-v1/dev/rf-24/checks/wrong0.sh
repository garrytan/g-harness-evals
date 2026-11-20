#!/bin/bash
# A plausible wrong fix: still compares the default with an empty string first, which raises for types that refuse the comparison.
cd /work/repo
git apply /checks/wrong0.patch
