#!/usr/bin/env bash
# The history audit of one SWE-rebench task image (pin-swe-rebench-07-2026.json history_scrub): whether the repository
# inside the image holds anything past the task's base commit. Used by swe-rebench-oracle-check.sh on the base image and
# on the image built from the materialized environment/Dockerfile.
#
#   bash scripts/frontier-harbor/swe-rebench-history-audit.sh <image> <task dir>
#
# <task dir> is the task (its tests/config.json gives base_commit and the reference fix, patch). Up to six added lines of
# the fix, longest first and outside tests and docs where the fix has any, are candidates; the first that is not in the
# base commit's tree is searched for. The image runs with no network and the task dir is not mounted. Prints one JSON
# object: HEAD against the base commit, the commits reachable from --all (and the reflog) that are not ancestors of HEAD,
# the ref, tag, remote-ref, remote, stash and packed-refs counts and how many point past HEAD, the reflog length,
# ORIG_HEAD and FETCH_HEAD, the object count against the objects reachable from HEAD, and for the fix line the commits
# git log --all --reflog -S finds and the objects holding it, each also counted outside the base commit's history.
set -euo pipefail
image=$1 task=$2
w=$(mktemp -d)
trap 'rm -rf "$w"' EXIT
python3 - "$task/tests/config.json" > "$w/cands.txt" <<'PY'
import json, re, sys
c = json.load(open(sys.argv[1]))
skip = re.compile(r"(\.(md|rst|txt|lock|json|ya?ml|snap|svg|csv)$)|(^|/)(docs?|changelog|test|tests|__tests__|spec)/|test", re.I)
code, other, cur = [], [], None
for ln in c["patch"].split("\n"):
    if ln.startswith("diff --git "):
        cur = ln.split(" b/", 1)[-1]
        continue
    if ln.startswith("+++") or not ln.startswith("+"):
        continue
    s = ln[1:].strip()
    if len(s) < 24 or len(s) > 160 or "\t" in s or not re.search(r"[A-Za-z]{4}", s):
        continue
    (other if skip.search(cur or "") else code).append(s)
print("\n".join(sorted(code, key=len, reverse=True)[:6] or sorted(other, key=len, reverse=True)[:6]))
PY
base=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["base_commit"])' "$task/tests/config.json")
cat > "$w/audit-in.sh" <<'IN'
set -u
G() { git -c safe.directory='*' "$@"; }
REPO_DIR="$PWD"
if [ ! -d "$REPO_DIR/.git" ]; then
  for _d in /testbed /app /workspace /repo; do
    if [ -d "$_d/.git" ]; then REPO_DIR="$_d"; break; fi
  done
fi
if [ ! -d "$REPO_DIR/.git" ]; then printf '{"error":"no repo","pwd":"%s"}\n' "$PWD"; exit 0; fi
cd "$REPO_DIR"
gd=$(G rev-parse --git-dir)
head=$(G rev-parse HEAD 2>/dev/null || echo none)
cnt() { wc -l | tr -d ' '; }
na=$(G rev-list --all --not HEAD 2>/dev/null | cnt)
na_reflog=$(G rev-list --all --reflog --not HEAD 2>/dev/null | cnt)
head_commits=$(G rev-list --count HEAD 2>/dev/null || echo null)
shallow=$(G rev-parse --is-shallow-repository 2>/dev/null || echo unknown)
refs_all=$(G for-each-ref --format='%(refname)' | cnt)
heads=$(G for-each-ref --format='%(refname)' refs/heads | cnt)
tags=$(G for-each-ref --format='%(refname)' refs/tags | cnt)
remote_refs=$(G for-each-ref --format='%(refname)' refs/remotes | cnt)
remotes=$(G remote | cnt)
stash=$(G for-each-ref --format='%(refname)' refs/stash | cnt)
past=0
while read -r obj; do
  [ -z "$obj" ] && continue
  c=$(G rev-parse "$obj^{commit}" 2>/dev/null) || continue
  G merge-base --is-ancestor "$c" HEAD 2>/dev/null || past=$((past + 1))
