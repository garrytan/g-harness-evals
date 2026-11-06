#!/usr/bin/env bash
# Harness Zero adapter. Protocol: docs/adapters.md. Exit 0 completed, 2 harness error, 3 model error, 124 wall clock.
#
# A thin shell around zero.ts, which owns the turn loop, the ready file and the exit mapping (the header of zero.ts and
# docs/errors.md HE-ZERO rows). This file only checks the environment (the variables are tested for presence, never
# printed), puts HOME and scratch space under /harness-state, refuses what Harness Zero does not implement (the gbrain
# install ladder, per-turn sessions), checks the Bun runtime against pin.json, hands zero.ts its own sha256 for the ready
# file and execs it:
#   run    one turn from /workspace/instruction.md, the reply on stdout
#   serve  the file queue in HE_TURNS_DIR until SIGTERM
set -euo pipefail

: "${HE_WORKSPACE_DIR:=/workspace}"
: "${HE_SESSION_STATE_DIR:=/harness-state}"
: "${HE_LOG_DIR:?HE_LOG_DIR must be set}"
: "${HE_TRIAL_ID:=unknown}"

mkdir -p "$HE_LOG_DIR"
exec > >(tee -a "$HE_LOG_DIR/stdout.log") 2> >(tee -a "$HE_LOG_DIR/stderr.log" >&2)
log() { printf '%s harness-zero[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" | tee -a "$HE_LOG_DIR/adapter.log" >&2; }
# internal-task: the sha256 of this adapter file goes into the ready file (preflight compares it with the image, HE-ADAPTER-005).
adapter_sha256=$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)
harness_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

entry=${1:-run}
case "$entry" in
  run|serve) ;;
  *) log "unknown entry point: $entry; 'run' and 'serve' are implemented"; exit 2 ;;
esac

for v in HE_MODEL_BASE_URL HE_MODEL_API_KEY HE_MODEL_NAME; do
  if [ -z "${!v:-}" ]; then log "HE-ZERO-008 $v is not set; fix: set it as docs/adapters.md \"Environment\" says"; exit 2; fi
done

# Per-turn sessions (HE_SESSION_SCOPE=turn) are implemented by the OpenClaw adapter only; refusing keeps a cell that asks
# for them from running per-conversation sessions in silence.
if [ "${HE_SESSION_SCOPE:-conversation}" != conversation ]; then log "HE_SESSION_SCOPE=$HE_SESSION_SCOPE is not supported (only the openclaw adapter keys sessions per turn)"; exit 2; fi

# The install ladder (HE_GBRAIN_INSTALL, docs/gbrain-arm.md) has no Harness Zero rung: a cell that asks for one stops here
# instead of running as a bare-MCP cell.
if [ -n "${HE_GBRAIN_INSTALL:-}" ]; then
  reason="HE_GBRAIN_INSTALL=$HE_GBRAIN_INSTALL is not implemented for harness-zero (the install ladder has no harness-zero rung)"
  bun -e 'const [out, install, split, dir, error] = process.argv.slice(1); require("fs").writeFileSync(out, JSON.stringify({ status: "error", code: "HE-ADAPTER-006", harness: "harness-zero", split, install, dir, view_digest: null, files: 0, destinations: [], copied: [], error }));' \
    "$HE_LOG_DIR/gbrain-install.json" "$HE_GBRAIN_INSTALL" "${HE_GBRAIN_SPLIT:-}" "${HE_GBRAIN_INSTALL_DIR:-/he-gbrain-install}" "$reason"
  log "$HE_GBRAIN_INSTALL install: HE-ADAPTER-006 the install bundle could not be applied: $reason; fix: run this cell without gbrain.install"
  exit 2
fi

# HOME, scratch space and Harness Zero's sessions and notes all live under /harness-state; Bun's transpiler cache is off so
# nothing else lands there.
export HOME="$HE_SESSION_STATE_DIR" TMPDIR="$HE_SESSION_STATE_DIR/tmp" BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
mkdir -p "$HE_SESSION_STATE_DIR/zero" "$TMPDIR"

pinned_bun=$(bun -e 'console.log(require(process.argv[1]).bun_version)' "$harness_dir/pin.json")
bun_version=$(bun --version)
if [ "$bun_version" != "$pinned_bun" ]; then log "HE-ZERO-008 bun $bun_version is not pin.json's $pinned_bun; fix: docker build -t harness-eval/harness-zero:dev harnesses/harness-zero"; exit 2; fi

export HE_ZERO_ADAPTER_SHA256="$adapter_sha256"
log "harness-zero adapter $adapter_sha256 bun $bun_version entry=$entry config=${HE_HARNESS_CONFIG:-zero-full}"
cd "$HE_WORKSPACE_DIR"
exec bun "$harness_dir/zero.ts" "$entry"
