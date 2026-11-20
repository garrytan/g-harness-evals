#!/bin/bash
# A plausible wrong fix: gets an iterator to test for scalars but then calls iter() on the object again.
cd /work/repo
git apply /checks/wrong0.patch
