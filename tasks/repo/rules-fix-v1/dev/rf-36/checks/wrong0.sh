#!/bin/bash
# A plausible wrong fix: drops extra labels but no longer pads missing labels with empty strings.
cd /work/repo
git apply /checks/wrong0.patch
