#!/usr/bin/env bash
# Runs "alembic upgrade head" in the api session's first pane (venv and VPN env live there),
# blocks until it has finished, then prints the last 30 lines of the pane.
set -euo pipefail

TARGET="api:0.0"
CHANNEL="migrate-done-$$-$RANDOM"

if ! tmux has-session -t api 2>/dev/null; then
  echo "tmux session 'api' not found" >&2
  exit 1
fi

# tmux wait-for blocks until the pane signals the channel, which happens only after alembic exits.
tmux send-keys -t "$TARGET" "alembic upgrade head; tmux wait-for -S $CHANNEL" Enter
tmux wait-for "$CHANNEL"

tmux capture-pane -t "$TARGET" -p | tail -n 30
