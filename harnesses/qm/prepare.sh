#!/usr/bin/env bash
# Called by harnesses/run-trial.sh before the stack starts, with the trial's
# output directory. Creates the paths compose binds into core so docker does
# not create them as root, and prints the per-trial values core needs as
# NAME=value lines (secrets stay in memory; the runner exports them).
set -euo pipefail
out=$1
mkdir -p "$out/state/qm"
rnd() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
printf 'QM_SIGNING_SECRET=%s\n' "${QM_SIGNING_SECRET:-$(rnd)}"
printf 'QM_CONNECTOR_SECRET_KEY=%s\n' "${QM_CONNECTOR_SECRET_KEY:-$(rnd)}"
printf 'QM_DOCKER_GID=%s\n' "$(stat -c %g /var/run/docker.sock)"
