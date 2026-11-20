#!/bin/bash
# A plausible wrong fix: also catches KeyError from the choice function, but a custom choice function can raise anything.
cd /work/repo
git apply /checks/wrong0.patch
