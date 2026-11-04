#!/usr/bin/env bash
# Called by the runner (runner/trial/docker.ts), harnesses/run-trial.sh and
# harnesses/serve-smoke.ts before the stack starts, with the trial's output
# directory. Creates the paths compose binds into core so docker does not
# create them as root, and prints the per-trial values core needs as
# NAME=value lines (secrets stay in memory; the caller exports them).
#
# HE_HARNESS_CONFIG (the cell's config, internal-task) selects the probe settings
# (harnesses/qm/README.md, pin.json configs). QM has one agent loop (Pi) at
# the pin; the Claude harness and the HARNESS variable were removed upstream
# (yc-software/qm#2768), so QM_HARNESS is always pi and only labels the loop:
#   empty, pi       QM as shipped (memory capture quiet time 180 s)
#   pi-probe        MEMORY_CAPTURE_QUIET_MS=5000 (the probe cells)
#   pi-strict       pi-probe plus the org security posture strict, set by adapter.sh serve
#   pi-command-deny pi-probe plus an org command policy that denies uname, set by adapter.sh serve
#   pi-memory-provider  pi plus gbrain as QM's per-turn memory provider (internal-task, harnesses/qm/memory-provider.ts): the
#                   runner hands core MEMORY_PROVIDER_CONFIG and the provider's client pair through the stack's environment
#                   and registers no gbrain MCP server; refused here when any of the three is missing (presence only)
set -euo pipefail
out=$1
mkdir -p "$out/state/qm"
rnd() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
config=${HE_HARNESS_CONFIG:-pi}
case "$config" in
  pi) harness=pi; quiet=180000; probe="" ;;
  pi-probe) harness=pi; quiet=5000; probe="" ;;
  pi-strict|pi-command-deny) harness=pi; quiet=5000; probe=$config ;;
  pi-memory-provider) harness=pi; quiet=180000; probe=""
    for v in MEMORY_PROVIDER_CONFIG QM_GBRAIN_READ_CLIENT_ID QM_GBRAIN_READ_CLIENT_SECRET; do
      [ -n "${!v:-}" ] || { echo "qm prepare: HE_HARNESS_CONFIG=pi-memory-provider needs $v from the runner (runner/trial/trial.ts wires it per trial); it is not set" >&2; exit 2; }
    done ;;
  *) echo "qm prepare: HE_HARNESS_CONFIG=$config is not a QM config (pi, pi-probe, pi-strict, pi-command-deny, pi-memory-provider)" >&2; exit 2 ;;
esac
# Both images must be builds of the pinned commit. The tags are reused across
# pins, and a v0.1.15 core with HARNESS unset runs QM's mock harness (canned
# replies, no model call), so a stale or missing image stops the trial here.
pin=$(jq -r '.commit // empty' "$(dirname "$0")/pin.json")
[[ "$pin" =~ ^[0-9a-f]{40}$ ]] || { echo "qm prepare: no commit in pin.json" >&2; exit 2; }
for image in "${QM_IMAGE:-harness-eval/qm:dev}" "${QM_SANDBOX_IMAGE:-harness-eval/qm-sandbox:dev}"; do
  label=$(docker image inspect --format '{{index .Config.Labels "harness-eval.commit"}}' "$image" 2>/dev/null) \
    || { echo "qm prepare: image $image is missing; build it (harnesses/qm/README.md, Images)" >&2; exit 2; }
  [ "$label" = "$pin" ] \
    || { echo "qm prepare: image $image is QM ${label:-<no harness-eval.commit label>}, not the pinned $pin; rebuild it (harnesses/qm/README.md, Images)" >&2; exit 2; }
done
printf 'QM_SIGNING_SECRET=%s\n' "${QM_SIGNING_SECRET:-$(rnd)}"
printf 'QM_CONNECTOR_SECRET_KEY=%s\n' "${QM_CONNECTOR_SECRET_KEY:-$(rnd)}"
printf 'QM_DOCKER_GID=%s\n' "$(stat -c %g /var/run/docker.sock)"
printf 'QM_HARNESS=%s\n' "$harness"
printf 'QM_MEMORY_CAPTURE_QUIET_MS=%s\n' "$quiet"
printf 'QM_PROBE_CONFIG=%s\n' "$probe"
printf 'HE_HARNESS_CONFIG=%s\n' "$config"
# internal-task: a Particle cell (HE_MODEL_BASE_URL ending in /particle, runner/trial/proxy.ts baseUrlFor) runs Pi on the custom
# provider adapter.sh registers before the first turn (model custom/particle/<model>, protocol openai: Chat Completions at
# <base>/v1), and core gets no model provider and no Anthropic credential (MODEL_PROVIDER=anthropic would make core refuse to
# start without ANTHROPIC_API_KEY, src/deployment/secret-schema.ts at the pin). Every other cell prints nothing more, so compose.yaml interpolates
# exactly what it did before.
base_url=${HE_MODEL_BASE_URL:-}
case "${base_url%/}" in
  */particle)
    printf 'QM_PI_MODEL=custom/particle/%s\n' "${HE_MODEL_NAME:?HE_MODEL_NAME must be set on a Particle cell}"
    printf 'QM_MODEL_PROVIDER=\n'
    printf 'QM_ANTHROPIC_API_KEY=\n'
    printf 'QM_ANTHROPIC_BASE_URL=\n'
    ;;
esac
