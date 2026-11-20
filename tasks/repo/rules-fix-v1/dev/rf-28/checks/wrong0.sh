#!/bin/bash
# A plausible wrong fix: copies every attribute from the async function, so the wrapper no longer points back at the sync filter.
cd /work/repo
git apply /checks/wrong0.patch
