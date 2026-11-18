#!/usr/bin/env bash
# work-git.sh: a finished frontier trial's work trees, packed against its task's base and rebuilt from that pack
# (Amendment 1 of the gstack delivery study, added 2026-11-15 (3)). run-shard.sh's mirror calls pack for each finished
# trial, so a shard's packed replica carries a few KB per trial instead of its raw work/repo and work/remote.git.
#
#   work-git.sh pack <work dir> <base work.tar> <out dir> [--scan <regex>]
#   work-git.sh rebuild <packed dir> <base work.tar> <out dir>
#
# <work dir> holds repo (a work tree) and, for a ship task, remote.git (bare); <base work.tar> is the task's initial /work,
# tasks/repo/<suite>/<split>/<task>/environment/work.tar. pack writes, for each of repo and remote.git that exists:
# <w>.refs (every ref: sha, name and symbolic target), <w>.head (HEAD's ref, or its sha when detached), <w>.bundle (git
# bundle create --all against every commit the same base repository's refs hold; left out when the agent made no new object), <w>.logs
# (the reflogs, as text); for repo also repo.diff (git diff --binary from HEAD to every non-ignored file in the tree,
# staged or not, untracked included; left out when empty) and repo.ignored (the paths git ignores, which are listed, not
# packed: caches such as __pycache__); and base.sha256 (the base's sha256 and its path in this repository). It works on
# copies whose git config is cut to the repository format and whose hooks, attributes and alternates are removed, so
# nothing the agent wrote runs here. Before writing, it rebuilds the copy from the pack and checks the rebuilt tree,
# refs and HEAD against the raw ones. --scan <regex> greps the raw bytes of every object the bundle carries (commits, trees,
# blobs, binary ones included, and annotated tags, whatever a ref points at) and the reflogs too (exit 3 on a hit, the match
# never printed), since a bundle is compressed, a file deleted in a later commit is no longer in the tree, and patch text
# shows neither a merge's own changes, a binary file's bytes, a tag's message nor a blob a ref names directly.
# Any other failure (no repo, a base the repo does not contain, a nested repository, a failed check) exits 1 and the
# caller keeps the raw trees; a repo or remote.git that is a symlink is refused before anything is copied, and pack's temp
# folder is removed on every exit, failed ones included. rebuild extracts the base (refused when its sha256 differs from base.sha256), unbundles,
# sets every ref and HEAD as packed, checks out HEAD and applies repo.diff (to the index, then checked out, then the index
# reset to HEAD, since git apply on the work tree crashes under --attr-source): the agent's final files, except ignored ones.
set -euo pipefail
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 LC_ALL=C
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_CEILING_DIRECTORIES
root=$(cd "$(dirname "$0")/../.." && pwd)
die() { echo "work-git: $*" >&2; exit 1; }
g() { git --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.hooksPath=/dev/null -c core.attributesFile=/dev/null -c core.fsmonitor=false -c gc.auto=0 -c maintenance.auto=false "$@"; }
gitdir() { if [ "$1" = remote.git ]; then echo "$2"; else echo "$2/.git"; fi; }
# sanitize <git dir> <bare>: only the repository format survives in config; hooks, attributes, alternates and links go.
sanitize() {
  local gd=$1 kv
  [ -d "$gd" ] && [ ! -L "$gd" ] && [ -f "$gd/HEAD" ] && [ -d "$gd/objects" ] || die "no git directory at ${gd##*/raw/}"
  [ ! -e "$gd/commondir" ] && [ ! -e "$gd/gitdir" ] || die "a linked worktree, not a repository"
  [ -z "$(find "$gd" -type l -print -quit)" ] || die "a symlink inside the git directory"
  kv=$(git config -f "$gd/config" --get-regexp '^(core\.repositoryformatversion|extensions\.(objectformat|refstorage))$' 2>/dev/null || true)
  rm -rf "$gd/hooks" "$gd/info/attributes" "$gd/objects/info/alternates" "$gd/objects/info/http-alternates" "$gd/config.worktree" "$gd/worktrees"
  printf '[core]\n\tbare = %s\n' "$2" > "$gd/config"
  [ -z "$kv" ] || while read -r k v; do git config -f "$gd/config" "$k" "$v"; done <<< "$kv"
}
refs() { g -C "$1" for-each-ref --format='%(objectname) %(refname) %(symref)'; }
head_of() { g -C "$1" symbolic-ref -q HEAD || g -C "$1" rev-parse -q --verify HEAD || true; }
tree_of() { g -C "$1" add -A >/dev/null && g -C "$1" write-tree; }

