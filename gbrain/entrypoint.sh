#!/usr/bin/env bash
# gbrain sidecar entrypoint, one container per trial (docs/gbrain-arm.md).
#
#   HE_GBRAIN_SPLIT   dev | heldout: which split's brain under /brains to serve
#   HE_GBRAIN_BRAIN   bot-visible (default) | company: /brains/<split> or /brains/<split>-company (docs/gbrain-arm.md, "Company brain")
#   HE_GBRAIN_SCOPE   none (default) | member: with member, the company brain's tokens.json (one bearer token per member,
#                     each granted the sources that member may read, plus public-only) is copied to $HE_GBRAIN_OUT/tokens.json
#                     for the world's tap to present per requesting member; member needs brain company
#   HE_GBRAIN_OUT     a mounted evaluator directory: the token(s) and the sidecar's logs land here
#   HE_TRIAL_ID       names the token (trial-<id>)
#   HE_GBRAIN_SURFACE starter (default) | verbs: the MCP surface gbrain serves (internal-task, the install ladder; gbrain/pin.json
#                     "surfaces" records the tool count of each)
#   HE_GBRAIN_EMBEDDINGS  off (default) | openai:text-embedding-3-small: with a model, serves /brains/<split>-embedded (bot-visible
#                     only; built by scripts/build-gbrain-image.sh --embedded) and needs OPENAI_BASE_URL, the metering proxy's
#                     slot URL for this trial, through which gbrain's query embeddings leave; the manifest must name the model
#   OPENAI_BASE_URL   passed through to gbrain unchanged and logged as a route; it carries no key (the proxy injects the key
#                     on the host). GBRAIN_QUERY_EMBED_TIMEOUT_MS is passed through too (default from pin.json: gbrain gives up
#                     a query embedding after it and continues keyword-only, stamping the reply search_degraded)
#
# Copies the chosen brain to /brain (the path the brain was built at; gbrain records absolute paths), mints a bearer
# token for the trial into $HE_GBRAIN_OUT/token (never stdout, never a log), then serves MCP over HTTP on 0.0.0.0:3131
# with the chosen surface and the rate limits lifted, until SIGTERM. The environment carries no API key: the image has
# none and the runner passes none; an embedded brain's calls leave through OPENAI_BASE_URL only. A company brain is served with GBRAIN_REMOTE_PRIVATE_PAGES=1, so
# the pages whose frontmatter says visibility: private (the five private notes) are served like every other page:
# gbrain's default hides such pages from every remote caller, and the company-brain run measures the harness and the
# source grants, not that page-level default (the default is recorded as a finding in the report).
set -euo pipefail

