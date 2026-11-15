#!/usr/bin/env bash
# Stub of scripts/ubicloud/ubi-runner.sh for tests/canary-remote-capacity.test.ts. Locations listed one per line in
# $STUB_UBI_DIR/full answer like a region with no room ("waiting for capacity") whose VM the teardown confirmed gone
# (left=0). Locations in $STUB_UBI_DIR/leak answer the same way, but the teardown could not confirm the VM is gone ("VM
# cleanup not confirmed", left=1) and it stays listed; locations in $STUB_UBI_DIR/ghost report left=0 and the VM stays
# listed anyway. Any other location runs, and the --pull remote directory gets a trials.jsonl. Every run's location is
# appended to $STUB_UBI_DIR/tries; a VM still up is a "<location>  <name>" line of $STUB_UBI_DIR/listed, which list --mine
# prints; every down appends its name to $STUB_UBI_DIR/downs, and fails when $STUB_UBI_DIR/down-fails exists. Locations in
# $STUB_UBI_DIR/copyfail run, but their results hold an unreadable file, so copying them back fails, and the VM stays listed.
set -uo pipefail
d=$STUB_UBI_DIR
cmd=${1:-}; shift || true
case $cmd in
  owner) echo harn00 ;;
  pull) exit 0 ;;
  list) cat "$d/listed" 2>/dev/null; exit 0 ;;
  down)
    echo "$1" >> "$d/downs"
    [ ! -e "$d/down-fails" ] || { echo "ubi-runner: stub down of $1 failed" >&2; exit 1; }
    grep -vF "  $1" "$d/listed" > "$d/listed.tmp" 2>/dev/null; mv "$d/listed.tmp" "$d/listed" 2>/dev/null
    exit 0 ;;
  run)
    loc=eu-central-h1 pull="" name=""
    while [ $# -gt 0 ]; do
      case $1 in -l) loc=$2; shift 2 ;; -n) name=$2; shift 2 ;; --pull) pull=$2; shift 2 ;; --) shift; break ;; --src|--setup|--pass|-s) shift 2 ;; *) shift ;; esac
    done
    echo "$loc" >> "$d/tries"
    name=${name:-ubirun-harn00-1700000000-stub$(wc -l < "$d/tries")-t3}
    if grep -qsx "$loc" "$d/leak"; then
      echo "ubi-runner: VM did not reach running in 10 minutes (last state: waiting for capacity)" >&2
      echo "$loc  $name" >> "$d/listed"
      echo "UBICLOUD: left=1 owner=harn00 vm=$name others=0" >&2
      echo "ubi-runner: VM cleanup not confirmed for $name (left=1); destroy it with: ubi-runner.sh down $name" >&2
      exit 3
    fi
    if grep -qsx "$loc" "$d/full" || grep -qsx "$loc" "$d/ghost"; then
      echo "ubi-runner: VM did not reach running in 10 minutes (last state: waiting for capacity)" >&2
      ! grep -qsx "$loc" "$d/ghost" || echo "$loc  $name" >> "$d/listed"
      echo "UBICLOUD: left=0 owner=harn00 vm=$name others=0" >&2
      exit 3
    fi
    src=${pull%%:*} dest=${pull#*:}
    mkdir -p "$dest/$(basename "$src")"
    echo '{"usage":{"usd":0.5}}' > "$dest/$(basename "$src")/trials.jsonl"
    if grep -qsx "$loc" "$d/copyfail"; then
      : > "$dest/$(basename "$src")/zz-unreadable"; chmod 000 "$dest/$(basename "$src")/zz-unreadable"
      echo "$loc  $name" >> "$d/listed"
      echo "UBICLOUD: left=1 owner=harn00 vm=$name others=0" >&2
      exit 0
    fi
    echo "UBICLOUD: left=0 owner=harn00 vm=$name others=0" >&2
    ;;
  *) exit 2 ;;
esac
