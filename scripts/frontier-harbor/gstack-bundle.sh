#!/usr/bin/env bash
# Builds the offline gstack bundle that a delivery arm with install bundle (delivery.py, the gstack cheap-model run's
# installed and told arms on Terminal-Bench 2.1) uploads into each task container. The tarball holds:
#   gstack/   gstack at delivery-pin.json bundle.commit with its .git (one shallow commit), its production node_modules and
#             compiled binaries already built, so ./setup finds its build stamp and skips bun install and bun run build
#   bun/bin/  the pinned Bun linux-x64 binary and its bunx link (the release zip, sha256 checked against delivery-pin.json
#             and gstack's own bin/gstack-bun-version.sh table)
# so ./setup --host hermes|openclaw --no-browser runs in a task container with no network and no git. Ported from internal-task's
# gstack-bundle.sh (harn63/prereg-docs).
#
#   bash scripts/frontier-harbor/gstack-bundle.sh <out dir>
#
# The build itself needs the network (the git fetch, the Bun download and the npm registry for gstack's bun.lock). It
# builds in the fixed directory /tmp/gstack-bundle-build (refused while it exists), because gstack's build writes its
# own path into a few built files; a fresh temporary directory each time would make them differ between builds. It
# writes <out>/gstack-bundle-<commit 12>.tgz and <out>/gstack-bundle.json (commit, version, Bun, the tarball's sha256 and
# size, the content digest delivery.py bundle-digest computes over the unpacked files, build seconds and the files the
# build added to the checkout), and prints the content digest as its last line. Build it on the controller and upload the
# tarball to each shard VM (scripts/ubicloud/run-shard.sh --gstack-bundle): the digest depends on the build host.
# Exit 2 on a usage error, 3 when an input does not match its pin, 4 when the build directory is in use.
set -euo pipefail
umask 022
here=$(cd "$(dirname "$0")" && pwd)
[ $# -eq 1 ] || { echo "usage: gstack-bundle.sh <out dir>" >&2; exit 2; }
out=$1
read -r commit src version bun_version bun_zip_sha flags <<< "$(python3 -c 'import json,sys; g=json.load(open(sys.argv[1]))["bundle"]; b=g["bun"]; print(g["commit"], g["repo"], g["version"], b["version"], b["linux_x64_zip_sha256"], ",".join(g["setup_flags"]))' "$here/delivery-pin.json")"
mkdir -p "$out"
out=$(cd "$out" && pwd)
work=/tmp/gstack-bundle-build
mkdir "$work" 2>/dev/null || { echo "gstack-bundle: $work exists: another build is running, or remove it" >&2; exit 4; }
trap 'rm -rf "$work"' EXIT
start=$(date +%s)
say() { printf '%s gstack-bundle: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

git init -q "$work/gstack"
git -C "$work/gstack" fetch -q --depth 1 "$src" "$commit"
git -C "$work/gstack" -c advice.detachedHead=false checkout -q FETCH_HEAD
head=$(git -C "$work/gstack" rev-parse HEAD)
[ "$head" = "$commit" ] || { echo "gstack-bundle: fetched $head, not $commit" >&2; exit 3; }
git -C "$work/gstack" remote add origin "$src"
got_version=$(cat "$work/gstack/VERSION")
[ "$got_version" = "$version" ] || { echo "gstack-bundle: VERSION is $got_version, not delivery-pin.json's $version" >&2; exit 3; }
say "gstack $version at $commit"

theirs=$(bash -c '. "$1"; gstack_bun_archive_sha256 linux-x64 "$2"' _ "$work/gstack/bin/gstack-bun-version.sh" "$bun_version" || true)
[ "$theirs" = "$bun_zip_sha" ] || { echo "gstack-bundle: gstack's bin/gstack-bun-version.sh lists ${theirs:-no sha256} for Bun $bun_version linux-x64, not delivery-pin.json's $bun_zip_sha" >&2; exit 3; }
mkdir -p "$work/bun/bin" "$work/unpack"
curl -fsSL --retry 3 --retry-delay 2 -o "$work/bun.zip" "https://github.com/oven-sh/bun/releases/download/bun-v$bun_version/bun-linux-x64.zip"
got=$(sha256sum "$work/bun.zip" | cut -d' ' -f1)
[ "$got" = "$bun_zip_sha" ] || { echo "gstack-bundle: bun-v$bun_version/bun-linux-x64.zip is $got, not $bun_zip_sha" >&2; exit 3; }
unzip -q "$work/bun.zip" -d "$work/unpack"
install -m 0755 "$work/unpack/bun-linux-x64/bun" "$work/bun/bin/bun"
ln -s bun "$work/bun/bin/bunx"
bun_bin_sha=$(sha256sum "$work/bun/bin/bun" | cut -d' ' -f1)
say "bun $("$work/bun/bin/bun" --version) ($bun_bin_sha)"

mkdir -p "$work/home"
(cd "$work/gstack" && env -i "PATH=$work/bun/bin:/usr/local/bin:/usr/bin:/bin" "HOME=$work/home" "HERMES_HOME=$work/home/hermes" "GSTACK_STATE_ROOT=$work/home/.gstack" \
  GSTACK_SESSION_KIND=unattended GSTACK_EPHEMERAL=1 GSTACK_HARNESS_AUTO=0 GSTACK_HARNESS_START_HOOK=0 TZ=UTC \
  ./setup --host hermes ${flags//,/ }) > "$work/setup.log" 2>&1 || { tail -n 30 "$work/setup.log" >&2; echo "gstack-bundle: the build's ./setup failed (log above)" >&2; exit 1; }
[ -f "$work/gstack/browse/dist/.build-complete" ] || { echo "gstack-bundle: setup finished without browse/dist/.build-complete" >&2; exit 1; }
added=$(git -C "$work/gstack" status --porcelain --ignored --untracked-files=normal | sed 's/^...//' | sort)
dirty=$(git -C "$work/gstack" status --porcelain --untracked-files=no)
[ -z "$dirty" ] || { echo "gstack-bundle: the build changed tracked files: $dirty" >&2; exit 1; }

name="gstack-bundle-${commit:0:12}.tgz"
tar --sort=name --owner=0 --group=0 --numeric-owner --format=posix --pax-option=delete=atime,delete=ctime -C "$work" -cf - gstack bun | gzip -n -6 > "$out/$name"
sha=$(sha256sum "$out/$name" | cut -d' ' -f1)
rm -rf "$work/home" "$work/unpack" "$work/bun.zip" "$work/setup.log"
content=$(python3 "$here/delivery.py" bundle-digest "$work")
seconds=$(( $(date +%s) - start ))
python3 - "$out/gstack-bundle.json" "$commit" "$version" "$src" "$bun_version" "$bun_bin_sha" "$name" "$sha" "$(stat -c %s "$out/$name")" "$seconds" "$added" "$content" <<'PY'
import json, sys
path, commit, version, src, bun_version, bun_sha, name, sha, size, seconds, added, content = sys.argv[1:13]
json.dump({"schema": "frontier-harbor-gstack-bundle/2", "commit": commit, "version": version, "source": src,
           "bun": {"version": bun_version, "binary_sha256": bun_sha},
           "tarball": {"file": name, "sha256": sha, "bytes": int(size)},
           "content": json.loads(content),
           "build_seconds": int(seconds), "build_added": [a for a in added.splitlines() if a]}, open(path, "w"), indent=2)
PY
say "$name: $(stat -c %s "$out/$name") bytes, built in ${seconds}s"
python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["content"]["sha256"])' "$out/gstack-bundle.json"
