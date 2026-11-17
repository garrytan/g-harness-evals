#!/usr/bin/env bash
# GST-2715: the keyless real-image check for the gbrain install trial. Builds the install-mode harness images from this tree
# (harness-eval/<name>:dev) and runs scripts/gbrain-install/real-image-check.ts, which drives each image through the runner's
# install trial against a fake model upstream: no provider key is used and nothing is spent. Run it on a fresh VM with
# Docker; the agent inside each container downloads bun and gbrain from the internet through the run's egress proxy.
#
#   scripts/gbrain-install/real-image-check.sh --out <dir> --tag <gbrain release tag> [--skip-build] [--harness claude-code,hermes] [--commit <the commit it names>]
#   scripts/gbrain-install/real-image-check.sh --out <dir> [--skip-build] --codex-semantic v0.60.723.0,v0.60.717.0
#
# --codex-semantic runs only the Codex semantic-search case (gbrain setup codex, then gbrain's query tool over MCP with a fake
# embedding endpoint) for each gbrain version named; see real-image-check.ts.
#
# Exit 0 when every case passes, 1 when any fails, 2 on a usage error, 3 when an image build fails.
set -euo pipefail
cd "$(dirname "$0")/../.."

skip_build=0
harnesses="claude-code codex openclaw hermes"
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build) skip_build=1; shift ;;
    --harness) [ $# -ge 2 ] || { echo "--harness needs a list" >&2; exit 2; }; harnesses="${2//,/ }"; args+=("$1" "$2"); shift 2 ;;
    --codex-semantic) [ $# -ge 2 ] || { echo "$1 needs a list" >&2; exit 2; }; harnesses=codex; args+=("$1" "$2"); shift 2 ;;
    --out|--tag|--commit) [ $# -ge 2 ] || { echo "$1 needs a value" >&2; exit 2; }; args+=("$1" "$2"); shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# The check needs no provider key: the proxy gets dummy keys, so none of the runner's environment reaches it or a container.
unset ANTHROPIC_API_KEY OPENAI_API_KEY PARTICLE_API_KEY OPENROUTER_API_KEY ANTHROPIC_AUTH_TOKEN VOYAGE_API_KEY XAI_API_KEY

if [ "$skip_build" = 0 ]; then
  for h in $harnesses; do
    echo "building harness-eval/$h:dev"
    docker build -q -t "harness-eval/$h:dev" "harnesses/$h" >/dev/null || { echo "the image build failed for $h" >&2; exit 3; }
  done
fi

exec bun scripts/gbrain-install/real-image-check.ts ${args[@]+"${args[@]}"}
