#!/bin/bash
# Authoring check for a review task: runs every oracle probe test (oracle/test_*.py, oracle/decoy_*.py) on every verifier
# tree (corrected, defective, fix<k>) as nobody, in the task's verifier image, and prints one line of exit codes per tree.
# A defect's test must exit 1 on defective and on every fix<j> but its own, and 0 on corrected and on its own fix<k>.
# Decoy tests must exit 0 everywhere. Build the images first (scripts/repo-tasks/matrix.ts builds them).
#
#   bash scripts/repo-tasks/delivery/probe-review.sh <task dir>      (VERBOSE=<test name> prints that test's output)
T=$(realpath "$1"); ID=$(basename "$T")
docker run --rm --network none -e VERBOSE="$VERBOSE" -v "$T/oracle:/oracle:ro" "harness-eval/repo-verifier:$ID" bash -c '
SRC=$(python3 -c "import json;print(json.load(open(\"/tests/task.json\")).get(\"src\",\".\"))")
for tree in $(ls /tests/trees | grep -v base); do
  rm -rf /tmp/r && cp -r /tests/trees/base /tmp/r && cp -r /tests/trees/$tree/. /tmp/r/ && chmod -R a+rX /tmp/r
  line="$tree:"
  for t in /oracle/test_*.py /oracle/decoy_*.py; do
    mkdir -p /tmp/r/tests_review && cp $t /tmp/r/tests_review/ && chmod -R a+rX /tmp/r/tests_review
    (cd /tmp/r && setpriv --reuid=65534 --regid=65534 --clear-groups env PYTHONPATH=/tmp/r/$SRC HOME=/tmp python3 -m pytest -q -p no:cacheprovider -o addopts= tests_review/$(basename $t) >/tmp/out 2>&1); rc=$?
    line="$line $(basename $t .py)=$rc"
    [ -n "$VERBOSE" ] && [ "$(basename $t .py)" = "$VERBOSE" ] && tail -20 /tmp/out
  done
  echo "$line"
done'
