#!/usr/bin/env bash
# Removes git pack files (.pack, .idx, .rev) from gbrain source clones that harnesses made inside finished trials' state/ and workspace/.
# A pack is a compressed download of gbrain's public repository at the pinned release, about 530 MB each; the checked-out files,
# HEAD, refs and config stay, so the clone's commit is still readable. Every removed pack is logged with its size and sha256 to
# <results>/packs-pruned.tsv first. A trial counts as finished only when its record line is in <results>/trials.jsonl.
# Usage: prune-packs.sh <results dir> [SUDO=sudo]
set -u
r=$1; S=${SUDO:-}
cd "$r/trials" 2>/dev/null || exit 0
out="$r/packs-pruned.tsv"; total=0
for t in */*/r*; do
  grep -qF "/$t\"" "$r/trials.jsonl" 2>/dev/null || continue
  while IFS= read -r -d '' p; do
    sz=$($S stat -c %s "$p"); sum=$($S sha256sum "$p" | cut -d' ' -f1)
    printf '%s\t%s\t%s\n' "$p" "$sz" "$sum" >> "$out"
    b=${p%.pack}; $S rm -f "$p" "$b.idx" "$b.rev"
    total=$((total + sz / 1024))
  done < <($S find "$t/state" "$t/workspace" -path '*/.git/objects/pack/*.pack' -type f -print0 2>/dev/null)
done
echo "packs_removed_kb=$total"
