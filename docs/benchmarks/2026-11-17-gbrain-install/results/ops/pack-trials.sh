#!/usr/bin/env bash
# Lossless: archives a finished shard's results/trials/ as results/trials.tar.zst, checks the archive lists every file the
# directory held and decompresses cleanly, and only then removes the directory. Restore with:
#   tar -I zstd -xf results/trials.tar.zst -C results
set -euo pipefail
for d in "$@"; do
  r=$d/results; [ -d "$r/trials" ] || { echo "$(basename $d) no trials dir"; continue; }
  n=$(cd "$r" && find trials -mindepth 1 | wc -l)
  (cd "$r" && tar -cf - trials | zstd -q -T4 -6 -o trials.tar.zst.tmp)
  zstd -q -t "$r/trials.tar.zst.tmp"
  m=$(tar -I zstd -tf "$r/trials.tar.zst.tmp" | sed 's#/$##' | grep -v '^trials$' | wc -l)
  [ "$n" = "$m" ] || { echo "$(basename $d) count mismatch dir=$n archive=$m; kept"; rm -f "$r/trials.tar.zst.tmp"; continue; }
  mv "$r/trials.tar.zst.tmp" "$r/trials.tar.zst"; chmod -R u+w "$r/trials"; rm -rf "$r/trials"
  echo "$(basename $d) entries=$n archive=$(du -h "$r/trials.tar.zst" | cut -f1)"
done
df -h / | tail -1
