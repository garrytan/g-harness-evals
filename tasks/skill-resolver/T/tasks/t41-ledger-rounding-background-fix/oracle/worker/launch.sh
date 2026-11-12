#!/usr/bin/env bash
# Prepares an isolated worktree for acme/ledger-api#482 and starts a background Claude Code worker in it.
set -euo pipefail

REPO="$HOME/src/ledger-api"
WORKTREE="$HOME/src/ledger-api-worktrees/fix-482-invoice-rounding"
BRANCH="fix/482-invoice-rounding"
HERE="$(cd "$(dirname "$0")" && pwd)"

git -C "$REPO" remote get-url origin | grep -q 'acme/ledger-api'
git -C "$REPO" fetch --prune origin
BASE_SHA="$(git -C "$REPO" rev-parse origin/main)"
git -C "$REPO" worktree add -b "$BRANCH" "$WORKTREE" origin/main
test "$(git -C "$WORKTREE" rev-parse HEAD)" = "$BASE_SHA"

PROMPT="$(mktemp -t openclaw-worker-prompt.XXXXXX)"
sed -e "s|{{BASE_SHA}}|$BASE_SHA|g" -e "s|{{WORKTREE}}|$WORKTREE|g" "$HERE/prompt.md" > "$PROMPT"
printf 'prompt file: %s\nbase SHA: %s\nworktree: %s\n' "$PROMPT" "$BASE_SHA" "$WORKTREE"

# Claude Code runs without a PTY, in the isolated worktree, in the background.
cd "$WORKTREE"
nohup claude --permission-mode bypassPermissions --print < "$PROMPT" > "$WORKTREE.log" 2>&1 &
printf 'worker pid: %s, log: %s\n' "$!" "$WORKTREE.log"
