#!/usr/bin/env bash
# Passes iff <workspace>/hello.txt contains exactly the word hello. A trailing
# newline is accepted; anything else fails. The workspace defaults to
# /workspace and can be passed as the first argument so the grader runs in an
# evaluator container or on a captured tree.
set -u
ws="${1:-/workspace}"
f="$ws/hello.txt"
if [ ! -f "$f" ]; then
  echo "fail: $f does not exist"
  exit 1
fi
content=$(cat "$f")
if [ "$content" = "hello" ]; then
  echo "pass: hello.txt contains hello"
  exit 0
fi
printf 'fail: hello.txt contains %q\n' "$content"
exit 1
