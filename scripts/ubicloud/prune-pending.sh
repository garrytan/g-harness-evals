#!/usr/bin/env bash
# Prune stale entries from shard destinations' cleanup-pending files (docs/ubicloud.md, "A failed pull").
#
#   scripts/ubicloud/prune-pending.sh <shard dest> [<shard dest> ...]
#
# run-shard.sh appends a VM id to <dest>/cleanup-pending when it keeps a VM after a failed final pull, or when down
# fails. An entry is removed when its <dest>/shard-vm.json names that VM with cleanup "done" (a later --attach pulled
# the results and destroyed it), or when the project's VM list (ubi-runner.sh list, every owner) was read and does not
# contain the VM's name anywhere. Every other entry stays. When the list cannot be read, only the first rule applies. An emptied file is
# deleted. fanout.sh runs this for every shard at start, and run-shard.sh before it refuses a launch. Needs
# UBICLOUD_API_KEY for the list; prints one line per removed or kept entry.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
runner=${UBI_RUNNER:-$here/ubi-runner.sh}
[ $# -gt 0 ] || { sed -n '2,/^set -euo pipefail/{/^set /!p}' "$0" >&2; exit 2; }
listed="" list_ok=0 list_read=0
for dest in "$@"; do
  f=$dest/cleanup-pending
  [ -s "$f" ] || continue
  if [ "$list_read" -eq 0 ]; then
    list_read=1
    if listed=$(bash "$runner" list 2>/dev/null); then list_ok=1; else echo "prune-pending: the VM list could not be read; only entries a later --attach destroyed are removed" >&2; fi
  fi
  done_vm=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('vm','') if d.get('cleanup') == 'done' else '')" "$dest/shard-vm.json" 2>/dev/null || true)
  keep=()
  while IFS= read -r vm; do
    [ -n "$vm" ] || continue
    if [ "$vm" = "$done_vm" ]; then echo "prune-pending: $dest: removed $vm (shard-vm.json: pulled and destroyed later)"; continue; fi
    if [ "$list_ok" -eq 1 ] && ! grep -qF -- "$vm" <<<"$listed"; then echo "prune-pending: $dest: removed $vm (not in the VM list)"; continue; fi
    echo "prune-pending: $dest: kept $vm"
    keep+=("$vm")
  done < <(awk '!seen[$0]++' "$f")
  if [ ${#keep[@]} -eq 0 ]; then rm -f "$f"; else printf '%s\n' "${keep[@]}" > "$f.tmp" && mv "$f.tmp" "$f"; fi
done
