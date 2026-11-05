#!/usr/bin/env bash
# Clean-arm preflight for the harness x model matrix shards (CREW.md "Clean no-gstack and no-brain arms";
# docs/benchmarks/2026-11-04-matrix-mu/PREREGISTRATION.md). Keyless. scripts/ubicloud/run-shard.sh --pre-smoke runs it on
# each VM after bootstrap and before any key, smoke or trial; a non-zero exit stops the shard there (exit 4), so no trial
# runs. It builds each harness image as scripts/run-shard.sh does (the counted step's build then reuses the layer cache)
# and checks:
#   host    the VM holds no Capy drive and no user-level gstack install: ~/.capy, ~/.local/share/gstack,
#           ~/.claude/skills/gstack, ~/.gstack
#   mounts  the files that set a trial container's mounts (runner/trial/docker.ts, harnesses/run-trial.sh,
#           harnesses/qm/compose.yaml) name no .capy or gstack path
#   images  each harness image holds no gstack path and no .capy directory, searched as root (the search of
#           scripts/prompt-archaeology/pre-smoke.sh); a search that exits non-zero fails the image
# The mounts check reads only the static mount files; a mount added while a trial runs is left to the post-run artifact audit.
#
#   bash scripts/matrix/clean-arm-preflight.sh [<harness> ...]   (default: claude-code codex openclaw hermes qm; qm adds its sandbox image)
#
# One "clean-arm preflight: <check> clean" or "... FAIL" line per check. Exit 0 when every check passes, 5 when any fails,
# 3 when an image build fails.
set -euo pipefail
if [ -z "${HE_PREFLIGHT_IN_DOCKER_GROUP:-}" ] && getent group docker >/dev/null && ! id -nG | grep -qw docker \
  && id -nG "${USER:-$(id -un)}" | grep -qw docker; then
  export HE_PREFLIGHT_IN_DOCKER_GROUP=1
  exec sg docker -c "bash $(printf %q "$(realpath "$0")")${*:+ $(printf '%q ' "$@")}"
fi
cd "$(dirname "$0")/../.."
harnesses=("$@")
[ ${#harnesses[@]} -gt 0 ] || harnesses=(claude-code codex openclaw hermes qm)
rc=0
fail() { echo "clean-arm preflight: $1 FAIL, $2"; rc=5; }

found=""
for d in "$HOME/.capy" "$HOME/.local/share/gstack" "$HOME/.claude/skills/gstack" "$HOME/.gstack"; do [ ! -e "$d" ] || found+=" $d"; done
if [ -n "$found" ]; then fail host "present:$found"; else echo "clean-arm preflight: host clean (no Capy drive, no user-level gstack install)"; fi

set +e
hits=$(grep -nE '\.capy|gstack' runner/trial/docker.ts harnesses/run-trial.sh harnesses/qm/compose.yaml 2>&1)
g=$?
set -e
case $g in
  0) fail mounts "$(tr '\n' ' ' <<< "$hits")" ;;
  1) echo "clean-arm preflight: mounts clean (no .capy or gstack path in runner/trial/docker.ts, harnesses/run-trial.sh, harnesses/qm/compose.yaml)" ;;
  *) fail mounts "the mount files could not be read" ;;
esac

images=()
for h in "${harnesses[@]}"; do
  docker build -q -t "harness-eval/$h:dev" "harnesses/$h" > /dev/null || { echo "clean-arm preflight: image build failed for $h"; exit 3; }
  images+=("harness-eval/$h:dev")
  [ "$h" = qm ] || continue
  docker build -q -f harnesses/qm/Dockerfile.sandbox -t harness-eval/qm-sandbox:dev harnesses/qm > /dev/null || { echo "clean-arm preflight: image build failed for the QM sandbox"; exit 3; }
  images+=(harness-eval/qm-sandbox:dev)
done
for img in "${images[@]}"; do
  set +e
  paths=$(docker run --rm --network none --user 0:0 --entrypoint sh "$img" -c \
    'found=$(find / -xdev \( -name "gstack*" -o -name ".gstack*" -o -path "*/.capy" -o -path "*/skills/gstack*" \) -print 2>/dev/null); s=$?; printf "%s\n" "$found" | head -5; exit $s')
  s=$?
  set -e
  if [ "$s" -ne 0 ]; then fail "$img" "the search could not run in the image"
  elif [ -n "$paths" ]; then fail "$img" "gstack or .capy paths: $(tr '\n' ' ' <<< "$paths")"
  else echo "clean-arm preflight: $img clean (no gstack path, no .capy directory)"; fi
done
exit "$rc"
