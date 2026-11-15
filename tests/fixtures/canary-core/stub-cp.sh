#!/usr/bin/env bash
# Stub cp for tests/canary-receipts-staging.test.ts and tests/canary-core-run.test.ts: every call is appended to
# $STUB_CP_DIR/calls, then runs the real cp ($STUB_REAL_CP), except for a staging call (a source ending in /.), which
# answers by $STUB_CP_MODE: cross-device refuses every hard link (cp -al) as a copy to another filesystem would;
# partial hard-links everything but verdict.json, as fs.protected_hardlinks does for a file another user owns; nospace
# fails both the links and the copy as a full disk does, with a blank line after the error.
echo "$*" >> "$STUB_CP_DIR/calls"
staging=0 links=0
for a in "$@"; do case $a in */.) staging=1 ;; -al) links=1 ;; esac; done
dest=${!#}
if [ "$staging" -eq 1 ]; then
  case ${STUB_CP_MODE:-} in
    cross-device) [ "$links" -eq 0 ] || { echo "cp: cannot create hard link '${dest}verdict.json': Invalid cross-device link" >&2; exit 1; } ;;
    partial) if [ "$links" -eq 1 ]; then "$STUB_REAL_CP" "$@" || exit 1; rm -f "${dest}verdict.json"; echo "cp: cannot create hard link '${dest}verdict.json': Operation not permitted" >&2; exit 1; fi ;;
    nospace) printf "cp: error writing '%sverdict.json': No space left on device\n\n" "$dest" >&2; exit 1 ;;
  esac
fi
exec "$STUB_REAL_CP" "$@"
