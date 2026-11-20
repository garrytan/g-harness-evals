#!/bin/bash
# A plausible wrong fix: converts only the destination parts to a list, so a tuple of base parts plus a list still fails.
cd /work/repo
git apply /checks/wrong0.patch
