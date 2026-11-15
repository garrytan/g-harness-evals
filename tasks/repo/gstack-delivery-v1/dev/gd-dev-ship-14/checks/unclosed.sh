#!/bin/bash
# The oracle's branch with checks/unclosed/ laid over it.
bash /oracle/solve.sh
cp -r /checks/unclosed/. /work/repo/
cd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:feature/36ab48
