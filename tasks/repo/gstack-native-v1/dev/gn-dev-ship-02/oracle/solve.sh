#!/bin/bash
cd /work/repo
git fetch -q origin
git merge --no-edit origin/main >/dev/null 2>&1
cp -r /oracle/final/. /work/repo/
git add -A
git commit -q -m "Finish feature"
git push -q origin HEAD:feature/1e5249
