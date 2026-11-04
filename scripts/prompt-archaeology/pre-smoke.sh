#!/usr/bin/env bash
# Pre-smoke for prompt-archaeology shards (keyless; scripts/ubicloud/run-shard.sh --pre-smoke runs it on each VM
# before any key arrives). 1) scripts/ablation-golden.sh, the layer filter's docker golden check, which builds the
# harness-eval/<harness>:dev images. 2) The clean-arm preflight (CREW rule, 2026-11-02): no harness image may hold a
# gstack install or a .capy directory. Any arguments pass to ablation-golden.sh. An image the golden check did not
# build is listed as not checked; a docker run that fails, or a preflight that checked no image, is a failure. Exit: the
# golden check's code, or 5 when an image fails the preflight, its search could not run, or no image was checked.
set -euo pipefail
# A fresh VM user is not in the docker group in this multiplexed SSH session yet (bootstrap.sh's usermod), so the
# preflight's docker calls failed after ablation-golden.sh (which re-enters on its own) and no image was checked.
# Re-enter with the group, as ablation-golden.sh, vm-shard.sh and checks.sh do.
if [ -z "${HE_PRESMOKE_IN_DOCKER_GROUP:-}" ] && getent group docker >/dev/null && ! id -nG | grep -qw docker \
  && id -nG "${USER:-$(id -un)}" | grep -qw docker; then
  export HE_PRESMOKE_IN_DOCKER_GROUP=1
  exec sg docker -c "bash $(printf %q "$(realpath "$0")")${*:+ $(printf '%q ' "$@")}"
fi
cd "$(dirname "$0")/../.."
bash scripts/ablation-golden.sh "$@"
rc=0 checked=0
for h in claude-code codex openclaw hermes; do
  img="harness-eval/$h:dev"
  docker image inspect "$img" > /dev/null 2>&1 || { echo "clean-arm preflight: $img not built by the golden check; not checked"; continue; }
  checked=$((checked + 1))
  if ! found=$(docker run --rm --network none --entrypoint sh "$img" -c \
    'find / -xdev \( -regex ".*/\.?gstack[^/]*" -o -path "*/.capy" -o -path "*/skills/gstack*" \) -print 2>/dev/null | head -5'); then
    echo "clean-arm preflight: $img FAIL, the search could not run in the image"; rc=5
  elif [ -n "$found" ]; then echo "clean-arm preflight: $img FAIL, gstack or .capy paths:"; echo "$found"; rc=5
  else echo "clean-arm preflight: $img clean (no gstack install, no .capy directory)"; fi
done
[ "$checked" -gt 0 ] || { echo "clean-arm preflight: FAIL, no harness image was checked"; rc=5; }
exit "$rc"
