#!/bin/bash
# A plausible wrong fix: makes NULLS FIRST/LAST an order keyword but does not join it with a preceding ASC or DESC.
cd /work/repo
git apply /checks/wrong0.patch
