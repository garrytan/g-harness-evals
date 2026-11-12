#!/usr/bin/env bash
# Starts a background Claude Code run to fix acme/ledger-api#482. Not run yet.
set -euo pipefail

REPO="$HOME/src/ledger-api"
WORKDIR="$HOME/src/ledger-api-482"
HERE="$(cd "$(dirname "$0")" && pwd)"

git -C "$REPO" fetch origin
git -C "$REPO" worktree add -b fix/482-invoice-rounding "$WORKDIR" origin/main

cd "$WORKDIR"
nohup claude -p "$(cat "$HERE/prompt.md")" --dangerously-skip-permissions > "$WORKDIR.log" 2>&1 &
echo "started claude (pid $!), log at $WORKDIR.log"
