#!/bin/bash
# A plausible wrong fix: calls iter() explicitly but still inside the try, so the TypeError is still swallowed.
cd /work/repo
git apply /checks/wrong0.patch
