#!/usr/bin/env bash
# Stand-in for git in tests/canary-core-run.test.ts, first on PATH. CANARY_STUB_GIT names the real git. CANARY_STUB_GIT_FAIL:
# lease-read makes a show of a receipts lease write part of the file and fail (a dropped connection mid-read); push makes every
# receipts push fail except the run lock's (the remote went away after the lock was taken).
real=$CANARY_STUB_GIT
if [ "${1:-}" = -C ]; then
  case ${CANARY_STUB_GIT_FAIL:-}:${3:-} in
    lease-read:show) case ${4:-} in origin/*:leases/*) "$real" "$@" | head -c 64; echo "stub git: connection reset" >&2; exit 128 ;; esac ;;
    push:push) case $("$real" -C "$2" log -1 --format=%s) in "Lock canary run"*) ;; *) echo "stub git: push refused" >&2; exit 1 ;; esac ;;
  esac
fi
exec "$real" "$@"
