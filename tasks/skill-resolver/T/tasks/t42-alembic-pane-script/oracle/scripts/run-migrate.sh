#!/usr/bin/env bash
# Types "alembic upgrade head" into the api session's first pane, waits until it has finished,
# then prints the last 30 lines of the pane.
set -euo pipefail

TARGET="api:0.0"
TIMEOUT="${1:-600}"

nonce="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
marker="OPENCLAW_DONE_${nonce}"

# Literal text first, Enter as a separate key. The marker is printed in two pieces, so the
# echoed command line never contains the whole marker and only real completion matches.
tmux send-keys -t "$TARGET" -l -- "alembic upgrade head; printf '%s%s %s\n' 'OPENCLAW_DONE_' '$nonce' \"exit=\$?\""
tmux send-keys -t "$TARGET" Enter

deadline=$(( $(date +%s) + TIMEOUT ))
until tmux capture-pane -t "$TARGET" -p -S - | grep -qF "$marker"; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "timed out after ${TIMEOUT}s waiting for alembic in $TARGET" >&2
    tmux capture-pane -t "$TARGET" -p | tail -n 30
    exit 1
  fi
  sleep 1
done

tmux capture-pane -t "$TARGET" -p | tail -n 30
