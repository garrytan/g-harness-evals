#!/usr/bin/env bash
# Traces every test file on its own under strace -f and writes one parse record per file, for build-map.py.
#
#   bash scripts/ci/test-map/trace.sh --out DIR [--workers N]
#
# Run from the repository root of a full clone with dependencies installed, strace and docker available. The files run in
# scripts/run-tests.sh's four phases, so the image-building files run first and the docker tests run rather than skip:
# the builders one at a time, then the PROXY files one at a time (two of them at once can take the same port and fail,
# and a failed file's reads stop at the failure), then every other test file with N workers (default: cores - 4, at
# least 2), then the serial files alone. Each file runs with a scrubbed environment (env -i plus HOME, PATH, USER, LANG, TERM, SHELL, TMPDIR, and
# CI=true so that tests which fetch their tools or refuse to skip in CI run as they do in the checks job). Its
# strace log is parsed by parse.py into DIR/json/<file>.json and deleted; DIR/timings.tsv gets the file, its exit status,
# its wall time in milliseconds under strace and its log size. A failing test file is still traced up to its failure.
set -uo pipefail
cd "$(dirname "$0")/../../.."
out="" workers=""
while [ $# -gt 0 ]; do
  case $1 in
    --out) out=$2; shift 2 ;;
    --workers) workers=$2; shift 2 ;;
    --one) shift; one_mode=1; break ;;
    *) echo "trace: unknown argument $1" >&2; exit 2 ;;
  esac
done
here=$(cd "$(dirname "$0")" && pwd)
if [ "${one_mode:-}" = 1 ]; then
  out=$1 f=$2
  safe=${f//\//__}
  tr=execve,execveat,open,openat,openat2,stat,lstat,newfstatat,statx,access,faccessat,faccessat2,readlink,readlinkat,chdir,fchdir,getdents64,getdents,clone,clone3,fork,vfork,mkdir,mkdirat,unlink,unlinkat,rename,renameat,renameat2
  t0=$(date +%s%N)
  timeout -k 30 1500 strace -f -qq --seccomp-bpf -y -s 512 -e trace=$tr -o "$out/tmp/$safe.log" \
    env -i HOME="$HOME" PATH="$PATH" USER="${USER:-runner}" LANG=C.UTF-8 TERM=dumb SHELL=/bin/bash TMPDIR=/tmp CI=true \
    bun test "./$f" > "$out/logs/$safe.txt" 2>&1
  rc=$?
  ms=$(( ($(date +%s%N) - t0) / 1000000 ))
  bytes=$(stat -c %s "$out/tmp/$safe.log" 2>/dev/null || echo 0)
  python3 "$here/parse.py" "$out/tmp/$safe.log" "$PWD" "$out/json/$safe.json" "$f" || echo "trace: parse failed for $f" >&2
  rm -f "$out/tmp/$safe.log"
  printf '%s\t%s\t%s\t%s\n' "$f" "$rc" "$ms" "$bytes" >> "$out/timings.tsv"
  echo "trace: $f rc=$rc ms=$ms"
  exit 0
fi
[ -n "$out" ] || { echo "usage: bash scripts/ci/test-map/trace.sh --out DIR [--workers N]" >&2; exit 2; }
command -v strace >/dev/null || { echo "trace: strace is not installed" >&2; exit 2; }
[ -n "$workers" ] || workers=$(( $(nproc) > 6 ? $(nproc) - 4 : 2 ))
mkdir -p "$out/json" "$out/tmp" "$out/logs"
: > "$out/timings.tsv"
phase() { sed -n "/^$1=(/,/^)/p" scripts/run-tests.sh | sed '1d;$d' | tr -d ' '; }
mapfile -t builders < <(phase BUILDERS)
mapfile -t proxy < <(phase PROXY)
mapfile -t serial < <(phase SERIAL)
[ ${#builders[@]} -gt 0 ] && [ ${#proxy[@]} -gt 0 ] && [ ${#serial[@]} -gt 0 ] || { echo "trace: could not read the phases from scripts/run-tests.sh" >&2; exit 2; }
mapfile -t all < <(git ls-files -z tests | tr '\0' '\n' | grep -E '^tests/.*[._](test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$')
self="$here/trace.sh"
for f in "${builders[@]}"; do bash "$self" --one "$out" "$f"; done
for f in "${proxy[@]}"; do [ ! -f "$f" ] || bash "$self" --one "$out" "$f"; done
printf '%s\n' "${all[@]}" | grep -vxF -f <(printf '%s\n' "${builders[@]}" "${proxy[@]}" "${serial[@]}") | xargs -P "$workers" -I{} bash "$self" --one "$out" {}
for f in "${serial[@]}"; do bash "$self" --one "$out" "$f"; done
n=$(ls "$out/json" | grep -c '\.json$')
echo "trace: $n of ${#all[@]} test files traced"
[ "$n" -eq ${#all[@]} ] || { echo "trace: some files have no trace" >&2; exit 1; }
