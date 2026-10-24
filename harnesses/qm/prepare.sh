#!/usr/bin/env bash
# Called by the runner (runner/trial/docker.ts), harnesses/run-trial.sh and
# harnesses/serve-smoke.ts before the stack starts, with the trial's output
# directory. Creates the paths compose binds into core so docker does not
# create them as root, and prints the per-trial values core needs as
# NAME=value lines (secrets stay in memory; the caller exports them).
#
# HE_HARNESS_CONFIG (the cell's config, internal-task) selects QM's inner harness
# and the probe settings (harnesses/qm/README.md, pin.json configs):
#   empty, pi       QM over Pi as shipped (memory capture quiet time 180 s)
#   claude          QM over the Claude Agent SDK harness as shipped
#   pi-probe        Pi with MEMORY_CAPTURE_QUIET_MS=5000 (the probe cells)
#   claude-probe    the Claude harness with the same quiet time
#   pi-strict       pi-probe plus the org security posture strict, set by adapter.sh serve
#   pi-command-deny pi-probe plus an org command policy that denies uname, set by adapter.sh serve
set -euo pipefail
out=$1
mkdir -p "$out/state/qm"
rnd() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
config=${HE_HARNESS_CONFIG:-pi}
case "$config" in
  pi) harness=pi; quiet=180000; probe="" ;;
  claude) harness=claude; quiet=180000; probe="" ;;
  pi-probe) harness=pi; quiet=5000; probe="" ;;
  claude-probe) harness=claude; quiet=5000; probe="" ;;
  pi-strict|pi-command-deny) harness=pi; quiet=5000; probe=$config ;;
  *) echo "qm prepare: HE_HARNESS_CONFIG=$config is not a QM config (pi, claude, pi-probe, claude-probe, pi-strict, pi-command-deny)" >&2; exit 2 ;;
esac
printf 'QM_SIGNING_SECRET=%s\n' "${QM_SIGNING_SECRET:-$(rnd)}"
printf 'QM_CONNECTOR_SECRET_KEY=%s\n' "${QM_CONNECTOR_SECRET_KEY:-$(rnd)}"
printf 'QM_DOCKER_GID=%s\n' "$(stat -c %g /var/run/docker.sock)"
printf 'QM_HARNESS=%s\n' "$harness"
printf 'QM_MEMORY_CAPTURE_QUIET_MS=%s\n' "$quiet"
printf 'QM_PROBE_CONFIG=%s\n' "$probe"
printf 'HE_HARNESS_CONFIG=%s\n' "$config"