: "${HE_GBRAIN_SPLIT:?HE_GBRAIN_SPLIT must be dev or heldout}"
: "${HE_GBRAIN_OUT:?HE_GBRAIN_OUT must be a writable mounted directory}"
: "${HE_TRIAL_ID:=unknown}"
: "${HE_GBRAIN_BRAIN:=bot-visible}"
: "${HE_GBRAIN_SCOPE:=none}"
: "${HE_GBRAIN_SURFACE:=starter}"
: "${HE_GBRAIN_EMBEDDINGS:=off}"
refuse() { echo "$1" >&2; exit 2; }
pin=/opt/sidecar/gbrain/pin.json
case "$HE_GBRAIN_SPLIT" in dev|heldout) ;; *) refuse "HE_GBRAIN_SPLIT must be dev or heldout (got $HE_GBRAIN_SPLIT)" ;; esac
case "$HE_GBRAIN_BRAIN" in bot-visible|company) ;; *) refuse "HE_GBRAIN_BRAIN must be bot-visible or company (got $HE_GBRAIN_BRAIN); fix: set gbrain.brain on the cell to one of them" ;; esac
case "$HE_GBRAIN_SCOPE" in none|member) ;; *) refuse "HE_GBRAIN_SCOPE must be none or member (got $HE_GBRAIN_SCOPE); fix: set gbrain.scope on the cell to one of them" ;; esac
[ "$HE_GBRAIN_SCOPE" = none ] || [ "$HE_GBRAIN_BRAIN" = company ] || refuse "HE_GBRAIN_SCOPE=member needs HE_GBRAIN_BRAIN=company (got $HE_GBRAIN_BRAIN); only the company brain carries member tokens; fix: set gbrain: {surface: starter, brain: company, scope: member}"
case "$HE_GBRAIN_SURFACE" in starter|verbs) ;; *) refuse "HE_GBRAIN_SURFACE must be starter or verbs (got $HE_GBRAIN_SURFACE); fix: set gbrain.surface on the cell to one of them" ;; esac
case "$HE_GBRAIN_EMBEDDINGS" in off) ;; openai:text-embedding-3-small) ;; *) refuse "HE_GBRAIN_EMBEDDINGS must be off or openai:text-embedding-3-small (got $HE_GBRAIN_EMBEDDINGS); fix: set gbrain.embeddings on the cell to one of them" ;; esac
if [ "$HE_GBRAIN_EMBEDDINGS" != off ]; then
  [ "$HE_GBRAIN_BRAIN" = bot-visible ] || refuse "HE_GBRAIN_EMBEDDINGS=$HE_GBRAIN_EMBEDDINGS needs HE_GBRAIN_BRAIN=bot-visible (got $HE_GBRAIN_BRAIN); only the bot-visible brains are built with embeddings"
  [ -n "${OPENAI_BASE_URL:-}" ] || refuse "HE_GBRAIN_EMBEDDINGS=$HE_GBRAIN_EMBEDDINGS needs OPENAI_BASE_URL (the metering proxy's slot URL); the sidecar never holds a key, so without the route gbrain cannot embed a query"
  src="/brains/$HE_GBRAIN_SPLIT-embedded"
  [ -d "$src/.gbrain" ] || refuse "no embedded brain at $src; this is the keyword image; fix: scripts/build-gbrain-image.sh --embedded (gbrain/README.md) and pass its tag as --gbrain-image"
  built_model=$(jq -r '.embeddings.model // empty' "$src/manifest.json")
  [ "$built_model" = "$HE_GBRAIN_EMBEDDINGS" ] || refuse "the brain at $src was built with embeddings '$built_model', the cell asks for $HE_GBRAIN_EMBEDDINGS; fix: rebuild with scripts/build-gbrain-image.sh --embedded"
  : "${GBRAIN_QUERY_EMBED_TIMEOUT_MS:=$(jq -r '.embeddings.query_embed_timeout_ms' "$pin")}"
  export GBRAIN_QUERY_EMBED_TIMEOUT_MS
else
  case "$HE_GBRAIN_BRAIN" in company) src="/brains/$HE_GBRAIN_SPLIT-company" ;; *) src="/brains/$HE_GBRAIN_SPLIT" ;; esac
