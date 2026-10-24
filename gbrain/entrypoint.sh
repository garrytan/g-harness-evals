#!/usr/bin/env bash
# gbrain sidecar entrypoint, one container per trial (docs/gbrain-arm.md).
#
#   HE_GBRAIN_SPLIT   dev | heldout: which prebuilt brain under /brains to serve
#   HE_GBRAIN_OUT     a mounted evaluator directory: the token and the sidecar's logs land here
#   HE_TRIAL_ID       names the token (trial-<id>)
#
# Copies /brains/$HE_GBRAIN_SPLIT to /brain (the path the brain was built at; gbrain records absolute paths),
# mints a bearer token for the trial into $HE_GBRAIN_OUT/token (never stdout, never a log), then serves MCP
# over HTTP on 0.0.0.0:3131 with the starter surface, embeddings off and the rate limits lifted, until
# SIGTERM. The environment carries no API key: the image has none and the runner passes none.
set -euo pipefail

: "${HE_GBRAIN_SPLIT:?HE_GBRAIN_SPLIT must be dev or heldout}"
: "${HE_GBRAIN_OUT:?HE_GBRAIN_OUT must be a writable mounted directory}"
: "${HE_TRIAL_ID:=unknown}"
case "$HE_GBRAIN_SPLIT" in dev|heldout) ;; *) echo "HE_GBRAIN_SPLIT must be dev or heldout (got $HE_GBRAIN_SPLIT)" >&2; exit 2 ;; esac
[ -d "/brains/$HE_GBRAIN_SPLIT/.gbrain" ] || { echo "no brain at /brains/$HE_GBRAIN_SPLIT; rebuild the image (gbrain/README.md)" >&2; exit 2; }

for k in ANTHROPIC_API_KEY OPENAI_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY VOYAGE_API_KEY; do
  if [ -n "${!k:-}" ]; then echo "refusing to start: $k is set in the sidecar environment; gbrain must never see a model key" >&2; exit 2; fi
done

mkdir -p "$HE_GBRAIN_OUT"
log() { printf '%s gbrain-sidecar[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" >> "$HE_GBRAIN_OUT/sidecar.log"; }

export HOME="$HE_GBRAIN_OUT"
export GBRAIN_HOME=/brain
export GBRAIN_SKIP_STARTUP_HOOKS=1
export NO_COLOR=1

t0=$(date +%s%N)
rm -rf /brain/.gbrain /brain/manifest.json
cp -a "/brains/$HE_GBRAIN_SPLIT/.gbrain" /brain/.gbrain
cp "/brains/$HE_GBRAIN_SPLIT/manifest.json" /brain/manifest.json
rm -f /brain/.gbrain/*.lock /brain/.gbrain/persistence/locks/* 2>/dev/null || true
log "brain copied from /brains/$HE_GBRAIN_SPLIT ($(jq -r '.counts.total' /brain/manifest.json) pages, gbrain $(jq -r '.gbrain_commit' /brain/manifest.json | cut -c1-12)) in $(( ($(date +%s%N) - t0) / 1000000 )) ms"

# The token is printed once by gbrain; it goes to the token file and nowhere else.
umask 077
tok=$(bun /opt/gbrain/src/cli.ts auth create "trial-$HE_TRIAL_ID" 2>>"$HE_GBRAIN_OUT/auth.stderr.log" | grep -oE 'gbrain_[0-9a-f]+' | head -1 || true)
[ -n "$tok" ] || { log "gbrain auth create printed no token (see auth.stderr.log)"; echo "gbrain auth create failed; see $HE_GBRAIN_OUT/sidecar.log" >&2; exit 2; }
printf '%s' "$tok" > "$HE_GBRAIN_OUT/token.tmp"
mv "$HE_GBRAIN_OUT/token.tmp" "$HE_GBRAIN_OUT/token"
unset tok
umask 022
log "token minted (trial-$HE_TRIAL_ID) into $HE_GBRAIN_OUT/token at $(( ($(date +%s%N) - t0) / 1000000 )) ms"

GBRAIN_ADMIN_BOOTSTRAP_TOKEN=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
export GBRAIN_ADMIN_BOOTSTRAP_TOKEN
export GBRAIN_HTTP_RATE_LIMIT_IP=1000000 GBRAIN_HTTP_RATE_LIMIT_TOKEN=1000000 GBRAIN_OAUTH_TOKEN_RATE_LIMIT_MAX=1000000

log "serve: gbrain serve --http --port 3131 --bind 0.0.0.0 --surface starter --suppress-bootstrap-token"
# exec so SIGTERM from docker stop reaches gbrain itself. Its banner and request log go to serve.log,
# which never carries a token (the bootstrap token is suppressed, bearer tokens are hashed).
exec bun /opt/gbrain/src/cli.ts serve --http --port 3131 --bind 0.0.0.0 --surface starter --suppress-bootstrap-token >> "$HE_GBRAIN_OUT/serve.log" 2>&1
