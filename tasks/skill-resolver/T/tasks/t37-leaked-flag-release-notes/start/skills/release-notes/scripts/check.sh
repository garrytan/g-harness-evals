#!/usr/bin/env bash
# Checks a release-notes draft before it goes to #releases.
set -euo pipefail
f="$1"
fail=0

if grep -nE '#[0-9]+' "$f"; then echo "check: remove PR numbers"; fail=1; fi
if grep -niE '\b(TODO|FIXME|WIP)\b' "$f"; then echo "check: unfinished text"; fail=1; fi
for h in '**New**' '**Improved**' '**Fixed**'; do
  grep -qF "$h" "$f" || { echo "check: missing heading $h"; fail=1; }
done

exit $fail