done < <(G for-each-ref --format='%(objectname)')
reflog_lines=0
[ -d "$gd/logs" ] && reflog_lines=$(find "$gd/logs" -type f -exec cat {} + | cnt)
packed=0; packed_past=0
if [ -f "$gd/packed-refs" ]; then
  packed=$(grep -c -v -e '^#' -e '^\^' "$gd/packed-refs" || true)
  while read -r sha _; do
    c=$(G rev-parse "$sha^{commit}" 2>/dev/null) || continue
    G merge-base --is-ancestor "$c" HEAD 2>/dev/null || packed_past=$((packed_past + 1))
  done < <(grep -v -e '^#' -e '^\^' "$gd/packed-refs")
fi
special() {
  local f="$gd/$1" c
  [ -e "$f" ] || { echo '{"present":false}'; return; }
  c=$(head -c 40 "$f")
  if G cat-file -e "$c^{commit}" 2>/dev/null; then
    G merge-base --is-ancestor "$c" HEAD && echo "{\"present\":true,\"sha\":\"$c\",\"past_head\":false}" || echo "{\"present\":true,\"sha\":\"$c\",\"past_head\":true}"
  else
    echo "{\"present\":true,\"sha\":\"$c\",\"object_missing\":true}"
  fi
}
orig=$(special ORIG_HEAD)
fetch=$(special FETCH_HEAD)
objs_total=$(G cat-file --batch-all-objects --batch-check='%(objectname)' | cnt)
objs_head=$(G rev-list --objects HEAD 2>/dev/null | cnt)
line=""; n=0
while IFS= read -r l; do
  n=$((n + 1))
  G grep -q -F -e "$l" HEAD -- 2>/dev/null && continue
  line="$l"; break
done < /audit/cands.txt
s_all=null; s_past=null; blobs=null; blobs_past=null
if [ -n "$line" ]; then
  if hits=$(timeout 1500 git -c safe.directory='*' log --all --reflog --format=%H -S"$line" 2>/dev/null); then
    s_all=$(printf '%s' "$hits" | grep -c . || true); s_past=0
    for h in $hits; do G merge-base --is-ancestor "$h" HEAD || s_past=$((s_past + 1)); done
  fi
  found=$(timeout 1500 git -c safe.directory='*' cat-file --batch-all-objects --batch='@@AUDITOBJ %(objectname) %(objecttype)' 2>/dev/null | LINE="$line" LC_ALL=C awk 'BEGIN{l=ENVIRON["LINE"]} /^@@AUDITOBJ /{o=$2; next} o!="" && index($0,l){print o; o=""}'; exit "${PIPESTATUS[0]}")
  if [ $? = 0 ]; then
    blobs=$(printf '%s' "$found" | grep -c . || true)
    blobs_past=0
    if [ "$blobs" -gt 0 ]; then
      G rev-list --objects HEAD | cut -d' ' -f1 | sort > /tmp/headobjs
      blobs_past=$(printf '%s\n' "$found" | sort -u | comm -23 - /tmp/headobjs | grep -c . || true)
    fi
  fi
fi
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
printf '{"repo_dir":"%s","head":"%s","head_is_base":%s,"head_commits":%s,"shallow":"%s","commits_not_ancestors_of_head":%s,"commits_not_ancestors_incl_reflog":%s,"refs":%s,"branches":%s,"tags":%s,"remote_refs":%s,"remotes":%s,"stash":%s,"refs_past_head":%s,"reflog_entries":%s,"packed_refs":%s,"packed_refs_past_head":%s,"orig_head":%s,"fetch_head":%s,"objects_total":%s,"objects_reachable_from_head":%s,"fix_line_candidate":%s,"fix_line":"%s","log_S_hits":%s,"log_S_hits_past_head":%s,"objects_with_fix_line":%s,"objects_with_fix_line_past_head":%s}\n' \
  "$(esc "$REPO_DIR")" "$head" "$([ "$head" = "$BASE" ] && echo true || echo false)" "$head_commits" "$shallow" "$na" "$na_reflog" "$refs_all" "$heads" "$tags" "$remote_refs" "$remotes" "$stash" "$past" "$reflog_lines" "$packed" "$packed_past" "$orig" "$fetch" "$objs_total" "$objs_head" "$([ -n "$line" ] && echo "$n" || echo null)" "$(esc "$line")" "$s_all" "$s_past" "$blobs" "$blobs_past"
IN
chmod -R a+rX "$w"
docker run --rm --network none --entrypoint bash -e BASE="$base" -v "$w:/audit:ro" "$image" /audit/audit-in.sh | tail -n 1
