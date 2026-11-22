#!/usr/bin/env bash
# Local twin of prune-state.sh: trims package caches from finished trials' state/ under a shard's results (and any results.partial-*), keeping the brain, session files and workspace. Appends each removed path to <dest>/state-pruned-local.txt.
set -u
for d in "$@"; do
  for r in "$d"/results "$d"/results.partial-*; do
    [ -d "$r/trials" ] || continue
    chmod -R u+w "$r/trials" 2>/dev/null
    { find "$r/trials" -path '*/state/*' \( -name node_modules -o -path '*/.bun/install/cache' -o -path '*/.npm/_cacache' -o -name .cache \) -type d -prune -print0; find "$r/trials" -path '*/state/*' -path '*/.bun/bin/bun' -type f -print0; } > "$d/.prune-now"
    tr '\0' '\n' < "$d/.prune-now" >> "$d/state-pruned-local.txt"
    xargs -0 -r rm -rf -- < "$d/.prune-now"; rm -f -- "$d/.prune-now"
  done
  echo "$(basename -- "$d") $(du -sh -- "$d" | cut -f1)"
done
df -h / | tail -1
