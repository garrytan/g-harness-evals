#!/bin/bash
# The upstream fix's source change.
set -e
cd /work/repo
git apply /oracle/fix.patch
