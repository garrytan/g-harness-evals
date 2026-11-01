#!/usr/bin/env bash
# internal-task overlay wrapper for the OpenClaw adapter. The image is
# harness-eval/openclaw:gstack-<pin8>, FROM harness-eval/openclaw:dev with the
# pinned gstack checkout at /opt/gstack and Bun at /opt/bun. Before the first
# turn it marks the trial as a test run for gstack (wrap_mark_test_run in
# wrapper-lib.sh, the same marker in both arms), checks the Bun runtime,
# registers gstack's skills with OpenClaw the way the spec's install step does
# (`./setup --host openclaw --no-browser`), as the adapter's HOME and state
# user, then execs the counted adapter (kept as adapter.real.sh) with the
# remaining time budget. The counted adapter and image are untouched.
#
# Which skills root the exec turn reads was a question, because the run entry
# hands `openclaw agent exec --state-dir $OPENCLAW_STATE_DIR/exec` a nested
# state dir. The keyless probe (scripts/gsta-135/preflight.sh, 2026-10-28)
# settled it: the exec turn lists the skills under $OPENCLAW_STATE_DIR/skills
# (the adapter's root, /harness-state/openclaw/skills) and not those under
# exec/skills. So the default registers the spec's way, `./setup --host
# openclaw` with OPENCLAW_STATE_DIR as the adapter exports it. The probe keeps
# the knob: HE_GSTACK_OPENCLAW_ROOTS=parent (default) | exec | both, each root
# registered by one setup run with OPENCLAW_STATE_DIR pointed at it.
#
# The no-gstack arm's image (harness-eval/openclaw:gstack-none, built with
# GSTACK_COMMIT=none) has no /opt/gstack: wrap_gstack_present logs
# `gstack: none` and the wrapper hands off without registering anything, after
# the same marker and runtime check as the gstack arms.
#
# Every arm first seeds $state/openclaw.json with the template the counted
# adapter copies when the file is absent (wrap_seed_config), so the arms differ
# only by gstack and the start hook. The start hook arm (internal-task, image built
# with GSTACK_START_HOOK=on, gstack b9fda18c or later) has setup turn on
# gstack's gstack-start plugin: gstack writes it under
# $state/extensions/gstack-start and enables it in $state/openclaw.json with
# `openclaw config set`, keeping the template's settings and its ${VAR}
# references. gstack gives no hook to a run with OPENCLAW_CONFIG_PATH set, even
# to the profile's own file (lib/harness-register.ts hookPlan), and the :dev
# image sets it to exactly $state/openclaw.json, so setup runs without it then;
# the run entry's --config names the same file. The keyless smoke (2026-11-01)
# showed the exec turn (--state-dir $state/exec) loads the plugin and its
# first request carries the note. With the hook on, roots must be parent and
# gstack-harness status must show the hook active, else exit 2 before any
# model request (wrap_start_hook_check).
set -euo pipefail
. /opt/harness/gstack/wrapper-lib.sh

export HOME="$HE_SESSION_STATE_DIR"
state="$HE_SESSION_STATE_DIR/openclaw"
mkdir -p "$state/exec"
roots=${HE_GSTACK_OPENCLAW_ROOTS:-parent}
case "$roots" in parent) dirs="$state" ;; exec) dirs="$state/exec" ;; both) dirs="$state $state/exec" ;; *) wrap_fail "HE_GSTACK_OPENCLAW_ROOTS must be parent, exec or both, not '$roots'" ;; esac
wrap_mark_test_run
wrap_runtime_check
wrap_seed_config "$state/openclaw.json" openclaw.json openclaw.openai.json
wrap_gstack_present || { wrap_log "openclaw overlay: gstack none bun $(bun --version 2>/dev/null || echo none) roots=$roots"; wrap_handoff "$@"; }
wrap_log "openclaw overlay: gstack $(cat "$GSTACK_DIR/VERSION") at $(git -C "$GSTACK_DIR" rev-parse HEAD) bun $(bun --version 2>/dev/null || echo none) roots=$roots"

hook_env=()
if [ "$GSTACK_HARNESS_START_HOOK" = 1 ]; then
  [ "$roots" = parent ] || wrap_fail "the start hook goes into the adapter's own profile $state; HE_GSTACK_OPENCLAW_ROOTS=$roots is refused with it"
  [ "${OPENCLAW_CONFIG_PATH:-$state/openclaw.json}" = "$state/openclaw.json" ] || wrap_fail "OPENCLAW_CONFIG_PATH=$OPENCLAW_CONFIG_PATH is not the profile's own $state/openclaw.json, where the start hook's settings land"
  hook_env=(-u OPENCLAW_CONFIG_PATH)
fi
for root in $dirs; do
  env "${hook_env[@]}" OPENCLAW_STATE_DIR="$root" "$GSTACK_DIR/setup" --host openclaw --no-browser > "$HE_LOG_DIR/gstack-setup.log" 2>&1 || wrap_setup_exit "openclaw (OPENCLAW_STATE_DIR=$root)" $?
  cat "$HE_LOG_DIR/gstack-setup.log" >> "$GSTACK_WRAP_LOG"
  wrap_setup_ready "$HE_LOG_DIR/gstack-setup.log" openclaw
done
OPENCLAW_STATE_DIR="$state" wrap_start_hook_check
wrap_handoff "$@"
