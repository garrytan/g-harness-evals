#!/bin/bash
# A plausible wrong fix: stops the lookup from creating keys but never records keys whose items went straight to the caller.
cd /work/repo
git apply /checks/wrong0.patch