rebuild() {
  local in=$1 tar=$2 out=$3 w d want sha ref sym h t
  [ -f "$in/base.sha256" ] || die "no base.sha256 in $in"
  want=$(cut -d' ' -f1 "$in/base.sha256")
  [ "$(sha256sum "$tar" | cut -d' ' -f1)" = "$want" ] || die "$tar is not the base this was packed against (sha256 $want, $(sed 's/^[^ ]* *//' "$in/base.sha256"))"
  mkdir -p "$out" && tar -C "$out" -xf "$tar" || die "cannot extract $tar into $out"
  for w in repo remote.git; do
    d=$out/$w
    if [ ! -f "$in/$w.refs" ]; then rm -rf "$d"; continue; fi
    [ -d "$d" ] || die "$tar has no $w"
    [ ! -f "$in/$w.bundle" ] || g -C "$d" bundle unbundle "$in/$w.bundle" >/dev/null || die "cannot unbundle $w.bundle"
    g -C "$d" for-each-ref --format='%(refname)' | while read -r ref; do g -C "$d" update-ref --no-deref -d "$ref"; done
    while read -r sha ref sym; do
      if [ -n "$sym" ]; then g -C "$d" symbolic-ref "$ref" "$sym"; else g -C "$d" update-ref --no-deref "$ref" "$sha"; fi
    done < "$in/$w.refs"
    h=$(cat "$in/$w.head")
    case $h in refs/*) g -C "$d" symbolic-ref HEAD "$h" ;; ?*) g -C "$d" update-ref --no-deref HEAD "$h" ;; esac
    [ ! -d "$in/$w.logs" ] || { rm -rf "$(gitdir "$w" "$d")/logs" && cp -a "$in/$w.logs" "$(gitdir "$w" "$d")/logs"; }
    [ "$w" = repo ] || continue
    g -C "$d" reset -q --hard && g -C "$d" clean -fdq || die "cannot check out HEAD in $w"
    [ -s "$in/repo.diff" ] || continue
    g -C "$d" apply --cached --binary --whitespace=nowarn "$in/repo.diff" && t=$(g -C "$d" write-tree) && g -C "$d" reset -q &&
      g -C "$d" read-tree -u -m HEAD "$t" && g -C "$d" reset -q || die "repo.diff does not apply"
  done
}

pack() {
  local work=$1 tar=$2 out=$3 scan=${4:-} tmp w d b not objs bare
  tmp=$(mktemp -d)
  trap "rm -rf -- '$tmp'" EXIT
  mkdir -p "$tmp/base" "$tmp/pack" "$tmp/raw" && tar -C "$tmp/base" -xf "$tar" || die "cannot extract $tar"
  [ -d "$tmp/base/repo/.git" ] || die "$tar holds no repo"
  [ -d "$work/repo" ] || die "no repo in $work"
  echo "$(sha256sum "$tar" | cut -d' ' -f1)  $(realpath --relative-to="$root" "$tar")" > "$tmp/pack/base.sha256"
  for w in repo remote.git; do
    [ -d "$work/$w" ] || continue
    [ -d "$tmp/base/$w" ] || die "$tar has no $w"
    d=$tmp/raw/$w
    [ ! -L "$work/$w" ] || die "$w is a symlink, not a work tree"
    cp -a "$work/$w" "$d" || die "cannot copy $w"
    [ -d "$d" ] && [ ! -L "$d" ] || die "the copy of $w is not a directory"
    bare=false; [ "$w" = repo ] || bare=true
    sanitize "$(gitdir "$w" "$d")" "$bare"
    not=()
    for b in $(refs "$tmp/base/$w" | cut -d' ' -f1 | sort -u); do
      g -C "$d" cat-file -e "$b^{commit}" 2>/dev/null || die "$w lacks base commit $b: not this task's base"
      not+=("^$b")
    done
    refs "$d" > "$tmp/pack/$w.refs" && head_of "$d" > "$tmp/pack/$w.head" || die "cannot read the refs of $w"
    objs=$(g -C "$d" rev-list --objects --all ${not[@]+"${not[@]}"} | cut -d' ' -f1) || die "cannot walk the history of $w"
    if [ -n "$objs" ]; then
      g -C "$d" bundle create -q "$tmp/pack/$w.bundle" --all ${not[@]+"${not[@]}"} 2>/dev/null || die "cannot bundle $w"
      if [ -n "$scan" ] && grep -qaE -- "$scan" < <(g -C "$d" cat-file --batch <<< "$objs"); then
        echo "work-git: key-shaped text in a commit of $w" >&2; exit 3
      fi
    fi
    [ ! -d "$(gitdir "$w" "$d")/logs" ] || cp -a "$(gitdir "$w" "$d")/logs" "$tmp/pack/$w.logs"
    if [ -n "$scan" ] && [ -d "$tmp/pack/$w.logs" ] && grep -rqaE -- "$scan" "$tmp/pack/$w.logs"; then
      echo "work-git: key-shaped text in a reflog of $w" >&2; exit 3
    fi
    [ "$w" = repo ] || continue
    [ -n "$(g -C "$d" rev-parse -q --verify HEAD)" ] || die "repo has no HEAD commit"
    tree_of "$d" > "$tmp/tree" || die "cannot index the repo tree"
    [ -z "$(g -C "$d" ls-files -s | awk '$1 == "160000"')" ] || die "a nested repository inside repo"
    g -C "$d" diff --cached --binary --no-ext-diff --no-textconv HEAD > "$tmp/pack/repo.diff" || die "cannot diff repo"
    [ -s "$tmp/pack/repo.diff" ] || rm -f "$tmp/pack/repo.diff"
    g -C "$d" ls-files -o -i --exclude-standard --directory > "$tmp/pack/repo.ignored"
    [ -s "$tmp/pack/repo.ignored" ] || rm -f "$tmp/pack/repo.ignored"
  done
  ( rebuild "$tmp/pack" "$tar" "$tmp/check" ) || die "the rebuild check failed"
  for w in repo remote.git; do
    [ -f "$tmp/pack/$w.refs" ] || continue
    [ "$(refs "$tmp/check/$w")" = "$(cat "$tmp/pack/$w.refs")" ] && [ "$(head_of "$tmp/check/$w")" = "$(cat "$tmp/pack/$w.head")" ] || die "the rebuilt $w has other refs"
  done
  [ "$(tree_of "$tmp/check/repo")" = "$(cat "$tmp/tree")" ] || die "the rebuilt repo has other files"
  rm -rf "$out" && mkdir -p "$(dirname "$out")" && cp -a "$tmp/pack" "$out" || die "cannot write $out"
}

case ${1:-} in
  pack) [ $# -eq 4 ] || { [ $# -eq 6 ] && [ "$5" = --scan ]; } || die "usage: work-git.sh pack <work dir> <base work.tar> <out dir> [--scan <regex>]"; pack "$2" "$3" "$4" "${6:-}" ;;
  rebuild) [ $# -eq 4 ] || die "usage: work-git.sh rebuild <packed dir> <base work.tar> <out dir>"; rebuild "$2" "$3" "$4" ;;
  *) die "usage: work-git.sh pack|rebuild ..." ;;
esac
