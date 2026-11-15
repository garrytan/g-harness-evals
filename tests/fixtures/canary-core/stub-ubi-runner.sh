#!/usr/bin/env bash
# Stub of scripts/ubicloud/ubi-runner.sh for tests/canary-remote-capacity.test.ts. Locations listed one per line in
# $STUB_UBI_DIR/full answer like a region with no room ("waiting for capacity"); any other location runs, and the --pull
# remote directory gets a trials.jsonl. Every run's location is appended to $STUB_UBI_DIR/tries.
set -uo pipefail
cmd=${1:-}; shift || true
case $cmd in
  owner) echo harn00 ;;
  list|pull|down) exit 0 ;;
  run)
    loc=eu-central-h1 pull=""
    while [ $# -gt 0 ]; do
      case $1 in -l) loc=$2; shift 2 ;; --pull) pull=$2; shift 2 ;; --) shift; break ;; -n|--src|--setup|--pass|-s) shift 2 ;; *) shift ;; esac
    done
    echo "$loc" >> "$STUB_UBI_DIR/tries"
    if grep -qx "$loc" "$STUB_UBI_DIR/full" 2>/dev/null; then
      echo "ubi-runner: VM did not reach running in 10 minutes (last state: waiting for capacity)" >&2
      echo "UBICLOUD: left=0 owner=harn00 vm=stub others=0"
      exit 3
    fi
    src=${pull%%:*} dest=${pull#*:}
    mkdir -p "$dest/$(basename "$src")"
    echo '{"usage":{"usd":0.5}}' > "$dest/$(basename "$src")/trials.jsonl"
    echo "UBICLOUD: left=0 owner=harn00 vm=stub others=0"
    ;;
  *) exit 2 ;;
esac
