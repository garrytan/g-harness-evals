#!/usr/bin/env bash
# Run on a shard's VM: for each finished trial (its record line is in ~/shard/results/trials.jsonl, which the runner writes only after the trial's canary scan; install-classification.json alone raced the scan on 2026-11-18 and caused a false HE-INSTALL-005 in s09), removes package caches and installed dependency trees from state/ (node_modules, Bun and npm caches, .cache, the bun binary), keeping the brain, the harness's own session files and the workspace. Appends what it removed to ~/shard/results/state-pruned.tsv. DRY=1 only measures.
set -u
cd ~/shard/results/trials 2>/dev/null || exit 0
out=~/shard/results/state-pruned.tsv
total=0
for t in */*/r*; do
  grep -qF "/$t\"" ~/shard/results/trials.jsonl 2>/dev/null && [ -d "$t/state" ] || continue
  while IFS= read -r -d '' p; do
    k=$(sudo du -sk "$p" 2>/dev/null | cut -f1)
    total=$((total + k))
    [ "${DRY:-0}" = 1 ] && continue
    printf '%s\t%s\n' "$p" "$k" >> "$out"
    sudo rm -rf "$p"
  done < <(sudo find "$t/state" \( -name node_modules -o -path '*/.bun/install/cache' -o -path '*/.npm/_cacache' -o -name .cache \) -type d -prune -print0 2>/dev/null; sudo find "$t/state" -path '*/.bun/bin/bun' -type f -print0 2>/dev/null)
done
echo "removed_kb=$total dry=${DRY:-0}"
