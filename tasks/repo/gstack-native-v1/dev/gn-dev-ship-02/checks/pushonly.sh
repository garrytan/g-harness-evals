#!/bin/bash
cd /work/repo && git fetch -q origin && git merge -X ours --no-edit origin/main >/dev/null 2>&1; git push -q origin HEAD:feature/1e5249