fi
[ -d "$src/.gbrain" ] || refuse "no brain at $src; rebuild the image (gbrain/README.md)"
[ "$HE_GBRAIN_SCOPE" = none ] || [ -s "$src/tokens.json" ] || refuse "no tokens.json in $src; the company brain was built without member tokens; rebuild the image (gbrain/README.md)"

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
rm -rf /brain/.gbrain /brain/manifest.json /brain/tokens.json
cp -a "$src/.gbrain" /brain/.gbrain
cp "$src/manifest.json" /brain/manifest.json
rm -f /brain/.gbrain/*.lock /brain/.gbrain/persistence/locks/* 2>/dev/null || true
log "brain $HE_GBRAIN_BRAIN scope $HE_GBRAIN_SCOPE embeddings $HE_GBRAIN_EMBEDDINGS copied from $src ($(jq -r '.counts.total' /brain/manifest.json) pages$(jq -r 'if .sources then ", \(.sources | length) sources, \(.grants | length) grants" else "" end' /brain/manifest.json), gbrain $(jq -r '.gbrain_commit' /brain/manifest.json | cut -c1-12)) in $(( ($(date +%s%N) - t0) / 1000000 )) ms"

# The token is printed once by gbrain; it goes to the token file and nowhere else.
umask 077
tok=$(bun /opt/gbrain/src/cli.ts auth create "trial-$HE_TRIAL_ID" 2>>"$HE_GBRAIN_OUT/auth.stderr.log" | grep -oE 'gbrain_[0-9a-f]+' | head -1 || true)
[ -n "$tok" ] || { log "gbrain auth create printed no token (see auth.stderr.log)"; echo "gbrain auth create failed; see $HE_GBRAIN_OUT/sidecar.log" >&2; exit 2; }
printf '%s' "$tok" > "$HE_GBRAIN_OUT/token.tmp"
mv "$HE_GBRAIN_OUT/token.tmp" "$HE_GBRAIN_OUT/token"
unset tok
if [ "$HE_GBRAIN_SCOPE" = member ]; then
  # The member tokens were minted at image build (gbrain/build-brain.ts); they are copied, mode 0600, for the tap only.
  cp "$src/tokens.json" "$HE_GBRAIN_OUT/tokens.json.tmp"
  mv "$HE_GBRAIN_OUT/tokens.json.tmp" "$HE_GBRAIN_OUT/tokens.json"
  log "member tokens copied ($(jq -r '.members | length' "$HE_GBRAIN_OUT/tokens.json") members and public-only) into $HE_GBRAIN_OUT/tokens.json"
fi
umask 022
log "token minted (trial-$HE_TRIAL_ID) into $HE_GBRAIN_OUT/token at $(( ($(date +%s%N) - t0) / 1000000 )) ms"

GBRAIN_ADMIN_BOOTSTRAP_TOKEN=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
export GBRAIN_ADMIN_BOOTSTRAP_TOKEN
export GBRAIN_HTTP_RATE_LIMIT_IP=1000000 GBRAIN_HTTP_RATE_LIMIT_TOKEN=1000000 GBRAIN_OAUTH_TOKEN_RATE_LIMIT_MAX=1000000
if [ "$HE_GBRAIN_BRAIN" = company ]; then export GBRAIN_REMOTE_PRIVATE_PAGES=1; fi

if [ "$HE_GBRAIN_EMBEDDINGS" != off ]; then
  # The route, never a key: the URL names the proxy host, port and slot. The proxy injects the provider key on the host.
  log "embeddings $HE_GBRAIN_EMBEDDINGS: query embeddings leave through OPENAI_BASE_URL=$OPENAI_BASE_URL (GBRAIN_QUERY_EMBED_TIMEOUT_MS=$GBRAIN_QUERY_EMBED_TIMEOUT_MS)"
elif [ -n "${OPENAI_BASE_URL:-}" ]; then
  log "note: OPENAI_BASE_URL=$OPENAI_BASE_URL is set but the brain is keyword-only (embedding_disabled); gbrain makes no call through it"
fi

log "serve: gbrain serve --http --port 3131 --bind 0.0.0.0 --surface $HE_GBRAIN_SURFACE --suppress-bootstrap-token${GBRAIN_REMOTE_PRIVATE_PAGES:+ (GBRAIN_REMOTE_PRIVATE_PAGES=1)}"
# exec so SIGTERM from docker stop reaches gbrain itself. Its banner and request log go to serve.log,
# which never carries a token (the bootstrap token is suppressed, bearer tokens are hashed).
exec bun /opt/gbrain/src/cli.ts serve --http --port 3131 --bind 0.0.0.0 --surface "$HE_GBRAIN_SURFACE" --suppress-bootstrap-token >> "$HE_GBRAIN_OUT/serve.log" 2>&1
