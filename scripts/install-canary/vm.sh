#!/usr/bin/env bash
# internal-task: the install canary's VM side, run by scripts/install-canary/run.sh through ubi-runner.sh run (after bootstrap.sh).
# Builds the four install-mode harness images, then runs each job in the plan file through run-tag.ts, one results directory per
# job under ~/canary-out/<job id>/.
#
#   bash scripts/install-canary/vm.sh <plan.json>
#
# plan.json: {"jobs": [{"id": "...", "args": ["--tag", "v0.60.757.0", "--prerelease", "true", ...]}, ...]}
# Exit 0 when every job wrote a result.json, 3 when an image build failed (CANARY_IMAGE_BUILD), 1 when any job wrote none.
set -uo pipefail
if ! id -nG | grep -qw docker && getent group docker >/dev/null; then
  # Group membership from bootstrap.sh's usermod is not in this multiplexed SSH session yet; re-enter with the docker group.
  exec sg docker -c "bash $(printf %q "$0") $(printf '%q ' "$@")"
fi
cd "$(dirname "$0")/../.."
plan=${1:?usage: vm.sh <plan.json>}
export PATH="$HOME/.bun/bin:$PATH"
unset ANTHROPIC_API_KEY OPENAI_API_KEY PARTICLE_API_KEY OPENROUTER_API_KEY ANTHROPIC_AUTH_TOKEN VOYAGE_API_KEY XAI_API_KEY
out=${CANARY_OUT:-$HOME/canary-out}
mkdir -p "$out"
bun install --frozen-lockfile >"$out/bun-install.log" 2>&1 || { echo "CANARY_IMAGE_BUILD: bun install failed on the VM; log $out/bun-install.log"; exit 3; }
jq_() { python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); exec(sys.argv[2])' "$plan" "$1" "${@:2}"; }

# build: the four images at their pinned versions.
build() {
  local h
  for h in claude-code codex openclaw hermes; do
    echo "[vm] building harness-eval/$h:dev"
    if ! docker build -q -t "harness-eval/$h:dev" "harnesses/$h" >"$out/build-$h.log" 2>&1; then
      echo "CANARY_IMAGE_BUILD: harness-eval/$h:dev did not build; log $out/build-$h.log (an infrastructure failure, not a gbrain result)"
      tail -20 "$out/build-$h.log"
      return 1
    fi
  done
  # Hermes's own installer puts the hermes command at /usr/local/bin (or ~/.local/bin); the harness image keeps it only in its
  # venv, which Hermes's login-shell terminal drops from PATH. Without the link, gbrain setup hermes can't register its MCP server.
  printf 'FROM harness-eval/hermes:dev\nRUN ln -sf /opt/harness/venv/bin/hermes /usr/local/bin/hermes\n' | docker build -q -t harness-eval/hermes:dev - >>"$out/build-hermes.log" 2>&1 \
    || { echo "CANARY_IMAGE_BUILD: the hermes command link layer did not build; log $out/build-hermes.log"; return 1; }
  # The OpenClaw image's openclaw.json templates carry // comment lines explaining the eval's settings; a config OpenClaw writes
  # itself has none. gbrain's JSON5 reader can't read a bare key after a comment line, so the comments come out (keys unchanged).
  printf 'FROM harness-eval/openclaw:dev\nRUN sed -i "/^[[:space:]]*\\/\\//d" /opt/harness/config/openclaw*.json\n' | docker build -q -t harness-eval/openclaw:dev - >>"$out/build-openclaw.log" 2>&1 \
    || { echo "CANARY_IMAGE_BUILD: the openclaw comment-strip layer did not build; log $out/build-openclaw.log"; return 1; }
}

status=0
n=$(jq_ 'print(len(p["jobs"]))')
[ "$n" -gt 0 ] || exit 0
build || exit 3
for i in $(seq 0 $((n - 1))); do
  id=$(jq_ 'print(p["jobs"][int(sys.argv[3])]["id"])' "$i")
  mapfile -t args < <(jq_ '[print(a) for a in p["jobs"][int(sys.argv[3])]["args"]]' "$i")
  echo "[vm] job $id: run-tag.ts ${args[*]}"
  timeout 7200 bun scripts/install-canary/run-tag.ts --out "$out/$id" "${args[@]}" >"$out/$id.log" 2>&1
  tail -3 "$out/$id.log"
  # The trials' state and workspace trees (bun caches, gbrain installs, brains) are hundreds of MB and nothing reads them
  # after grading; the logs, turns, probes and result.json stay for the pull.
  find "$out/$id" -type d \( -path '*/trials/*/state' -o -path '*/trials/*/workspace' \) -prune -exec rm -rf {} + 2>/dev/null
  [ -f "$out/$id/result.json" ] || { echo "CANARY_RUN_FAILED: job $id wrote no result.json (log $out/$id.log)"; status=1; }
done
exit $status
