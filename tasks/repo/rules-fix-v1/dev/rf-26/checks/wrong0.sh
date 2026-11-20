#!/bin/bash
# A plausible wrong fix: drops the old expiry entry but leaves the old value in the cache.
cd /work/repo
git apply /checks/wrong0.patch
